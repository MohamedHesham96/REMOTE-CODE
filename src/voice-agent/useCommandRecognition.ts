// التقاط أمر صوتي واحد لطبقة التحكم: يفتح الميكروفون، يجمع أفضل تفريغ،
// ويقف عند سكون المستخدم أو عند حد أقصى للمدة، وبعدها يسلّم النص النهائي.
// دورة الحياة كاملة هنا: مفيش مستمعين متروكين، ومفيش جلسة تفضل عالقة في
// "أستمع" — إما نتيجة أو خطأ مفهوم. الإملاء في الكومبوزر له hookه المستقل
// (useVoiceInput) لأن سلوكه مختلف (مستمر/قفل)، والاتنين بيشاركوا نفس أنواع
// Web Speech ونفس دوال تجميع النص البحتة من voice.ts.
import { useCallback, useEffect, useRef, useState } from "react"
import { reduceVoiceTranscript, requiresFinalConfidence, type RecognizedSegment, type VoiceTranscriptState } from "../voice"
import { acquireMic, releaseMic } from "./mic-lock"
import { deviceSpeechLanguage, getSpeechRecognitionCtor, type SpeechRecognitionInstanceLike } from "./speech"

// مهلة بدء الكلام: بعد فتح الميكروفون فيه وقت معقول للمستخدم يبدأ —
// من غيرها كان أول صمت قصير يقفل الجلسة قبل ما ينطق أصلًا.
const START_TIMEOUT_MS = 6000
// مهلة السكون بين الكلمات: بعد ما الكلام يبدأ، نستنى شوية بسيطة تحسّب
// الجملة خلصت، وبعدها نقفل الاستماع بهدوء (stop وليس abort) عشان النتيجة
// النهائية تكتمل.
const SILENCE_TIMEOUT_MS = 1600
// سقف المدة: حتى لو المستخدم فضل يتكلم أو الميكروفون سمع ضوضاء، الجلسة
// بتقفل — الواجهة مستحيل تعلق في "أستمع".
const MAX_LISTEN_MS = 15000

export type CommandRecognitionErrorKind = "unsupported" | "denied" | "unavailable" | "failed" | "no-speech"

export interface UseCommandRecognitionOptions {
  // وسم لغة التعرف (BCP-47). undefined = لغة الجهاز.
  language?: string
  // النص الكامل الجاري (نهائي + مبدئي) لعرضه لحظة بلحظة
  onTranscript: (text: string) => void
  // النص النهائي لما الجلسة تقفل بنجاح
  onFinal: (text: string) => void
  onError: (kind: CommandRecognitionErrorKind) => void
}

export interface CommandRecognitionController {
  supported: boolean
  listening: boolean
  start: () => void
  cancel: () => void
}

