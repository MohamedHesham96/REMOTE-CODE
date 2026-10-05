import { useRef } from "react"
import type { Strings } from "../i18n"
import type { ComposerAttachment } from "../types"
import {
  IMAGE_ACCEPT,
  addAttachmentFiles,
  attachmentRejectionMessage,
  documentAccept,
  formatBytes,
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

// مرفقات الكومبوزر: زرار صورة وزرار ملف + شرائط المرفقات المختارة.
// القراءة والتحقق بتحصلوا في addAttachmentFiles، وهو نفسه اللي بيخدم اللصق
// من الحافظة عشان القواعد ما تتكررش.
export function ComposerAttachments({ attachments, supportsImage, supportsPdf, disabled, onChange, onError, t }: ComposerAttachmentsProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = async (list: readonly File[]): Promise<void> => {
    if (list.length === 0) {
      return
    }
    const { attachments: next, rejection } = await addAttachmentFiles(attachments, list, { image: supportsImage, pdf: supportsPdf })
    if (next.length !== attachments.length) {
      onChange(next)
    }
    if (rejection) {
      onError(attachmentRejectionMessage(rejection, t))
    }
  }

  const handleSelection = async (list: FileList | null): Promise<void> => {
    if (list) {
      await addFiles(Array.from(list))
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
          void handleSelection(event.target.files)
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
          void handleSelection(event.target.files)
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
