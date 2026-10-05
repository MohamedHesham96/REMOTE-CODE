import { useVoiceInput } from "../hooks/useVoiceInput"
import type { Strings } from "../i18n"
import { nextVoiceLanguage, voiceLanguageCode, voiceLanguageLabel, voiceRecognitionTag, type VoiceLanguage } from "../voice"

interface VoiceButtonProps {
  t: Strings
  voiceLanguage: VoiceLanguage
  // النص الحالي في الـ composer عند بداية الاستماع — الكلام المُفرّغ يلزق
  // بعده بدل ما يمسح اللي المستخدم كتبه قبل ما يدوس المايك
  composer: string
  onComposerChange: (text: string) => void
  onError: (message: string) => void
  // تبديل لغة التعرّف من جنب المايك من غير ما يفتح الإعدادات.
  onVoiceLanguageChange: (value: VoiceLanguage) => void
}

// زر مايك جنب حقل الكتابة: ضغطة تبدأ الاستماع، والكلام بيتفرّغ لحظة بلحظة
// جوه الحقل نفسه عشان المستخدم يشوفه وهو بيحصّل ويصحّح قبل الإرسال. وزر
// القفل (زيه زي الوتساب) بيثبّت الاستماع: المايك يفضل سامع مهما طال الصمت
// لحد ما المستخدم يقفله بنفسه. وزر اللغة جنب القفل بيلفّ لغة التعرّف:
// تلقائي ← عربي ← إنجليزي. تجميع النص (الأساس + المُفرّغ) مسؤولية الهوك،
// وهنا بس بنكتب اللي بيوصلنا في الحقل.
export function VoiceButton({ t, voiceLanguage, composer, onComposerChange, onError, onVoiceLanguageChange }: VoiceButtonProps) {
  const { supported, listening, locked, start, stop, toggleLock } = useVoiceInput({
    language: voiceRecognitionTag(voiceLanguage),
    baseText: composer,
    onText: (text) => {
      onComposerChange(text)
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
    start()
  }

  const code = voiceLanguageCode(voiceLanguage)
  // العنوان بيجمع الحالة واللغة الفعّالة من نفس النصوص المترجمة الموجودة —
  // بدون مفاتيح جديدة في ملفات الـ i18n.
  const statusLabel = `${listening ? t.voiceStop : t.voiceStart} · ${voiceLanguageLabel(voiceLanguage, t)}`
  const lockLabel = locked ? t.voiceUnlock : t.voiceLock
  const languageLabel = `${t.voiceInputLanguage}: ${voiceLanguageLabel(voiceLanguage, t)}`

  return (
    <div className="voice-control">
      <button
        type="button"
        className={`voice-button${listening ? " is-listening" : ""}${locked ? " is-locked" : ""}`}
        onClick={handleClick}
        disabled={!supported}
        aria-label={supported ? statusLabel : t.voiceUnsupported}
        title={supported ? statusLabel : t.voiceUnsupported}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </button>
      <div className="voice-actions">
        {listening ? (
          <button
            type="button"
            className={`voice-lock${locked ? " is-locked" : ""}`}
            onClick={toggleLock}
            aria-pressed={locked}
            aria-label={lockLabel}
            title={lockLabel}
          >
            {/* الأيقونة بتبدّل مع الحالة. القفل المقفول: شريطة على شكل ∩ قاعدة
                أرجلها الاتنين على حافة الجسم (مقفول). القفل المفتوح: الشريطة
                مرفوعة لفوق وقاعدة رجلها اليمنى مش واصلة للحافة (فتحة واضحة). */}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {locked ? (
                <>
                  <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
                  <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                  <line x1="12" y1="14.5" x2="12" y2="16.5" />
                </>
              ) : (
                <>
                  <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
                  <path d="M8 10.5V6.5a4 4 0 0 1 7.4-2.1" />
                  <line x1="12" y1="14.5" x2="12" y2="16.5" />
                </>
              )}
            </svg>
            {/* وسم beta: الميزة لسه تجريبية، فبنكتب الكلمة على الزر نفسه عشان
                المستخدم ياخد باله إنها مش مكتملة الاستقرار بعد. */}
            <span className="voice-lock-beta" aria-hidden>beta</span>
          </button>
        ) : null}
        {/* زر اللغة: بيلفّ الإعداد تلقائي → عربي → إنجليزي، والحرف ظاهر عليه
            عشان المستخدم يعرف اللغة الفعّالة قبل ما يتكلم. */}
        <button
          type="button"
          className="voice-lang-switch"
          onClick={() => onVoiceLanguageChange(nextVoiceLanguage(voiceLanguage))}
          disabled={!supported}
          aria-label={languageLabel}
          title={languageLabel}
        >
          {code}
        </button>
      </div>
    </div>
  )
}
