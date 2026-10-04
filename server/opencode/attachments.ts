// تحقق مرفقات الطلب. الشكل السلكي: { uri, name? } حيث `uri` رابط data:
// مضمّن — OpenCode ما بيدعمش روابط HTTP في المرفقات، وملفات المتصفح مش
// متاحة للمحرك، فالترميز المضمّن هو الطريق الوحيد من الهاتف. التحقق هنا
// دفاع بالعمق: الواجهة بتقفل الأنواع غير المدعومة أصلاً، والسيرفر يرفض
// الحمولات التالفة أو الأكبر من سقف الحمولة قبل ما توصل للمحرك.

export const MAX_ATTACHMENT_COUNT = 5
// سقف المرفق الواحد (حجم سلسلة الـ data URI بعد الترميز). OpenCode بيعيد
// ضغط الصور الكبيرة بنفسه؛ السقف هنا لحماية حمولة الـ JSON من التضخّم.
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024
// السقف الكلي تحت حد express.json (8MB) بهامش أمان.
export const MAX_TOTAL_ATTACHMENT_BYTES = 7 * 1024 * 1024

export type AttachmentModality = "image" | "pdf" | "text"

export interface ParsedAttachment {
  uri: string
  name?: string
  modality: AttachmentModality
}

export type ParseAttachmentsResult =
  | { ok: true; attachments: ParsedAttachment[] }
  | { ok: false; reason: "tooMany" | "invalid" | "tooLarge" }

const DATA_URI = /^data:([^;,]*)[^,]*,/

// نوع mime من رأس رابط data: — الأساس لتصنيف المرفق (صورة / PDF / نص).
export function mimeFromDataUri(uri: string): string | null {
  const match = DATA_URI.exec(uri)
  if (!match) {
    return null
  }
  const mime = (match[1] ?? "").trim().toLowerCase()
  return mime || null
}

// تصنيف المرفق حسب نوعه. النص هو الافتراضي لأن أي مرفق غير صورة/PDF
// بيتعامل كنص، والموديل بيقرا محتواه.
export function attachmentModality(mime: string): AttachmentModality {
  if (mime.startsWith("image/")) {
    return "image"
  }
  if (mime === "application/pdf") {
    return "pdf"
  }
  return "text"
}

export function parseRequestAttachments(raw: unknown): ParseAttachmentsResult {
  if (raw === undefined || raw === null) {
    return { ok: true, attachments: [] }
  }
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "invalid" }
  }
  if (raw.length > MAX_ATTACHMENT_COUNT) {
    return { ok: false, reason: "tooMany" }
  }
  const attachments: ParsedAttachment[] = []
  let total = 0
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, reason: "invalid" }
    }
    const candidate = entry as { uri?: unknown; name?: unknown }
    if (typeof candidate.uri !== "string" || !candidate.uri.startsWith("data:")) {
      return { ok: false, reason: "invalid" }
    }
    const mime = mimeFromDataUri(candidate.uri)
    if (!mime) {
      return { ok: false, reason: "invalid" }
    }
    const size = Buffer.byteLength(candidate.uri, "utf8")
    if (size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, reason: "tooLarge" }
    }
    total += size
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { ok: false, reason: "tooLarge" }
    }
    const name = typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.trim().slice(0, 200)
      : undefined
    attachments.push({ uri: candidate.uri, ...(name ? { name } : {}), modality: attachmentModality(mime) })
  }
  return { ok: true, attachments }
}

// أول مرفق مش مدعوم من قدرات النموذج (غير النص، فالنص مقبول دايماً).
// بيرجّع null لو كل المرفقات مدعومة.
export function unsupportedAttachment(attachments: ParsedAttachment[], input: string[]): ParsedAttachment | null {
  const allowed = new Set(input)
  for (const attachment of attachments) {
    if (attachment.modality === "text") {
      continue
    }
    if (!allowed.has(attachment.modality)) {
      return attachment
    }
  }
  return null
}
