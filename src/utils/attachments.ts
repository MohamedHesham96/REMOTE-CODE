import type { ComposerAttachment, ModelInfo } from "../types"

// مرفقات الكومبوزر: صور وملفات نصية وPDF. الحدود هنا بتحمي من تجاوز سقف
// السيرفر (data URI مضمّن) وبتدي المستخدم رسالة واضحة قبل الإرسال.
// صورة 4MB خام بتصبح ~5.3MB كـ base64، وسقف المرفق على السيرفر 6MB.
export const MAX_ATTACHMENT_COUNT = 5
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_BYTES = 5 * 1024 * 1024

export type AttachmentModality = "image" | "pdf" | "text"

// قبول حقل الصور وحقل الملفات. النص متاح دايماً لأن كل الموديلات بتدعمه؛
// PDF يظهر في القائمة بس لما النموذج يدعمه.
export const IMAGE_ACCEPT = "image/*"
const TEXT_ACCEPT = ".txt,.text,.md,.markdown,.json,.csv,.log,.xml,.yml,.yaml,.ini,.toml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.c,.h,.cpp,.hpp,.sql,.sh,.bat,.ps1,text/*"
const PDF_ACCEPT = ".pdf,application/pdf"
const TEXT_EXTENSIONS = /\.(txt|text|md|markdown|json|csv|log|xml|ya?ml|ini|toml|html?|css|js|jsx|ts|tsx|py|java|go|rs|c|h|cpp|hpp|sql|sh|bat|ps1)$/i

export function documentAccept(supportsPdf: boolean): string {
  return supportsPdf ? `${PDF_ACCEPT},${TEXT_ACCEPT}` : TEXT_ACCEPT
}

// تصنيف الملف حسب نوعه واسمه. null = نوع غير مقبول (سيرفض قبل القراءة).
export function attachmentModality(name: string, mime: string): AttachmentModality | null {
  if (mime.startsWith("image/")) {
    return "image"
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
    return "pdf"
  }
  if (
    mime.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
    || mime === "application/x-yaml"
    || TEXT_EXTENSIONS.test(name)
  ) {
    return "text"
  }
  return null
}

// النص مقبول مع أي نموذج؛ الصورة وPDF حسب قدرات إدخال النموذج. غياب
// القدرات = غير معروف، فنعتبرها غير مدعومة (المحرك نفسه مش هيقبلها).
export function modelSupports(model: ModelInfo | null | undefined, modality: AttachmentModality): boolean {
  if (modality === "text") {
    return true
  }
  return Boolean(model?.capabilities?.input?.includes(modality))
}

export type AttachmentLimitError = "tooMany" | "tooLarge" | "totalTooLarge"

export function attachmentLimitError(existing: ComposerAttachment[], size: number): AttachmentLimitError | null {
  if (existing.length >= MAX_ATTACHMENT_COUNT) {
    return "tooMany"
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return "tooLarge"
  }
  const total = existing.reduce((sum, item) => sum + item.size, 0) + size
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    return "totalTooLarge"
  }
  return null
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

let attachmentSeq = 0

export function attachmentId(): string {
  attachmentSeq += 1
  return `att-${Date.now().toString(36)}-${attachmentSeq}`
}

// قراءة الملف كـ data URL مضمّن — نفس الشكل اللي OpenCode بيقبله في files.
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "")
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read file"))
    }
    reader.readAsDataURL(file)
  })
}
