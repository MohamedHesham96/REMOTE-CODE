import type { Strings } from "../../i18n"
import type { RequestAttachment } from "../../types"

// مرفقات الطلب اللي أرسلها المستخدم من الهاتف. الصور تتعرض مصغّرة كي يراها
// المستخدم كما أرسلها، والملفات تتعرض كشريط باسمها. الغرض عرضي بحت — المحرك
// عنده المحتوى أصلًا، فهنا ما فيش تحميل ولا فتح.
export function RequestAttachmentsList({ attachments, t }: { attachments: RequestAttachment[]; t: Strings }) {
  if (attachments.length === 0) {
    return null
  }
  return (
    <div className="request-attachments" aria-label={t.requestAttachments}>
      {attachments.map((attachment, index) => {
        const isImage = attachment.mime.startsWith("image/") && attachment.uri
        return (
          <div className="request-attachment" key={`${attachment.name}-${index}`}>
            {isImage ? (
              <img className="request-attachment-thumb" src={attachment.uri} alt={attachment.name} />
            ) : (
              <span className="request-attachment-icon" aria-hidden>
                {attachment.mime === "application/pdf" ? "PDF" : "📄"}
              </span>
            )}
            <span className="request-attachment-name" dir="ltr" title={attachment.name}>{attachment.name}</span>
          </div>
        )
      })}
    </div>
  )
}
