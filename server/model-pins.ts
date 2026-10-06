import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

// مثبّتات النماذج على السيرفر مش على المتصفح: نفس منطق مثبّتات المحادثات —
// التثبيت من الموبايل يوصل للويب والعكس، ويفضل موجود بعد الـ refresh. قبل
// كده الكاش في localStorage كان بيضيع مع كل جهاز.
//
// الفرق عن مثبّتات المحادثات إن النماذج الكتالوج العام مش جوه مشروع، فمفيش
// projectKey ولا عناوين ولا نسبة لمشاريع — كل مثبّت مفتاح نصي واحد
// "providerID/modelID" بقائمة عالمية وسقف صغير عشان القسم العلوي في منتقي
// النماذج يفضل مفيدًا بدل ما يبقى قائمة تانية.

const CURRENT_VERSION = 1

interface ModelPinsFile {
  version: number
  models: string[]
}

// سقف عدد المثبّتات — لازم يطابق PINNED_MODELS_LIMIT في src/constants.ts.
// اختلاف السقف بين السيرفر والعميل معناه قسم فوقي بيعدّ غلط في الواجهة.
export const MAX_PINNED_MODELS = 5

// المفتاح أطول من معرّف الموديل نفسه (OpenRouter بيستخدم "openai/gpt-4o"
// جوه الـ modelID)، فالسقف واسع ويقصّ بعد ما نتحقق إن المفتاح شكله صح.
const MAX_KEY = 300

// المشاهدين (بثّ SSE) — نفس عقدة مثبّتات المحادثات، بس القائمة نصوص.
export type ModelPinListener = (models: string[]) => void

// بيقرأ المفتاح من العميل ويقرّر لو صالح: لازم "providerID/modelID" بالظبط
// (الفصل أول شرطة، والباقي كله الـ modelID عشان معرّفات OpenRouter فيها
// شرطات). الرمي بدل التجاهل عشان العميل يعرف إن طلبه مرفوض بدل ما يتخزّن
// مفتاح مالوش موديل يقابله ويطلع قسم فاضي. الحد الأقصى 300 محرف بيقصّ بعد
// الفحص: مفتاح أطول من كده بيتبرّ، ويقصّ بعد الفحص عشان القصّ الأول ممكن
// يقطع الشرطة فيبقى رفض غامض لمجرد إن المفتاح طويل.
export function parseModelPinKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("INVALID_MODEL_PIN")
  }
  const key = value.trim()
  const slash = key.indexOf("/")
  if (slash <= 0 || slash === key.length - 1) {
    throw new Error("INVALID_MODEL_PIN")
  }
  return key.slice(0, MAX_KEY)
}

function normalizeModels(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    let key: string
    try {
      key = parseModelPinKey(value)
    } catch {
      continue
    }
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(key)
    if (result.length >= MAX_PINNED_MODELS) {
      break
    }
  }
  return result
}

export class ModelPinService {
  // الترتيب "الأحدث تثبيتًا الأول" — نفس ترتيب العرض في المنتقي ونفس قاعدة
  // مثبّتات المحادثات.
  private models: string[] = []
  private readonly filePath: string
  // سلسلة كتابة الملف: ترتيب مضمون من غير ما الكتابة تحجب الـ event loop
  private persistChain: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<ModelPinListener>()

  // مسار الملف متدخّل عشان الاختبار يقدر يشتغل في ملف مؤقت بدل data/model-pins.json
  constructor(filePath = resolve(process.cwd(), "data", "model-pins.json")) {
    this.filePath = filePath
    this.load()
  }

  list(): string[] {
    return [...this.models]
  }

  subscribe(listener: ModelPinListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async add(value: unknown): Promise<string[]> {
    const key = parseModelPinKey(value)
    // السقف رفض مش اقتطاع: القائمة وصلت الحد فأي تقطيع هيمسح تثبيت
    // جهاز تاني من غير ما حد طلبه. العميل بيمنع الأصل، فده شبكة أمان لأجهزة
    // عندها نسخة قديمة أو ضغط متزامن على جهازين.
    if (!this.models.includes(key) && this.models.length >= MAX_PINNED_MODELS) {
      throw new Error("MODEL_PINS_FULL")
    }
    return this.commit(normalizeModels([key, ...this.models.filter((item) => item !== key)]))
  }

  async remove(value: unknown): Promise<string[]> {
    const key = parseModelPinKey(value)
    return this.commit(this.models.filter((item) => item !== key))
  }

  // دمج قادم من جهاز: اللي عندنا زي ما هو، والجاي الجديد بيتضاف وراه. ده
  // مسار مزامنة الكاش القديم بس (ترقية) — مفيش "استبدال كامل" عشان ما يمسحش
  // تثبيت جهاز تاني في أي تعارض. التكرار مستحيل: المفتاح نفسه هو الهوية.
  async merge(values: unknown): Promise<string[]> {
    const known = new Set(this.models)
    const incoming = normalizeModels(values).filter((key) => !known.has(key))
    if (incoming.length === 0) {
      return this.list()
    }
    return this.commit(normalizeModels([...this.models, ...incoming]))
  }

  // نقطة الكتابة الوحيدة: بتحدّث الحالة والملف والمشاهدين. من غير تغيير
  // حقيقي مفيش كتابة على القرص ولا بثّ — فالتعديل المكرر (تثبيت مثبّت أو
  // إزالة مش مثبّت) ما بيبعتش ولا سطر على الشبكة.
  private async commit(next: string[]): Promise<string[]> {
    const changed = JSON.stringify(next) !== JSON.stringify(this.models)
    this.models = next
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
      const data = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<ModelPinsFile>
      this.models = normalizeModels(data.models)
      if (Number(data.version) !== CURRENT_VERSION) {
        void this.persist()
      }
    } catch {
      this.models = []
    }
  }

  private persist(): Promise<void> {
    const write = async (): Promise<void> => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
        const data: ModelPinsFile = { version: CURRENT_VERSION, models: this.models }
        await writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
      } catch {
        // التخزين اختياري — الفشل ما يوقعش الطلب
      }
    }
    this.persistChain = this.persistChain.then(write, write)
    return this.persistChain
  }
}