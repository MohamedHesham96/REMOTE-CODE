import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { FavoritePrompt } from "./opencode/types.js"

// الطلبات المفضّلة على السيرفر مش في المتصفح: نفس منطق المثبّتات — الحفظ من
// الموبايل يظهر على الويب والعكس، ويفضل بعد إغلاق المتصفح وإعادة تشغيل
// السيرفر. التخزين ملف JSON صغير (data/favorites.json) زي المثبّتات بالظبط،
// وبدون أي قاعدة بيانات.
//
// الفكرة: المفضّلة نص كامل محفوظ زي ما المستخدم كتبه + اسم عرض قصير قابل
// لإعادة التسمية + وقت الحفظ. مفيش ربط بجلسة أو مشروع، فحذف الجلسة اللي
// اتحفظ منها الطلب مايأثرش على المفضّلة خالص.

const CURRENT_VERSION = 1

interface FavoritesFile {
  version: number
  favorites: FavoritePrompt[]
}

// سقف عدد المفضّلات — يمنع الملف من النمو بلا حد (نفس فكرة سقف المثبّتات).
export const MAX_FAVORITES = 100

// سقف النص نفس سقف الرسالة في المحرك (20000 محرف)، والاسم مقيّد عشان
// الصف يفضل قابلًا للقراءة على الموبايل.
const MAX_TEXT = 20000
const MAX_LABEL = 120
const MAX_ID = 200

// المشاهدين (بثّ SSE) — نفس عقدة مثبّتات النماذج بس القائمة كائنات.
export type FavoriteListener = (favorites: FavoritePrompt[]) => void

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

