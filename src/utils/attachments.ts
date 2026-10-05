import type { Strings } from "../i18n"
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

export type AttachmentRejection = AttachmentLimitError | "unsupported" | "imageDisabled" | "pdfDisabled" | "readFailed"

export interface AttachmentAddResult {
  attachments: ComposerAttachment[]
  rejection: AttachmentRejection | null
}

// إضافة ملفات للمرفقات: تحقق النوع، ثم قدرة النموذج، ثم الحدود، وأخيراً القراءة.
// أول ملف مرفوض هو اللي بيحدد رسالة الخطأ، والباقي بياخد فرصته عادي.
export async function addAttachmentFiles(
  existing: ComposerAttachment[],
  files: readonly File[],
  supports: { image: boolean; pdf: boolean },
): Promise<AttachmentAddResult> {
  const next = [...existing]
  let rejection: AttachmentRejection | null = null
  for (const file of files) {
    const modality = attachmentModality(file.name, file.type)
    if (!modality) {
      rejection ??= "unsupported"
      continue
    }
    if (modality === "image" && !supports.image) {
      rejection ??= "imageDisabled"
      continue
    }
    if (modality === "pdf" && !supports.pdf) {
      rejection ??= "pdfDisabled"
      continue
    }
    const limit = attachmentLimitError(next, file.size)
    if (limit) {
      rejection ??= limit
      continue
    }
    try {
      next.push({
        id: attachmentId(),
        name: file.name || "file",
        mime: file.type || "application/octet-stream",
        size: file.size,
        uri: await readFileAsDataUrl(file),
      })
    } catch {
      rejection ??= "readFailed"
    }
  }
  return { attachments: next, rejection }
}

export function attachmentRejectionMessage(rejection: AttachmentRejection, t: Strings): string {
  switch (rejection) {
    case "imageDisabled":
      return t.attachImageDisabled
    case "pdfDisabled":
      return t.attachPdfUnsupported
    case "tooMany":
      return t.attachmentTooMany
    case "tooLarge":
      return t.attachmentTooLarge
    case "totalTooLarge":
      return t.attachmentTotalTooLarge
    case "readFailed":
      return t.attachmentReadFailed
    default:
      return t.attachmentUnsupported
  }
}

// استخراج الملفات من حافظة النظام عند اللصق. بعض المتصفحات بتحط الملف في
// items وبعضها في files، فبنجرّب items الأول ونرجع لـ files عند الفراغ.
// العناصر النصية (kind !== "file") بتتخطى عشان اللصق النصي العادي ما يتأثرش.
export function clipboardFiles(clipboard: DataTransfer): File[] {
  const fromItems: File[] = []
  for (const item of Array.from(clipboard.items)) {
    if (item.kind !== "file") {
      continue
    }
    const file = item.getAsFile()
    if (file) {
      fromItems.push(file)
    }
  }
  if (fromItems.length > 0) {
    return fromItems
  }
  return Array.from(clipboard.files)
}

// قراءة الصور من الحافظة عبر Clipboard API غير المتزامن. الأهم إنها تتنادى
// من جوّه حدث اللصق نفسه، لأن سياق اللصق الموثوق بيدّي إذن القراءة بدون
// طلب — ودي الطريقة اللي بتشتغل على الموبايل لما فعل اللصق مايوصّلش ملفات.
export async function readClipboardFiles(): Promise<File[]> {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.read !== "function") {
    return []
  }
  try {
    const items = await navigator.clipboard.read()
    const files: File[] = []
    for (const item of items) {
      const type = item.types.find((candidate) => candidate.startsWith("image/"))
      if (!type) {
        continue
      }
      const blob = await item.getType(type)
      files.push(new File([blob], `clipboard.${type.split("/")[1] || "png"}`, { type }))
    }
    return files
  } catch {
    // رفض إذن أو حافظة فاضية — مفيش حاجة نضيفها
    return []
  }
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
