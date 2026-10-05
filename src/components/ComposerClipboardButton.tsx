import { useState } from "react"
import type { Strings } from "../i18n"
import { readClipboard } from "../utils/attachments"

interface ComposerClipboardButtonProps {
  disabled: boolean
  onFiles: (files: File[]) => void
  onText: (text: string) => void
  onError: (message: string) => void
  t: Strings
}

// زرار "لصق من الحافظة": بيقرا الحافظة ولو فيها صورة بيبعتها للكومبوزر
// كمرفق، ولو فيها نص بيحطه في حقل الكتابة. بيشتغل على الكمبيوتر والموبايل
// حسب دعم المتصفح للـ Clipboard API.
export function ComposerClipboardButton({ disabled, onFiles, onText, onError, t }: ComposerClipboardButtonProps) {
  const [busy, setBusy] = useState(false)

  const handleClick = async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const { files, text } = await readClipboard()
      if (files.length > 0) {
        onFiles(files)
        return
      }
      if (text) {
        onText(text)
        return
      }
      onError(t.clipboardEmpty)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="attach-button"
      disabled={disabled || busy}
      onClick={() => void handleClick()}
      aria-label={t.pasteClipboard}
      title={t.pasteClipboard}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      </svg>
    </button>
  )
}
