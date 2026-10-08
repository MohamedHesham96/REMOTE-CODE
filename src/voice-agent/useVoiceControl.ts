// ربط طبقة الفهم والتنفيذ بالواجهة: آلة حالات مرئية + دورة حياة الميكروفون
// + الجلسة الحوارية. كل النداءات بتقرأ أحدث نسخة من props/الحالة عبر مراجع،
// فمفيش stale closures، وكل المؤقتات بتتنضّف مع الإغلاق (اللوحة بتتشال من
// الشجرة وهي مقفولة — يعني الميزة صفر عمل وقت عدم الاستخدام).
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { Strings } from "../i18n"
import { interpretVoiceTurn, rememberExecutedSteps, voiceCancelPending, voiceChooseCandidate, voiceConfirmPending, type VoiceAgentTurn } from "./agent"
import type { VoiceAppContext } from "./context"
import type { ClarifyCandidate } from "./intents"
import { runVoicePlan, type VoiceExecutors } from "./registry"
import { createVoiceAgentSession } from "./session"
import { INITIAL_VOICE_CONTROL_STATE, reduceVoiceControl, type VoiceControlState } from "./state"
import { useCommandRecognition, type CommandRecognitionErrorKind } from "./useCommandRecognition"

export interface VoiceAgentBindings {
  // قراءة سياق التطبيق لحظة المعالجة (مفيش نسخة مخزّنة من الحالة)
  getContext: () => VoiceAppContext
  executors: VoiceExecutors
}

export interface UseVoiceControlOptions {
  t: Strings
  languageTag: string | undefined
  bindings: VoiceAgentBindings
}

export interface VoiceControlController {
  state: VoiceControlState
  supported: boolean
  listening: boolean
  helpOpen: boolean
  toggleHelp: () => void
  start: () => void
  cancelListening: () => void
  cancelPending: () => void
  continuePending: () => void
  // الاختيار من قائمة المرشحين المعروضة — نفس مسار الإجابة الصوتية
  chooseCandidateAt: (index: number) => void
}

// مهلة قصيرة قبل إعادة فتح الميكروفون تلقائيًا بعد سؤال توضيح/تأكيد: ده نمط
// المحادثة الطبيعية (سؤال → جواب)، والمستخدم يقدر يقفل بالزر أو بـ Esc.
const AUTO_LISTEN_DELAY_MS = 550

