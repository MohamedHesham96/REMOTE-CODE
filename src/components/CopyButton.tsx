import { memo, useEffect, useRef, useState } from "react"
import type { Strings } from "../i18n"

// زر نسخ موحّد لكل رسالة في الطلب. تأكيد النسخ بتبديل الأيقونة (لأيقونة صح)
// مش نص بيظهر — عشان عرض الزرار ما يتغيّرش والسطر ما يرتعشش. ومن غير toast:
// سياسة المشروع إن النجاح اللي شايفه بعينك مبيطلعش توست.
//
// memo: زرار بيتكرر مرة لكل صف في كارت المحادثة، ومع `useNowTick` اللي بيوقظ
// الكارت كل ثانية، من غير memo كان كل زرار بيتعاد رسمه حتى لو النص ما اتغيّرش.
interface CopyButtonProps {
  text: string
  onCopy: (text: string) => void
  label: string
  className?: string
  t: Strings
}

function CopyButtonInner({ text, onCopy, label, className = "", t }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!text) {
    return null
  }

  const handleCopy = () => {
    onCopy(text)
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <button
      type="button"
      className={`copy-chip${copied ? " is-copied" : ""}${className ? ` ${className}` : ""}`}
      onClick={(event) => { event.stopPropagation(); handleCopy() }}
      aria-label={copied ? t.copied : label}
      title={copied ? t.copied : label}
    >
      <svg className="copy-chip-icon" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {copied ? (
          <path d="M20 6.5 9.5 17 4 11.5" />
        ) : (
          <>
            <rect x="9" y="9" width="12" height="12" rx="2.5" />
            <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" />
          </>
        )}
      </svg>
    </button>
  )
}

export const CopyButton = memo(CopyButtonInner)