export function useCommandRecognition(options: UseCommandRecognitionOptions): CommandRecognitionController {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== undefined)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null)
  // هوية الجلسة في سجل ملكية الميكروفون: مستمع كلمة التنبيه يوقف جلسته لما
  // اللوحة تستحوذ، ويرجع لما نفلت (شوف mic-lock.ts)
  const micTokenRef = useRef<symbol>(Symbol("voice-command"))
  const silenceTimerRef = useRef<number | null>(null)
  const maxTimerRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  const startingRef = useRef(false)
  // خطأ الجلسة الجارية (لو حصل) — بيتقرر في onend عشان يفرّق بين "مفيش
  // كلام" و"فشل حقيقي" من غير ما نبلّغ مرتين.
  const pendingErrorRef = useRef<CommandRecognitionErrorKind | null>(null)
  const voiceStateRef = useRef<VoiceTranscriptState>({ base: "", confirmed: "", suppress: "" })
  const lastTextRef = useRef("")
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const clearMaxTimer = useCallback(() => {
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
  }, [])

  const stopRecognition = useCallback(() => {
    clearSilenceTimer()
    clearMaxTimer()
    recognitionRef.current?.stop()
  }, [clearSilenceTimer, clearMaxTimer])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor || recognitionRef.current || startingRef.current) {
      if (!Ctor) {
        optionsRef.current.onError("unsupported")
      }
      return
    }
    startingRef.current = true
    cancelledRef.current = false
    pendingErrorRef.current = null
    voiceStateRef.current = { base: "", confirmed: "", suppress: "" }
    lastTextRef.current = ""
    const recognition = new Ctor()
    recognition.lang = optionsRef.current.language ?? deviceSpeechLanguage() ?? "en-US"
    // continuous=true: الجلسة ما تقفلش عند أول وقفة قصيرة، والإغلاق عندنا
    // بمؤقت السكون أو بسقف المدة.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      const segments: RecognizedSegment[] = []
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]
        const alternative = result?.[0]
        if (!alternative) {
          continue
        }
        segments.push({ transcript: alternative.transcript, isFinal: result.isFinal, confidence: alternative.confidence })
      }
      const reduced = reduceVoiceTranscript(voiceStateRef.current, segments, requiresFinalConfidence())
      voiceStateRef.current = reduced.state
      lastTextRef.current = reduced.cleared ? "" : reduced.text
      optionsRef.current.onTranscript(lastTextRef.current)
      // مع كل نتيجة جديدة نأجّل الإغلاق بمهلة السكون القصيرة: بنقفل بعد
      // سكون كامل بس، مش بعد أول وقفة في وسط الجملة
      clearSilenceTimer()
      silenceTimerRef.current = window.setTimeout(() => {
        silenceTimerRef.current = null
        if (!cancelledRef.current) {
          stopRecognition()
        }
      }, SILENCE_TIMEOUT_MS)
    }
    recognition.onerror = (event) => {
      // abort بييجي من إلغائنا إحنا — مش خطأ للمستخدم
      if (event.error === "aborted") {
        return
      }
      if (event.error === "no-speech") {
        pendingErrorRef.current = "no-speech"
        return
      }
      pendingErrorRef.current = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "denied"
        : event.error === "audio-capture"
          ? "unavailable"
          : "failed"
    }
    recognition.onend = () => {
      recognitionRef.current = null
      startingRef.current = false
      clearSilenceTimer()
      clearMaxTimer()
      // الجلسة خلصت: نفلت الميكروفون عشان مستمع كلمة التنبيه يقدر يرجع
      releaseMic(micTokenRef.current)
      setListening(false)
      if (cancelledRef.current) {
        return
      }
      const text = lastTextRef.current.trim()
      if (pendingErrorRef.current && pendingErrorRef.current !== "no-speech") {
        optionsRef.current.onError(pendingErrorRef.current)
        return
      }
      if (text) {
        optionsRef.current.onFinal(text)
        return
      }
      optionsRef.current.onError("no-speech")
    }

    recognitionRef.current = recognition
    // الملكية قبل start عشان مستمع كلمة التنبيه يوقف فورًا لو كان شغال،
    // فمفيش جلستين تعرّف بيتخبطوا
    acquireMic(micTokenRef.current)
    try {
      recognition.start()
      setListening(true)
      // أول مهلة: نستنى المستخدم يبدأ الكلام (أطول). وأول نتيجة بتقلّبها
      // لمهلة السكون القصيرة أعلاه.
      clearSilenceTimer()
      silenceTimerRef.current = window.setTimeout(() => {
        silenceTimerRef.current = null
        if (!cancelledRef.current) {
          stopRecognition()
        }
      }, START_TIMEOUT_MS)
      clearMaxTimer()
      maxTimerRef.current = window.setTimeout(() => {
        maxTimerRef.current = null
        if (!cancelledRef.current) {
          stopRecognition()
        }
      }, MAX_LISTEN_MS)
    } catch {
      // start() ممكن يرمي لو جلسة سابقة لسه بتنهي — نبلّغ بهدوء
      recognitionRef.current = null
      startingRef.current = false
      releaseMic(micTokenRef.current)
      setListening(false)
      optionsRef.current.onError("failed")
    }
  }, [clearSilenceTimer, clearMaxTimer, stopRecognition])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    clearSilenceTimer()
    clearMaxTimer()
    const recognition = recognitionRef.current
    recognitionRef.current = null
    startingRef.current = false
    recognition?.abort()
    releaseMic(micTokenRef.current)
    setListening(false)
  }, [clearSilenceTimer, clearMaxTimer])

  // تنظيف كامل مع إغلاق اللوحة: مفيش ميكروفون يسيب مفتوح ورا واجهة متقفلة
  useEffect(() => () => {
    cancelledRef.current = true
    clearSilenceTimer()
    clearMaxTimer()
    recognitionRef.current?.abort()
    recognitionRef.current = null
    releaseMic(micTokenRef.current)
  }, [clearSilenceTimer, clearMaxTimer])

  return { supported, listening, start, cancel }
}
