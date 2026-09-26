import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { PinnedConversation } from "./opencode/types.js"

// المثبّتات على السيرفر مش على المتصفح: كده نفس الشيرن على كل الأجهزة،
// ولوحة المثبّتات برضه شايفة محادثات كل المشاريع لا المشروع الحالي بس.
// localStorage في المتصفح بيفضل كاش للعرض الأول بس — مصدر الحقيقة هو الملف ده.

interface PinsFile {
  version: 1
  pins: PinnedConversation[]
}

// سقف عدد المثبّتات — يمنع الملف من النمو بلا حد
export const MAX_PINS = 200

const MAX_TITLE = 200
const MAX_PATH = 1024
const MAX_NAME = 200

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
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
  return {
    id,
    title: text(candidate.title, MAX_TITLE),
    created,
    directory: text(candidate.directory, MAX_PATH),
    worktree: text(candidate.worktree, MAX_PATH),
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

  // مسار الملف متدخّل عشان الاختبار يقدر يشتغل في ملف مؤقت بدل data/pins.json
  constructor(filePath = resolve(process.cwd(), "data", "pins.json")) {
    this.filePath = filePath
    this.load()
  }

  list(): PinnedConversation[] {
    return this.pins.map((pin) => ({ ...pin }))
  }

  // تثبيت أو إعادة تثبيت: بتتحط في الأول. لو كانت مثبّتة أصلًا بنحدّث
  // بياناتها (العنوان بيتغيّر مع إعادة التسمية) وبنرجّعها لأول القائمة.
  async add(value: unknown): Promise<PinnedConversation[]> {
    const pin = parsePinnedConversation(value)
    this.pins = normalizePins([pin, ...this.pins.filter((item) => item.id !== pin.id)])
    await this.persist()
    return this.list()
  }

  async remove(id: unknown): Promise<PinnedConversation[]> {
    const target = text(id, 200)
    const next = target ? this.pins.filter((pin) => pin.id !== target) : this.pins
    if (next.length === this.pins.length) {
      return this.list()
    }
    this.pins = next
    await this.persist()
    return this.list()
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
    const next = this.pins.filter((pin) => !removed.has(pin.id))
    if (next.length === this.pins.length) {
      return this.list()
    }
    this.pins = next
    await this.persist()
    return this.list()
  }

  // استبدال كامل: احتياطي بس لعميل فقد تعديلاته المحلية وعايز يرجّع
  // الحالة المحفوظة عنده. آخر كتابة تفوز (الجهاز مستخدم واحد غالبًا).
  async replace(values: unknown): Promise<PinnedConversation[]> {
    this.pins = normalizePins(values)
    await this.persist()
    return this.list()
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return
    }
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<PinsFile>
      this.pins = normalizePins(data.pins)
    } catch {
      this.pins = []
    }
  }

  private persist(): Promise<void> {
    const write = async (): Promise<void> => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
        const data: PinsFile = { version: 1, pins: this.pins }
        await writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
      } catch {
        // التخزين اختياري — الفشل ما يوقعش الطلب
      }
    }
    this.persistChain = this.persistChain.then(write, write)
    return this.persistChain
  }
}
