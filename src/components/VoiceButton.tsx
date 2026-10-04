import { useEffect, useRef } from "react"
import { useVoiceInput } from "../hooks/useVoiceInput"
import type { Strings } from "../i18n"
import { voiceLanguageCode, voiceLanguageLabel, voiceRecognitionTag, type VoiceLanguage } from "../voice"

interface VoiceButtonProps {
  t: Strings
  voiceLanguage: VoiceLanguage
  // النص الحالي في الـ composer عند بداية الاستماع — الكلام المُفرّغ يلزق
  // بعده بدل ما يمسح اللي المستخدم كتبه قبل ما يدوس المايك
  composer: string
  onComposerChange: (text: string) => void
  onError: (message: string) => void
}

// زر مايك جنب حقل الكتابة: ضغطة تبدأ الاستماع، والكلام بيتفرّغ لحظة بلحظة
// جوه الحقل نفسه عشان المستخدم يشوفه وهو بيحصّل ويصحّح قبل الإرسال.
export function VoiceButton({ t, voiceLanguage, composer, onComposerChange, onError }: VoiceButtonProps) {
  const baseRef = useRef("")
  // أحدث قيمة للـ composer حتى في لحن المستمعين (الـ callbacks جوه الـ hook
  // بيتخزنوا في refs فما يبقاش عندنا stale closure). التحديث في effect مش
  // أثناء الرندر — الـ ref مش بيانات رسم.
  const composerRef = useRef(composer)
  useEffect(() => {
    composerRef.current = composer
  }, [composer])

  const { supported, listening, start, stop } = useVoiceInput({
    language: voiceRecognitionTag(voiceLanguage),
    onTranscript: (text) => {
      const base = baseRef.current
      onComposerChange(base ? `${base} ${text}`.trim() : text)
    },
    onError: (kind) => {
      onError(kind === "denied" ? t.voiceMicDenied : t.voiceRecognitionFailed)
    },
  })

  const handleClick = () => {
    if (listening) {
      stop()
      return
    }
    // سجّل المكتوب دلوقتي قبل بداية الاستماع — ده الأساس اللي هيتبني عليه
    // الكلام الجديد، وده سبب إن baseRef يتبت هنا مش في تأثير ثانٍ
    baseRef.current = composerRef.current
    start()
  }

  const code = voiceLanguageCode(voiceLanguage)
  // العنوان بيجمع الحالة واللغة الفعّالة من نفس النصوص المترجمة الموجودة —
  // بدون مفاتيح جديدة في ملفات الـ i18n.
  const statusLabel = `${listening ? t.voiceStop : t.voiceStart} · ${voiceLanguageLabel(voiceLanguage, t)}`

  return (
    <button
      type="button"
      className={`voice-button${listening ? " is-listening" : ""}`}
      onClick={handleClick}
      disabled={!supported}
      aria-label={supported ? statusLabel : t.voiceUnsupported}
      title={supported ? statusLabel : t.voiceUnsupported}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
      {/* شارة لغة التعرّف في ركن الزر: اللغة الفعّالة دلوقتي مش الإعداد
          المخزّن — "تلقائي" بتتترجم لغة الجهاز وقت الاستخدام، والمستخدم عايز
          يشوف اللغة قبل ما يبدأ يتكلم مش بعد ما الكلام يتحوّل غلط. */}
      <span className={`voice-lang${code === "ع" ? " voice-lang-ar" : ""}`} aria-hidden>{code}</span>
    </button>
  )
}
