import { extname, basename as pathBasename } from "node:path"
import type { Part, Project } from "@opencode-ai/sdk"
import type { SessionModelRef } from "./types.js"

// ── دوال خالصة (pure) مستخرجة من opencode.ts — بلا حالة ولا IO ──

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; data?: { message?: unknown } }
    if (typeof candidate.data?.message === "string") {
      return candidate.data.message
    }
    if (typeof candidate.message === "string") {
      return candidate.message
    }
  }

  return "OpenCode request failed"
}

export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error) {
    throw new Error(errorMessage(result.error))
  }

  if (result.data === undefined) {
    throw new Error("OpenCode returned an empty response")
  }

  return result.data
}

export function textFromParts(parts: Part[]): string {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.synthetic)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
}

export function stripMobileSuffix(title: string): string {
  return title.replace(/\s*\(mobile\)\s*$/i, "").trim()
}

export function isDefaultTitle(title: string | undefined | null): boolean {
  const clean = stripMobileSuffix((title || "").trim())
  if (!clean) {
    return true
  }
  const lower = clean.toLowerCase()
  return clean === "محادثة جديدة"
    || clean === "محادثة"
    || clean === "محادثة بدون عنوان"
    || lower === "new session"
    || lower === "untitled"
    || lower.startsWith("new session -")
    || lower.startsWith("new session (")
}

export function titleFromUserText(text: string): string {
  const firstLine = (text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ""
  const collapsed = firstLine.replace(/\s+/g, " ").trim()
  if (!collapsed) {
    return ""
  }
  const maxLength = 60
  if (collapsed.length <= maxLength) {
    return collapsed
  }
  const sliced = collapsed.slice(0, maxLength).trimEnd()
  const lastSpace = sliced.lastIndexOf(" ")
  const cut = lastSpace > 30 ? sliced.slice(0, lastSpace) : sliced
  return `${cut}…`
}

export function projectUpdatedAt(project: Project): number {
  const time = project.time as Project["time"] & { updated?: number }
  return time.updated || time.initialized || time.created
}

export function directoryKey(directory: string): string {
  return directory.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
}

export function isChildDirectory(directory: string, parent: string): boolean {
  const child = directoryKey(directory)
  const root = directoryKey(parent)
  return child !== root && child.startsWith(`${root}/`)
}

export function isFreeCost(input: number, output: number, cacheRead: number, cacheWrite: number): boolean {
  return (input || 0) === 0 && (output || 0) === 0 && (cacheRead || 0) === 0 && (cacheWrite || 0) === 0
}

export function parseModelString(value: string | undefined | null): SessionModelRef | null {
  const clean = (value || "").trim()
  if (!clean || !clean.includes("/")) {
    return null
  }
  const slash = clean.indexOf("/")
  const providerID = clean.slice(0, slash).trim()
  const modelID = clean.slice(slash + 1).trim()
  if (!providerID || !modelID) {
    return null
  }
  return { providerID, modelID }
}

export const MAX_FILE_DOWNLOAD_BYTES = 25 * 1024 * 1024

// قائمة الـ variants نادرًا ما تتغير، فبنخزّنها 5 دقايق بدل ما نطلبها كل مرة
export const VARIANTS_CACHE_MS = 5 * 60 * 1000

// كاش قصير لقائمة النشاط: الـ poll بيجي كل ٤ ثواني من كل عميل، فالتخزين
// ٣ ثواني بيحوّل العاصفة لـ upstream call واحد لكل نافذة بدل N عملاء × N مشاريع
export const ACTIVITY_CACHE_MS = 3000

// كاش قائمة الموديلات كاملة (مش الـ variants بس): الـ endpoints بطيئة ومتتكررة
export const MODELS_CACHE_MS = 5 * 60 * 1000

// كاش قوائم الأسئلة: بتتقرأ مع كل poll للـ requests، وبتتبطل مع أحداث الأسئلة
export const QUESTIONS_CACHE_MS = 2000

// سقف عملاء SDK المحفوظين لكل directory — منع نمو غير محدود للذاكرة
export const MAX_CACHED_CLIENTS = 12

// ترتيب معروف لمستويات التفكير، عشان الكيبس تظهر بترتيب متوقع مش أبجدي
export const VARIANT_ORDER = ["minimal", "none", "low", "medium", "high", "xhigh", "max"]

// OpenCode بيرجّع الـ variants بشكلين حسب الـ endpoint:
// - object map: { low: { reasoningEffort: "low" }, ... }  (من /config/providers)
// - array:       [ { id: "low", ... }, ... ]                (من كتالوج v2)
export function variantIds(value: unknown): string[] | undefined {
  const ids: string[] = []
  if (Array.isArray(value)) {
    for (const entry of value) {
      const id = typeof (entry as { id?: unknown })?.id === "string" ? (entry as { id: string }).id.trim() : ""
      if (id) {
        ids.push(id)
      }
    }
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      const id = key.trim()
      if (id) {
        ids.push(id)
      }
    }
  }
  return ids.length > 0 ? [...new Set(ids)] : undefined
}

// ترتيب العرض: المستويات المعروفة أولًا بترتيبها، وبعدها أي اسم تاني أبجديًا
export function sortVariants(variants: string[]): string[] {
  return [...variants].sort((a, b) => {
    const left = VARIANT_ORDER.indexOf(a)
    const right = VARIANT_ORDER.indexOf(b)
    if (left !== -1 && right !== -1) {
      return left - right
    }
    if (left !== -1) {
      return -1
    }
    if (right !== -1) {
      return 1
    }
    return a.localeCompare(b)
  })
}

// OpenCode بيقسّم المهمة الواحدة لرسائل assistant متتالية: كل خطوة/أداة
// بتقفل رسالة (completedAt يتسجل) ويفتح اللي بعدها. فـ completedAt > 0
// لوحده مش معناه إن المهمة خلصت — لازم نتأكد إن مفيش رسالة مفتوحة
// وإن آخر تحديث قديم (مفيش نشاط جديد جاي). غير كده كل خطوة هتتفهم
// "إتمام" والقائمة هتتنطط working ⇄ ready والصوت هيتكرر كل خطوة.
export const STALE_BUSY_GRACE_MS = 20_000

// بعد كام محاولة فاشلة بنسقط الطلب من الطابور بدل ما نفضل نعيد تجربته
export const MAX_PROMPT_ATTEMPTS = 3

// بادئة الـ id اللي بتظهر بيه الطلبات المستنية في كروت المحادثة
export const QUEUED_ID_PREFIX = "queued:"

// الواجهة بتبع الـ id بالبادئة دي، فبنشيلها قبل ما نطابقه بالـ id الداخلي
export function queuedItemId(requestId: string): string {
  return requestId.startsWith(QUEUED_ID_PREFIX) ? requestId.slice(QUEUED_ID_PREFIX.length) : requestId
}

const mimeByExtension: Record<string, string> = {
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export function mimeFromName(name: string, fallback = "application/octet-stream"): string {
  const extension = extname(name || "").toLowerCase()
  return mimeByExtension[extension] || fallback
}

export function fileNameFromPath(path: string, fallback: string): string {
  const base = pathBasename(path.replace(/\\/g, "/")).trim()
  return base || fallback
}
