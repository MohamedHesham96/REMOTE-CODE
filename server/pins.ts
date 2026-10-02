import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { directoryKey } from "./opencode/utils.js"
import type { PinnedConversation } from "./opencode/types.js"

// المثبّتات على السيرفر مش على المتصفح: كده نفس الشيرن على كل الأجهزة
// ولسه شايفة بعد ما المتصفح يعمل refresh أو السيرفر يرجع تاني. كل مثبّتة
// متربوطة بمشروعها بمعرّف ثابت (المسار المطبّع)، فكل مشروع بيشوف مثبّتاته
// هو بس — مفيش خلط ولا تكرار. localStorage في المتصفح بيفضل كاش للعرض الأول
// بس — مصدر الحقيقة هو الملف ده.

const CURRENT_VERSION = 2

interface PinsFile {
  version: number
  pins: PinnedConversation[]
}

// سقف عدد المثبّتات — يمنع الملف من النمو بلا حد
export const MAX_PINS = 200

const MAX_TITLE = 200
const MAX_PATH = 1024
const MAX_NAME = 200

// المشاهدين (بثّ SSE) والمحلّل (نسب المثبّتات القديمة لمشروعها)
export type PinListener = (pins: PinnedConversation[]) => void
export type PinProjectResolver = (sessionIds: string[]) => Promise<Map<string, { worktree: string; projectName?: string }>>

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

// معرّف المشروع الثابت = المسار المطبّع نفسه. project.id بيتغيّر مع الوقت
// وdirectory ممكن يبقى مجلد فرعي جوه المشروع، فالـ worktree هو المعرف
// الثابت الوحيد. المفتاح الفاضي = المشروع مجهول (لسه).
export function pinProjectKey(worktree: string, directory: string): string {
  return directoryKey(worktree) || directoryKey(directory)
}

// بيقرأ مدخلات العميل ويقرّر لو صالح: الـ id لازم موجود والباقي بيتقصّ.
// الرمي بدل التجاهل عشان العميل يعرف إن طلبه مرفوض بدل ما يتخزّن ناقص.
export function parsePinnedConversation(value: unknown): PinnedConversation {
  if (typeof value !== "object" || value === null) {
    throw new Error("INVALID_PIN")
  }
  const candidate = value as Partial<PinnedConversation>
  const id = text(candidate.id, 200)
  if (!id) {
    throw new Error("INVALID_PIN")
  }
  const created = typeof candidate.created === "number" && Number.isFinite(candidate.created)
    ? Math.trunc(candidate.created)
    : 0
  const directory = text(candidate.directory, MAX_PATH)
  const worktree = text(candidate.worktree, MAX_PATH)
  return {
    id,
    title: text(candidate.title, MAX_TITLE),
    created,
    directory,
    worktree,
    // بيتحسب على السيرفر من المسارات نفسها والعميل مش بيسبقه — كده مستحيل
    // محادثة تتنسب لمشروع تاني مهما País العميل في الطلب.
    projectKey: pinProjectKey(worktree, directory),
    projectName: text(candidate.projectName, MAX_NAME),
  }
}

function normalizePins(values: unknown): PinnedConversation[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set<string>()
  const result: PinnedConversation[] = []
  for (const value of values) {
    let pin: PinnedConversation
    try {
      pin = parsePinnedConversation(value)
    } catch {
      continue
    }
    if (seen.has(pin.id)) {
      continue
    }
    seen.add(pin.id)
    result.push(pin)
    if (result.length >= MAX_PINS) {
      break
    }
  }
  return result
}

export class PinService {
  // الترتيب "الأحدث تثبيتًا الأول" — نفس ترتيب العرض في اللوحة
  private pins: PinnedConversation[] = []
  private readonly filePath: string
  // سلسلة كتابة الملف: ترتيب مضمون من غير ما الكتابة تحجب الـ event loop
  private persistChain: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<PinListener>()
  private resolver: PinProjectResolver | null = null
  // نسبة واحدة جارية بس: الحلقات المتزامنة ما تتنافسش على نفس الـ pins
  private attributing = false
  private attributeAgain = false