// الاسم الافتراضي من أول سطر مطوي. **لازم يطابق `favoriteLabelFromText` في
// src/utils/favorite-prompts.ts حرفيًا** — لو اختلفوا، الاسم المعروض بينطط
// بعد ما رد السيرفر يوصل ويستبدل التعديل المتفائل.
export function favoriteLabelFromText(value: string): string {
  const firstLine = (value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ""
  const collapsed = firstLine.replace(/\s+/g, " ").trim()
  if (!collapsed) {
    return ""
  }
  if (collapsed.length <= MAX_LABEL) {
    return collapsed
  }
  return `${collapsed.slice(0, MAX_LABEL - 1).trimEnd()}…`
}

// معرّف المفضّلة: العميل بيولّد واحد وبيبعته مع النسخة المتفائلة فيفضل نفس
// المعرّف من أول لحظة، والسيرفر بيولّد واحد لو العميل بعت من غير id (أو من
// عميل تاني). عشوائي عشان ما يحصلش تعارض بين جهازين بيحفظوا في نفس اللحظة.
function favoriteId(): string {
  return `fav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// بيقرأ مدخلات العميل ويقرّر لو صالحة: النص لازم يتكتب والباقي بيتقصّ.
// الرمي بكود ثابت عشان الراوت يترجمه حسب لغة الطلب (نفس عقد المثبّتات).
export function parseFavoritePrompt(value: unknown): FavoritePrompt {
  if (typeof value !== "object" || value === null) {
    throw new Error("INVALID_FAVORITE")
  }
  const candidate = value as Partial<FavoritePrompt>
  const promptText = typeof candidate.text === "string" ? candidate.text.trim() : ""
  if (!promptText) {
    throw new Error("INVALID_FAVORITE")
  }
  if (promptText.length > MAX_TEXT) {
    throw new Error("FAVORITE_TOO_LONG")
  }
  const createdAt = typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
    ? Math.trunc(candidate.createdAt)
    : Date.now()
  return {
    id: text(candidate.id, MAX_ID) || favoriteId(),
    text: promptText,
    // الاسم الافتراضي من أول سطر — المستخدم يقدر يعيد تسميته بعدين
    label: text(candidate.label, MAX_LABEL) || favoriteLabelFromText(promptText),
    createdAt,
  }
}

// تعديل/إعادة تسمية: أي حقل غايب يفضل زي ما هو، والنص الفاضي مرفوض.
export function parseFavoritePatch(value: unknown): { text?: string; label?: string } {
  if (typeof value !== "object" || value === null) {
    throw new Error("INVALID_FAVORITE")
  }
  const candidate = value as Partial<FavoritePrompt>
  const patch: { text?: string; label?: string } = {}
  if (candidate.text !== undefined) {
    const promptText = typeof candidate.text === "string" ? candidate.text.trim() : ""
    if (!promptText) {
      throw new Error("INVALID_FAVORITE")
    }
    if (promptText.length > MAX_TEXT) {
      throw new Error("FAVORITE_TOO_LONG")
    }
    patch.text = promptText
  }
  if (candidate.label !== undefined) {
    patch.label = text(candidate.label, MAX_LABEL)
  }
  if (patch.text === undefined && patch.label === undefined) {
    throw new Error("INVALID_FAVORITE")
  }
  return patch
}

function normalizeFavorites(values: unknown): FavoritePrompt[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seenIds = new Set<string>()
  const seenTexts = new Set<string>()
  const result: FavoritePrompt[] = []
  for (const value of values) {
    let favorite: FavoritePrompt
    try {
      favorite = parseFavoritePrompt(value)
    } catch {
      continue
    }
    // منع التكرار على مستوى الملف كذلك: تعديل يدوي بيكرّر نصًا محفوظًا
    // مايخلقش نسختين متطابقتين تظهر بيهم القائمة.
    if (seenIds.has(favorite.id) || seenTexts.has(favorite.text)) {
      continue
    }
    seenIds.add(favorite.id)
    seenTexts.add(favorite.text)
    result.push(favorite)
    if (result.length >= MAX_FAVORITES) {
      break
    }
  }
  return result
}

export class FavoritePromptService {
  // الترتيب "الأحدث حفظًا الأول" — نفس ترتيب عرض المثبّتات.
  private favorites: FavoritePrompt[] = []
  private readonly filePath: string
  // سلسلة كتابة الملف: ترتيب مضمون من غير ما الكتابة تحجب الـ event loop
  private persistChain: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<FavoriteListener>()

  // مسار الملف متدخّل عشان الاختبار يشتغل في ملف مؤقت بدل data/favorites.json
  constructor(filePath = resolve(process.cwd(), "data", "favorites.json")) {
    this.filePath = filePath
    this.load()
  }

  list(): FavoritePrompt[] {
    return this.favorites.map((favorite) => ({ ...favorite }))
  }

  subscribe(listener: FavoriteListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // الحفظ idempotent: النص موجود بالفعل؟ نرجّع القائمة زي ما هي من غير نسخة
  // تانية ومن غير بثّ — الضغط المزدوج أو الحفظ من جهازين مايبقاش له أثر.
  // الـ id ممكن ييجي من العميل (نفس معرّف النسخة المتفائلة)، وبنشيل أي عنصر
  // قديم بنفس الـ id عشان المفاتيح تفضل فريدة مهما حصل إعادة إرسال.
  async add(value: unknown): Promise<FavoritePrompt[]> {
    const favorite = parseFavoritePrompt(value)
    if (this.favorites.some((item) => item.text === favorite.text)) {
      return this.list()
    }
    if (this.favorites.length >= MAX_FAVORITES && !this.favorites.some((item) => item.id === favorite.id)) {
      throw new Error("FAVORITES_FULL")
    }
    return this.commit([favorite, ...this.favorites.filter((item) => item.id !== favorite.id)])
  }

  // تعديل النص أو إعادة التسمية من غير ما المفضّلة تغيّر مكانها في القائمة.
  async update(id: unknown, value: unknown): Promise<FavoritePrompt[]> {
    const target = text(id, MAX_ID)
    const index = this.favorites.findIndex((favorite) => favorite.id === target)
    const current = index >= 0 ? this.favorites[index] : undefined
    if (!current) {
      throw new Error("FAVORITE_NOT_FOUND")
    }
    const patch = parseFavoritePatch(value)
    const nextText = patch.text ?? current.text
    // تعديل نص لمفضّلة تانية بنفس النص بيدّي نسختين — نرفض بصراحة بدل تكرار.
    if (nextText !== current.text && this.favorites.some((item, itemIndex) => itemIndex !== index && item.text === nextText)) {
      throw new Error("FAVORITE_EXISTS")
    }
    let nextLabel = patch.label !== undefined ? patch.label : current.label
    if (patch.text !== undefined && patch.label === undefined) {
      // النص اتغيّر من غير اسم صريح: لو الاسم كان لسه مشتقًا من النص القديم
      // (مش إعادة تسمية بإيد المستخدم) نحدّثه للنص الجديد.
      const derivedOld = favoriteLabelFromText(current.text)
      if (current.label === derivedOld) {
        nextLabel = favoriteLabelFromText(nextText)
      }
    }
    if (!nextLabel) {
      nextLabel = favoriteLabelFromText(nextText)
    }
    const next: FavoritePrompt = { ...current, text: nextText, label: nextLabel }
    const copy = [...this.favorites]
    copy[index] = next
    return this.commit(copy)
  }

  async remove(id: unknown): Promise<FavoritePrompt[]> {
    const target = text(id, MAX_ID)
    if (!target) {
      return this.list()
    }
    return this.commit(this.favorites.filter((favorite) => favorite.id !== target))
  }

  // نقطة الكتابة الوحيدة: بتحدّث الحالة والملف والمشاهدين. من غير تغيير
  // حقيقي مفيش كتابة على القرص ولا بثّ — فالحفظ المتكرر أو إزالة مفضّلة
  // مش موجودة مايبعتش ولا سطر على الشبكة.
  private async commit(next: FavoritePrompt[]): Promise<FavoritePrompt[]> {
    const changed = JSON.stringify(next) !== JSON.stringify(this.favorites)
    this.favorites = next
    if (!changed) {
      return this.list()
    }
    await this.persist()
    const snapshot = this.list()
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot)
      } catch {
        // مشاهد واحد مش لازم يوقع الباقي
      }
    }
    return snapshot
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return
    }
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<FavoritesFile>
      this.favorites = normalizeFavorites(data.favorites)
      if (Number(data.version) !== CURRENT_VERSION) {
        void this.persist()
      }
    } catch {
      this.favorites = []
    }
  }

  private persist(): Promise<void> {
    const write = async (): Promise<void> => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
        const data: FavoritesFile = { version: CURRENT_VERSION, favorites: this.favorites }
        await writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
      } catch {
        // التخزين اختياري — الفشل ما يوقعش الطلب
      }
    }
    this.persistChain = this.persistChain.then(write, write)
    return this.persistChain
  }
}
