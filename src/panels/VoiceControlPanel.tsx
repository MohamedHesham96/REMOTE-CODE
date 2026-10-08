import { useEffect, useRef } from "react"
import { voiceHelpCategories, type Language, type Strings } from "../i18n"
import { nextVoiceLanguage, voiceLanguageCode, voiceLanguageLabel, voiceRecognitionTag, type VoiceLanguage } from "../voice"
import { useVoiceControl, type VoiceAgentBindings } from "../voice-agent/useVoiceControl"
import type { VoiceControlState } from "../voice-agent/state"

interface VoiceControlPanelProps {
  t: Strings
  lang: Language
  voiceLanguage: VoiceLanguage
  bindings: VoiceAgentBindings
  onClose: () => void
  onVoiceLanguageChange: (value: VoiceLanguage) => void
}

// الحالة القصيرة المعروضة في الشريط العلوي للوحة: الحالة الجارية أو عنوان
// الفعل المكتمل. الرسائل الطويلة (الردود/الأخطاء) ليها صندوق مستقل.
function statusText(state: VoiceControlState, t: Strings): string {
  switch (state.phase) {
    case "listening":
      return t.voiceControlListening
    case "processing":
      return t.voiceControlProcessing
    case "executing":
      return t.voiceControlExecuting
    case "awaiting":
      return t.voiceControlAwaiting
    case "success":
      return t.voiceControlDone
    case "unsupported":
      return t.voiceControlUnsupportedText
    case "permission-denied":
      return t.voiceMicDenied
    default:
      return t.voiceControlListen
  }
}

export function VoiceControlPanel({ t, lang, voiceLanguage, bindings, onClose, onVoiceLanguageChange }: VoiceControlPanelProps) {
  const controller = useVoiceControl({ t, languageTag: voiceRecognitionTag(voiceLanguage), bindings })
  const { state, supported, listening, helpOpen } = controller
  const micRef = useRef<HTMLButtonElement | null>(null)
  const pendingKind = state.pendingKind

  // تركيز أولي على المايك، ومع الإغلاق نرجّع التركيز لزر الترويسة اللي فتح
  // اللوحة — إدارة تركيز صحيحة للكيبورد وقارئ الشاشة
  useEffect(() => {
    micRef.current?.focus()
    return () => {
      const trigger = document.querySelector<HTMLElement>("[data-voice-trigger]")
      trigger?.focus()
    }
  }, [])

  // فتح اللوحة بالضغطة نفسها إشارة نية واضحة: نبدأ الاستماع فورًا عشان
  // المستخدم يتكلم من غير خطوة إضافية. لو المتصفح رفض، الحالة بتشرح السبب
  // وكل مسارات الاسترجاع ظاهرة.
  const startListening = controller.start
  useEffect(() => {
    if (supported) {
      startListening()
    }
  }, [supported, startListening])

  const cancelListening = controller.cancelListening
  const cancelPending = controller.cancelPending
  const continuePending = controller.continuePending

  // Esc: يوقف الاستماع أولًا، ثم يلغي الطلب المعلّق، ثم يقفل اللوحة
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return
      }
      event.preventDefault()
      if (listening) {
        cancelListening()
        return
      }
      if (pendingKind) {
        cancelPending()
        return
      }
      onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [listening, pendingKind, cancelListening, cancelPending, onClose])

  const status = statusText(state, t)
  const busy = state.phase === "processing" || state.phase === "executing"
  const liveText = state.transcript || state.heard
  const languageLabel = `${t.voiceInputLanguage}: ${voiceLanguageLabel(voiceLanguage, t)}`

  return (
    <div className="voice-agent-backdrop" onClick={onClose}>
      <section
        className="voice-agent-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.voiceControl}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="voice-agent-header">
          <div>
            <div className="eyebrow">🎙 {t.voiceControl}</div>
            <h2 className="voice-agent-title">{t.voiceControlIntro}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t.voiceControlClose} title={t.voiceControlClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>

        <div className="voice-agent-status" role="status" aria-live="polite">
          <span className={`voice-agent-status-chip phase-${state.phase}`}>{status}</span>
          {liveText ? <p className="voice-agent-transcript" dir="auto">{liveText}</p> : null}
        </div>

        {state.feedback ? (
          <div className={`voice-agent-feedback tone-${state.tone}`} aria-live="polite" dir="auto">{state.feedback}</div>
        ) : null}

        {pendingKind ? (
          <div className="voice-agent-pending" role="group" aria-label={state.pendingQuestion || t.voiceControlAwaiting}>
            {state.pendingQuestion ? <p className="voice-agent-question" dir="auto">{state.pendingQuestion}</p> : null}
            {state.planLines.length > 0 ? (
              <ol className="voice-agent-plan" aria-label={t.voicePlanTitle}>
                {state.planLines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
              </ol>
            ) : null}
            {pendingKind === "clarify" && state.candidates.length > 0 ? (
              <div className="voice-agent-candidates">
                {state.candidates.map((candidate, index) => (
                  <button key={`${index}-${candidate}`} type="button" className="voice-agent-candidate" onClick={() => controller.chooseCandidateAt(index)}>
                    <span className="voice-agent-candidate-index" aria-hidden>{index + 1}</span>
                    <span dir="auto">{candidate}</span>
                  </button>
                ))}
                <p className="voice-agent-hint">{t.voiceClarifyHint}</p>
              </div>
            ) : null}
            <div className="voice-agent-pending-actions">
              {pendingKind !== "clarify" ? (
                <button type="button" className="button button-primary" onClick={continuePending}>{t.voicePlanContinue}</button>
              ) : null}
              <button type="button" className="button button-ghost" onClick={cancelPending}>{t.voicePlanCancel}</button>
            </div>
          </div>
        ) : null}

        <div className="voice-agent-controls">
          <button
            ref={micRef}
            type="button"
            className={`voice-agent-mic${listening ? " is-listening" : ""}`}
            onClick={listening ? cancelListening : controller.start}
            disabled={!supported || busy}
            aria-label={listening ? t.voiceStop : t.voiceControlListen}
            aria-pressed={listening}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <span>{listening ? t.voiceStop : t.voiceControlListen}</span>
          </button>
          <div className="voice-agent-side">
            <button
              type="button"
              className="voice-lang-switch"
              onClick={() => onVoiceLanguageChange(nextVoiceLanguage(voiceLanguage))}
              disabled={!supported}
              aria-label={languageLabel}
              title={languageLabel}
            >
              {voiceLanguageCode(voiceLanguage)}
            </button>
            <button type="button" className={`voice-agent-help-toggle${helpOpen ? " is-open" : ""}`} onClick={controller.toggleHelp} aria-expanded={helpOpen}>
              {t.voiceHelpTitle}
            </button>
          </div>
        </div>

        <p className="voice-agent-esc">{t.voiceControlEscHint}</p>

        {helpOpen ? (
          <div className="voice-agent-help">
            <p className="voice-agent-help-note">{t.voiceHelpNote}</p>
            <p className="voice-agent-help-toggle-label">{t.voiceHelpToggle}</p>
            <div className="voice-agent-help-grid">
              {voiceHelpCategories[lang].map((category) => (
                <div className="voice-agent-help-card" key={category.title}>
                  <strong>{category.title}</strong>
                  <ul>
                    {category.examples.map((example) => <li key={example} dir="auto">{example}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