export function useVoiceControl(options: UseVoiceControlOptions): VoiceControlController {
  const [state, dispatch] = useReducer(reduceVoiceControl, INITIAL_VOICE_CONTROL_STATE)
  const [helpOpen, setHelpOpen] = useState(false)
  const sessionRef = useRef(createVoiceAgentSession())
  const choicesRef = useRef<ClarifyCandidate[]>([])
  const optionsRef = useRef(options)
  optionsRef.current = options
  const autoListenTimerRef = useRef<number | null>(null)
  const executingRef = useRef(false)

  const clearAutoListen = useCallback(() => {
    if (autoListenTimerRef.current !== null) {
      window.clearTimeout(autoListenTimerRef.current)
      autoListenTimerRef.current = null
    }
  }, [])

  const executeTurn = useCallback(async (turn: Extract<VoiceAgentTurn, { kind: "execute" }>) => {
    if (executingRef.current) {
      return
    }
    executingRef.current = true
    const { t, bindings } = optionsRef.current
    dispatch({ type: "execute", planLines: turn.steps.map((step) => step.label) })
    try {
      const result = await runVoicePlan(
        turn.steps,
        bindings.executors,
        bindings.getContext,
        { lastEntity: sessionRef.current.lastEntity, lastListKind: sessionRef.current.lastList?.kind ?? null },
        t,
      )
      sessionRef.current = rememberExecutedSteps(sessionRef.current, result)
      const feedback = [...turn.notes, result.message].filter((part) => part && part.length > 0).join("\n")
      if (result.ok) {
        dispatch({ type: "success", feedback, planLines: turn.steps.map((step) => step.label) })
      } else {
        dispatch({ type: "error", feedback })
      }
    } catch {
      // أي استثناء غير متوقع بيتحوّل لرسالة مفهومة — مفيش استثناءات خام للمستخدم
      dispatch({ type: "error", feedback: t.voiceActionFailed })
    } finally {
      executingRef.current = false
    }
  }, [])

  const recognitionRef = useRef<{ start: () => void; cancel: () => void } | null>(null)

  const applyTurn = useCallback((turn: VoiceAgentTurn) => {
    switch (turn.kind) {
      case "reply":
        if (turn.openHelp) {
          setHelpOpen(true)
        }
        dispatch({
          type: turn.tone === "error" ? "error" : "success",
          feedback: turn.message,
          // رد مع سؤال لسه معلّق (إجابة مش مفهومة) بيسيب السؤال معروضًا
          keepPending: turn.session.pending !== null,
        })
        break
      case "clarify":
        choicesRef.current = turn.candidates
        dispatch({ type: "await", question: turn.question, pendingKind: "clarify", candidates: turn.candidates.map((candidate) => candidate.label) })
        break
      case "confirm":
        dispatch({ type: "await", question: turn.question, pendingKind: "confirm" })
        break
      case "preview":
        dispatch({ type: "await", question: optionsRef.current.t.voicePlanHint, pendingKind: "preview", planLines: turn.steps.map((step) => step.label) })
        break
      case "execute":
        void executeTurn(turn)
        break
      case "stop-listening":
        recognitionRef.current?.cancel()
        dispatch({ type: "stopped" })
        break
    }
  }, [executeTurn])

  const handleFinal = useCallback((text: string) => {
    const { t, bindings } = optionsRef.current
    dispatch({ type: "heard", text })
    if (!text.trim()) {
      dispatch({ type: "error", feedback: t.voiceControlNoSpeech, keepPending: sessionRef.current.pending !== null })
      return
    }
    dispatch({ type: "process", text })
    const turn = interpretVoiceTurn({ transcript: text, context: bindings.getContext(), session: sessionRef.current, t })
    sessionRef.current = turn.session
    applyTurn(turn)
  }, [applyTurn])

  const handleError = useCallback((kind: CommandRecognitionErrorKind) => {
    const { t } = optionsRef.current
    const keepPending = sessionRef.current.pending !== null
    if (kind === "denied") {
      dispatch({ type: "permission-denied" })
      return
    }
    if (kind === "unsupported") {
      dispatch({ type: "unsupported" })
      return
    }
    const feedback = kind === "no-speech"
      ? t.voiceControlNoSpeech
      : kind === "unavailable"
        ? t.voiceControlMicUnavailable
        : t.voiceRecognitionFailed
    dispatch({ type: "error", feedback, keepPending })
  }, [])

  const recognition = useCommandRecognition({
    language: options.languageTag,
    onTranscript: (text) => dispatch({ type: "transcript", text }),
    onFinal: handleFinal,
    onError: handleError,
  })
  recognitionRef.current = { start: recognition.start, cancel: recognition.cancel }

  // بعد سؤال توضيح/تأكيد/معاينة: نفتح الميكروفون تاني بعد مهلة قصيرة عشان
  // المستخدم يرد بصوته طبيعي. لو قفل أو نفّذ، المؤقت بيتلغي.
  const scheduleAutoListen = useCallback(() => {
    clearAutoListen()
    autoListenTimerRef.current = window.setTimeout(() => {
      autoListenTimerRef.current = null
      if (!executingRef.current) {
        recognitionRef.current?.start()
      }
    }, AUTO_LISTEN_DELAY_MS)
  }, [clearAutoListen])

  // applyTurn بتتنفّذ من handleFinal (حدث خارجي)، فبنربط جدولة الاستماع
  // التلقائي على حالة "الانتظار" القادمة من الرديوسر.
  const previousPhaseRef = useRef(state.phase)
  useEffect(() => {
    if (state.phase === "awaiting" && previousPhaseRef.current !== "awaiting") {
      scheduleAutoListen()
    }
    previousPhaseRef.current = state.phase
  }, [state.phase, scheduleAutoListen])

  const start = useCallback(() => {
    clearAutoListen()
    if (executingRef.current) {
      return
    }
    dispatch({ type: "start" })
    recognitionRef.current?.start()
  }, [clearAutoListen])

  const cancelListening = useCallback(() => {
    clearAutoListen()
    recognitionRef.current?.cancel()
    dispatch({ type: "stopped" })
  }, [clearAutoListen])

  const cancelPending = useCallback(() => {
    clearAutoListen()
    const { t } = optionsRef.current
    const turn = voiceCancelPending(sessionRef.current, t)
    sessionRef.current = turn.session
    applyTurn(turn)
  }, [applyTurn, clearAutoListen])

  const continuePending = useCallback(() => {
    clearAutoListen()
    const { t } = optionsRef.current
    const turn = voiceConfirmPending(sessionRef.current, t)
    sessionRef.current = turn.session
    applyTurn(turn)
  }, [applyTurn, clearAutoListen])

  const chooseCandidateAt = useCallback((index: number) => {
    const candidate = choicesRef.current[index]
    if (!candidate) {
      return
    }
    clearAutoListen()
    const { t, bindings } = optionsRef.current
    const turn = voiceChooseCandidate(sessionRef.current, candidate, bindings.getContext(), t)
    sessionRef.current = turn.session
    applyTurn(turn)
  }, [applyTurn, clearAutoListen])

  const toggleHelp = useCallback(() => setHelpOpen((current) => !current), [])

  // تنظيف المؤقت مع إغلاق اللوحة (الهوك نفسه بيتفكك بفكّ المكوّن)
  useEffect(() => clearAutoListen, [clearAutoListen])

  return {
    state,
    supported: recognition.supported,
    listening: recognition.listening,
    helpOpen,
    toggleHelp,
    start,
    cancelListening,
    cancelPending,
    continuePending,
    chooseCandidateAt,
  }
}