  // مسار الملف متدخّل عشان الاختبار يقدر يشتغل في ملف مؤقت بدل data/pins.json
  constructor(filePath = resolve(process.cwd(), "data", "pins.json")) {
    this.filePath = filePath
    this.load()
  }

  // كل المثبّتات في كل المشاريع — المرآة الكاملة عشان العميل يقدر يبني
  // عداد كل مشروع ويفتح أي مثبّتة من غير ما يسأل السيرفر تاني.
  list(): PinnedConversation[] {
    return this.pins.map((pin) => ({ ...pin }))
  }

  // مثبّتات مشروع واحد بس. مشروع فاضي/مجهول = قائمة فاضية بالتصميم: أحسن
  // ما نعرضش محادثات مشروع تاني بالغلط.
  listForProject(project: unknown): PinnedConversation[] {
    const key = directoryKey(text(project, MAX_PATH))
    if (!key) {
      return []
    }
    return this.pins.filter((pin) => pin.projectKey === key).map((pin) => ({ ...pin }))
  }

  // يشترك في تغييرات المثبّتات (بثّ SSE للأجهزة كلها) ويرجّع دالة فك.
  subscribe(listener: PinListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // من يحل مشروع محادثات مش معروفة (كاش قديم من غير مسار) — بيتركّب مرة
  // واحدة في composition root وبيستدعى جوّه عند الحاجة بس.
  setProjectResolver(resolver: PinProjectResolver): void {
    this.resolver = resolver
    // لو في مثبّتات قديمة من غير مشروع، جرّب نسبها دلوقتي — مش ننتظر أول
    // تعديل عشان تظهر في لوحتها (وكمان عشان reconnects يجرّبو تاني).
    if (this.unattributed().length > 0) {
      void this.attributeMissing()
    }
  }

  // مثبّتات مالها مشروع لسه — محفوظة بالملف بس مش ظاهرة في أي مشروع.
  unattributed(): PinnedConversation[] {
    return this.pins.filter((pin) => !pin.projectKey).map((pin) => ({ ...pin }))
  }

  // تثبيت أو إعادة تثبيت: بتتحط في الأول. لو كانت مثبّتة أصلًا بنحدّث
  // بياناتها (العنوان بيتغيّر مع إعادة التسمية) وبنرجّعها لأول القائمة.
  async add(value: unknown): Promise<PinnedConversation[]> {
    const pin = parsePinnedConversation(value)
    return this.commit(normalizePins([pin, ...this.pins.filter((item) => item.id !== pin.id)]))
  }

  async remove(id: unknown): Promise<PinnedConversation[]> {
    const target = text(id, 200)
    if (!target) {
      return this.list()
    }
    return this.commit(this.pins.filter((pin) => pin.id !== target))
  }

  // شيل مجموعة ids مرة واحدة — بيتستخدم لما محادثة تتحذف. السيرفر هو مصدر
  // الحقيقة، فمش محتاجين كل جهاز ينضّف عنده.
  async forget(ids: unknown): Promise<PinnedConversation[]> {
    const removed = new Set(
      Array.isArray(ids) ? ids.map((item) => text(item, 200)).filter(Boolean) : [],
    )
    if (removed.size === 0) {
      return this.list()
    }
    return this.commit(this.pins.filter((pin) => !removed.has(pin.id)))
  }

  // دمج قادم من جهاز: اللي عندنا زي ما هو، والجاي الجديد بيتضاف وراه.
  // ده مسار المزامنة الوحيد: مفيش "استبدال كامل" عشان ما يمسحش مثبّتات
  // أجهزة تانية في أي تعارض. التكرار مستحيل: الـ id هو المفتاح.
  async merge(values: unknown): Promise<PinnedConversation[]> {
    const known = new Set(this.pins.map((pin) => pin.id))
    const incoming = normalizePins(values).filter((pin) => !known.has(pin.id))
    if (incoming.length === 0) {
      return this.list()
    }
    return this.commit(normalizePins([...this.pins, ...incoming]))
  }

  // ترقية مثبّتات قديمة من غير مشروع: نسأل OpenCode عن مكان كل محادثة
  // (طلب واحد للجميع) وننسبها لمشروعها عشان تظهر في لوحته. best effort —
  // أي فشل أو محادثة مش موجودة بتفضل متسجّلة ونتجرب تاني في الإقلاع الجاي.
  async attributeMissing(): Promise<number> {
    if (!this.resolver) {
      return 0
    }
    // طلب أثناء مرور شغال = لازم تاني بعده، عشان التعديل الجديد أو إعادة
    // الاتصال ما يضيعش
    if (this.attributing) {
      this.attributeAgain = true
      return 0
    }
    this.attributing = true
    try {
      let total = 0
      do {
        this.attributeAgain = false
        // الـ resolver بيتقرأ كل مرة: ممكن يتركّب/يتبدّل بين المرحلتين
        // (OpenCode لسه مش متصل، وبعدين اتصل) والمشكلة تتفتح تاني
        const resolver = this.resolver
        if (!resolver) {
          break
        }
        total += await this.attributeOnce(resolver)
      } while (this.attributeAgain)
      return total
    } finally {
      this.attributing = false
    }
  }

  private async attributeOnce(resolver: PinProjectResolver): Promise<number> {
    const pending = this.pins.filter((pin) => !pin.projectKey)
    if (pending.length === 0) {
      return 0
    }
    const found = await resolver(pending.map((pin) => pin.id)).catch(() => new Map())
    const resolved = new Map<string, PinnedConversation>()
    for (const pin of pending) {
      const worktree = text(found.get(pin.id)?.worktree, MAX_PATH)
      if (!worktree) {
        continue
      }
      const directory = pin.directory || worktree
      resolved.set(pin.id, {
        ...pin,
        directory,
        worktree,
        projectKey: pinProjectKey(worktree, directory),
        projectName: text(found.get(pin.id)?.projectName, MAX_NAME) || pin.projectName,
      })
    }
    if (resolved.size === 0) {
      return 0
    }
    // من غير attribute: جوه المرور نفسه، واللي قدر عليه الـ resolver جربناه
    // بالفعل — التكرار هنا طلب فاضي
    await this.commit(this.pins.map((pin) => resolved.get(pin.id) || pin), { attribute: false })
    return resolved.size
  }

  // نقطة الكتابة الوحيدة: بتحدّث الحالة والملف والمشاهدين. من غير تغيير
  // حقيقي مفيش كتابة على القرص ولا بثّ — فالتعديل المكرر (تثبيت مثبّتة،
  // إزالة مش مثبّتة) ما بيبعتش ولا سطر على الشبكة.
  private async commit(
    next: PinnedConversation[],
    options: { attribute?: boolean } = {},
  ): Promise<PinnedConversation[]> {
    const changed = JSON.stringify(next) !== JSON.stringify(this.pins)
    this.pins = next
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
    if (options.attribute !== false && this.resolver && this.unattributed().length > 0) {
      void this.attributeMissing()
    }
    return snapshot
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return
    }
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<PinsFile>
      // v1 (من غير projectKey) و v0 (من غير نسخة) بيتقرأوا عادي: معرّف
      // المشروع بيتحسب من المسارات وقت التحميل. الملف القديم بيتكتب من
      // جديد بالنسخة الجديدة فورًا عشان الترقية ماتتكررش كل إقلاع.
      this.pins = normalizePins(data.pins)
      if (Number(data.version) !== CURRENT_VERSION) {
        void this.persist()
      }
    } catch {
      this.pins = []
    }
  }

  private persist(): Promise<void> {
    const write = async (): Promise<void> => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
        const data: PinsFile = { version: CURRENT_VERSION, pins: this.pins }
        await writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
      } catch {
        // التخزين اختياري — الفشل ما يوقعش الطلب
      }
    }
    this.persistChain = this.persistChain.then(write, write)
    return this.persistChain
  }
}
