import { useRef } from "react"
import type { Strings } from "../i18n"
import type { ComposerAttachment } from "../types"
import {
  IMAGE_ACCEPT,
  attachmentId,
  attachmentLimitError,
  attachmentModality,
  documentAccept,
  formatBytes,
  readFileAsDataUrl,
  type AttachmentLimitError,
} from "../utils/attachments"

interface ComposerAttachmentsProps {
  attachments: ComposerAttachment[]
  // قدرات النموذج المختار: بتقفل زرار الصورة أو PDF. النص متاح دايماً.
  supportsImage: boolean
  supportsPdf: boolean
  disabled: boolean
  onChange: (attachments: ComposerAttachment[]) => void
  onError: (message: string) => void
  t: Strings
}

function limitMessage(limit: AttachmentLimitError, t: Strings): string {
  if (limit === "tooLarge") {
    return t.attachmentTooLarge
  }
  if (limit === "totalTooLarge") {
    return t.attachmentTotalTooLarge
  }
  return t.attachmentTooMany
}

// مرفقات الكومبوزر: زرار صورة وزرار ملف + شرائط المرفقات المختارة.
// القراءة بتحصل هنا (data URL مضمّن) والتحقق قبلها عشان ما نقراش ملف
// مرفوض أصلاً. القفل حسب قدرات النموذج — الواجهة والسيرفر يتحققوا مع بعض.
export function ComposerAttachments({ attachments, supportsImage, supportsPdf, disabled, onChange, onError, t }: ComposerAttachmentsProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSelection = async (list: FileList | null, kind: "image" | "document"): Promise<void> => {
    if (!list || list.length === 0) {
      return
    }
    const next = [...attachments]
    const rejected: string[] = []
    for (const file of Array.from(list)) {
      const modality = attachmentModality(file.name, file.type)
      if (!modality || (kind === "image" && modality !== "image")) {
        rejected.push(t.attachmentUnsupported)
        continue
      }
      if (modality === "image" && !supportsImage) {
        rejected.push(t.attachImageDisabled)
        continue
      }
      if (modality === "pdf" && !supportsPdf) {
        rejected.push(t.attachPdfUnsupported)
        continue
      }
      const limit = attachmentLimitError(next, file.size)
      if (limit) {
        rejected.push(limitMessage(limit, t))
        continue
      }
      try {
        const uri = await readFileAsDataUrl(file)
        next.push({
          id: attachmentId(),
          name: file.name || "file",
          mime: file.type || "application/octet-stream",
          size: file.size,
          uri,
        })
      } catch {
        rejected.push(t.attachmentReadFailed)
      }
    }
    if (next.length !== attachments.length) {
      onChange(next)
    }
    if (rejected.length > 0) {
      onError(rejected[0])
    }
  }

  const reset = (ref: { current: HTMLInputElement | null }): void => {
    if (ref.current) {
      ref.current.value = ""
    }
  }

  return (
    <>
      {attachments.length > 0 ? (
        <div className="attachments-strip" aria-label={t.attachmentsAria}>
          {attachments.map((attachment) => (
            <div className="attachment-chip" key={attachment.id}>
              {attachment.mime.startsWith("image/") ? (
                <img className="attachment-thumb" src={attachment.uri} alt="" />
              ) : (
                <span className="attachment-file-icon" aria-hidden="true">{attachment.mime === "application/pdf" ? "PDF" : "TXT"}</span>
              )}
              <span className="attachment-meta">
                <span className="attachment-name" dir="ltr">{attachment.name}</span>
                <span className="attachment-size">{formatBytes(attachment.size)}</span>
              </span>
              <button
                type="button"
                className="attachment-remove"
                onClick={() => onChange(attachments.filter((item) => item.id !== attachment.id))}
                aria-label={t.removeAttachment}
                title={t.removeAttachment}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <input
        ref={imageInputRef}
        className="attachment-input"
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        onChange={(event) => {
          void handleSelection(event.target.files, "image")
          reset(imageInputRef)
        }}
      />
      <input
        ref={fileInputRef}
        className="attachment-input"
        type="file"
        accept={documentAccept(supportsPdf)}
        multiple
        onChange={(event) => {
          void handleSelection(event.target.files, "document")
          reset(fileInputRef)
        }}
      />
      <button
        type="button"
        className="attach-button"
        disabled={disabled || !supportsImage}
        onClick={() => imageInputRef.current?.click()}
        aria-label={t.attachImage}
        title={!supportsImage ? t.attachImageDisabled : t.attachImage}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </button>
      <button
        type="button"
        className="attach-button"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        aria-label={t.attachFile}
        title={t.attachFile}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
    </>
  )
}
