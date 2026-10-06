import { useCallback, useEffect, useRef, useState } from "react"
import { mergeTranscript, reduceVoiceTranscript, requiresFinalConfidence, type RecognizedSegment, type VoiceTranscriptState } from "../voice"

// أنواع Web Speech API مش موجودة كاملة في lib.dom القياسية بتاعة TypeScript
// (الموجودة فيها كائنات النتائج بس: SpeechRecognitionResult وما شابه)،
// والمتصفحات بتعرّف المُنشئ تحت اسمين: SpeechRecognition الحديث نسبيًا و
// webkitSpeechRecognition اللي كل المحركات ما زالت بتقدمه. التعريف تحت هو
// أدنى حد التشغيل عايزه — مش واجهة كاملة للـ API.
interface SpeechRecognitionInstanceLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

interface SpeechRecognitionResultEventLike {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEventLike {
  error: string
}

type SpeechRecognitionCtorLike = new () => SpeechRecognitionInstanceLike

interface WindowWithSpeechRecognition {
  SpeechRecognition?: SpeechRecognitionCtorLike
  webkitSpeechRecognition?: SpeechRecognitionCtorLike
}

// الكشف مرة واحدة على الواجهة: لو المُنشئ مش موجود نتجاهل الميزة نهائيًا
// بدل ما نحاول ونفشل في كل ضغطة.
function getSpeechRecognitionCtor(): SpeechRecognitionCtorLike | undefined {
  const enhancedWindow = window as unknown as WindowWithSpeechRecognition
  return enhancedWindow.SpeechRecognition ?? enhancedWindow.webkitSpeechRecognition
}

// لغة الجهاز الفعلية (navigator.language) — هي الأصدق للتعرف على الصوت:
// بتعكس اللغة اللي المستخدم بيتكلم بيها فعلاً، مش لغة واجهة التطبيق.
function deviceLanguage(): string | undefined {
  const value = navigator.language?.trim()
  return value || undefined
}

// وضع القفل: المتصفح ممكن يقفل الجلسة لوحده (صمت طويل، أو حد داخلي للمدة).
// بدل ما نسيب المايك يقفل، بنبدأ جلسة جديدة بنفس اللغة. التأخير الصغير
// يمنع حلقة محمومة لو المتصفح بيرجّع end فورًا بعد كل start.
const LOCK_RESTART_DELAY_MS = 250

// مهلة الصمت قبل إغلاق الاستماع في الوضع غير المقفول: بعد آخر كلام بنستنى
// الفترة دي عشان المستخدم يكمّل جملته أو ياخد نفسه، وبعدها نقفل. ده اللي
// بيمنع المايك إنه يقفل بسرعة عند أول وقفة قصيرة في وسط الكلام.
const SILENCE_TIMEOUT_MS = 2500

export type VoiceInputErrorKind = "unsupported" | "denied" | "failed"

export interface UseVoiceInputOptions {
  // وسم لغة التعرف (BCP-47، مثل "ar-EG"). undefined = اتبع لغة الجهاز.
  language?: string
  // النص اللي كان في الحقل قبل بداية الاستماع — بنبني عليه الكلام الجديد.
  baseText: string
  // بتتستدعى مع النص الكامل اللي المفروض يتحط في الحقل (الأساس + المُفرّغ).
  // استبدال كامل مقصود: المستدعي مش بيضيف، فإعادة تشغيل الجلسة في وضع القفل
  // ما بتكررش الكلام.
  onText: (text: string) => void
  // بتتستدعى عند خطأ يمنع التعرف من الأصل (رفض المايك / فشل عام)
  onError: (kind: VoiceInputErrorKind) => void
}

export interface UseVoiceInputResult {
  supported: boolean
  listening: boolean
  // مفعّل يعني المستخدم قفل الاستماع: الجلسة تفضل سامعة مهما طال الصمت لحد
  // ما يقفلها بنفسه.
  locked: boolean
  start: () => void
  stop: () => void
  toggleLock: () => void
}

export function useVoiceInput({ language, baseText, onText, onError }: UseVoiceInputOptions): UseVoiceInputResult {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== undefined)
  const [listening, setListening] = useState(false)
  const [locked, setLocked] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null)
  // نسخة مرجعية من القفل: الـ onend بيتنفّذ خارج دورة الرندر، فقراءة الحالة
  // مباشرةً فيه بتشوف قيمة قديمة.
  const lockedRef = useRef(false)
  // خطأ قاتل (رفض/فشل) يمنع إعادة التشغيل التلقائي: الجلسة خلصت لسبب لن
  // يصلح معاه إعادة المحاولة (مثلاً المايك مرفوض).
  const failedRef = useRef(false)
  // مؤقت إعادة التشغيل في وضع القفل.
  const restartTimerRef = useRef<number | null>(null)
  // مؤقت الصمت في الوضع غير المقفول: بيتصفّر مع كل نتيجة، ولما السكون يكمل
  // مهلة الصمت بنقفل الجلسة. في وضع القفل بيتم تجاهله خالص.
  const silenceTimerRef = useRef<number | null>(null)
  // بناء جلسة جديدة من جوه onend من غير مرجعية ذاتية على start.
  const beginRef = useRef<() => void>(() => {})

  // حالة التجميع عبر أحداث الجلسة الواحدة: الأساس المتفَق عليه (نص الحقل
  // الأصلي + جلسات اللوك اللي فاتت) وآخر نص نهائي مستقر. منطق إعادة البناء
  // نفسه عايش في reduceVoiceTranscript (voice.ts) عشان يُختبر كدالة بحتة.
  const voiceStateRef = useRef<VoiceTranscriptState>({ base: "", confirmed: "" })
  // آخر نص كامل بعتناه للحقل — بنقارن بيه عشان ما نبعتش نفس النص مرتين.
  const lastSentRef = useRef("")
  // أحدث قيمة للـ callbacks واللغة والأساس.
  const optionsRef = useRef({ language, baseText, onText, onError })
  useEffect(() => {
    optionsRef.current = { language, baseText, onText, onError }
  }, [language, baseText, onText, onError])

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  // بناء الجلسة الفعلية. بتتنادى من start (تصفير التراكم) ومن onend في وضع
  // القفل (الحفاظ على التراكم) عشان المايك يفضل سامع.
  const beginSession = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor || recognitionRef.current) {
      return
    }
    // جلسة جديدة = بداية نظيفة لعلامة الفشل. النص المتراكم مقصود إنه يفضل
    // زي ما هو وقت الإعادة في وضع القفل.
    failedRef.current = false
    const recognition = new Ctor()
    recognition.lang = optionsRef.current.language ?? deviceLanguage() ?? "en-US"
    // continuous=true دايمًا عشان المتصفح ما يقفلش عند أول وقفة قصيرة في وسط
    // الكلام — كده المستخدم يقدر يكمّل جملته براحته. الإغلاق في الوضع غير
    // المقفول بيتم بمؤقت الصمت (بعد آخر كلمة بمهلة)، وفي وضع القفل بيتم
    // تجاهل المؤقت فالجلسة تفضل سامعة لحد ما المستخدم يقفلها بنفسه.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    // نص الجلسة (المحلي) يبدأ من الصفر؛ التراكم بيتخزّن في voiceStateRef.base
    // عند الإعادة بس (إعادة تشغيل في اللوك).
    voiceStateRef.current = { ...voiceStateRef.current, confirmed: "" }

    // كل حدث بيتعالج من الأول: بنحوّل نتائجه لمقاطع بسيطة، وبعدين نعيد بناء
    // النص الكامل عبر reduceVoiceTranscript. إعادة الحساب من الصفر مقصودة عشان
    // التكرار اللي جوه الحدث نفسه (محرّك أندرويد) ما يتراكمش عبر الأحداث.
    recognition.onresult = (event) => {
      const segments: RecognizedSegment[] = []
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        const alternative = result[0]
        if (!alternative) {
          continue
        }
        segments.push({
          transcript: alternative.transcript,
          isFinal: result.isFinal,
          confidence: alternative.confidence,
        })
      }
      const reduced = reduceVoiceTranscript(voiceStateRef.current, segments, requiresFinalConfidence())
      voiceStateRef.current = reduced.state
      const next = reduced.text
      if (next && next !== lastSentRef.current) {
        lastSentRef.current = next
        optionsRef.current.onText(next)
      }
      // أي كلام جديد (نهائي أو مبدئي) بيصفّر مهلة الصمت: بنستنى سكون كامل
      // المهلة قبل الإغلاق. في وضع القفل مفيش إغلاق أصلاً.
      clearSilenceTimer()
      if (!lockedRef.current) {
        silenceTimerRef.current = window.setTimeout(() => {
          silenceTimerRef.current = null
          if (!lockedRef.current) {
            recognition.stop()
          }
        }, SILENCE_TIMEOUT_MS)
      }
    }
    recognition.onerror = (event) => {
      // no-speech حالة طبيعية (المستخدم سكت) مش خطأ، وaborted بسبب إيقاف
      // يدوي — الاتنين ما يستاهلوش رسالة
      if (event.error === "no-speech" || event.error === "aborted") {
        return
      }
      const kind: VoiceInputErrorKind =
        event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied" : "failed"
      // خطأ قاتل: اطلع من وضع القفل ولا تعيد المحاولة (إلا لو المستخدم
      // صلّح الإذن وضغط المايك تاني).
      failedRef.current = true
      lockedRef.current = false
      setLocked(false)
      optionsRef.current.onError(kind)
    }
    recognition.onend = () => {
      // الجلسة خلصت (إيقاف يدوي أو صمت من المتصفح): امسح الجلسة الحالية.
      recognitionRef.current = null
      clearSilenceTimer()
      if (lockedRef.current && !failedRef.current) {
        // وضع القفل: المتصفح قفل الجلسة عند الصمت رغم إننا لسه مقفولين،
        // فبنبدأ جلسة جديدة عشان المايك يفضل سامع. بنضم نهائي الجلسة الحالية
        // للأساس **مرة واحدة** عشان الجلسة الجديدة تكمّل من غير ما تكرّر
        // الكلام اللي اتقال (confirmed هيتصفّر في beginSession).
        const state = voiceStateRef.current
        voiceStateRef.current = { base: mergeTranscript(state.base, state.confirmed), confirmed: "" }
        clearRestartTimer()
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null
          beginRef.current()
        }, LOCK_RESTART_DELAY_MS)
      } else {
        lockedRef.current = false
        setLocked(false)
        setListening(false)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      // حتى لو المستخدم ما اتكلمش خالص، منسيبش المايك مفتوح للأبد في الوضع
      // غير المقفول: مهلة الصمت بتقفل الجلسة لو مفيش أي كلام.
      if (!lockedRef.current) {
        clearSilenceTimer()
        silenceTimerRef.current = window.setTimeout(() => {
          silenceTimerRef.current = null
          if (!lockedRef.current) {
            recognition.stop()
          }
        }, SILENCE_TIMEOUT_MS)
      }
    } catch {
      // start() بيقدر يرمي لو الجلسة السابقة لسه مـ finalizing
      recognitionRef.current = null
      lockedRef.current = false
      setLocked(false)
      setListening(false)
      optionsRef.current.onError("failed")
    }
  }, [clearRestartTimer, clearSilenceTimer])

  useEffect(() => {
    beginRef.current = beginSession
  }, [beginSession])

  const start = useCallback(() => {
    if (!getSpeechRecognitionCtor() || recognitionRef.current) {
      return
    }
    // بداية استماع جديدة من ضغطة المستخدم: الأساس يتثبّت على اللي في الحقل
    // دلوقتي، والتراكم يبدأ من الصفر.
    const base = optionsRef.current.baseText
    voiceStateRef.current = { base, confirmed: "" }
    lastSentRef.current = base
    beginSession()
  }, [beginSession])

  const stop = useCallback(() => {
    // stop() مش abort(): بيسيب النتيجة النهائية تكتمل قبل ما الـ onend يجي
    lockedRef.current = false
    setLocked(false)
    clearRestartTimer()
    clearSilenceTimer()
    recognitionRef.current?.stop()
  }, [clearRestartTimer, clearSilenceTimer])

  // قفل/إلغاء قفل الاستماع. القفل بيلغي مهلة الصمت (الجلسة تفضل سامعة لحد ما
  // يقفلها المستخدم). مش محتاجين نلمس التراكم: continuous=true يعني نفس الجلسة
  // مستمرة وآخر نص نهائي بيفضل يتحدّث فيها عبر reduceVoiceTranscript.
  const toggleLock = useCallback(() => {
    if (!recognitionRef.current) {
      return
    }
    const next = !lockedRef.current
    lockedRef.current = next
    setLocked(next)
    // قفل/فك القفل بيغيّر تشغيل مؤقت الصمت بس: مقفول = وقّف المؤقت، مفتوح =
    // شغّله من جديد عشان الجلسة تقفل لوحدها لو المستخدم سكت.
    if (next) {
      clearSilenceTimer()
    } else {
      clearSilenceTimer()
      silenceTimerRef.current = window.setTimeout(() => {
        silenceTimerRef.current = null
        if (!lockedRef.current) {
          recognitionRef.current?.stop()
        }
      }, SILENCE_TIMEOUT_MS)
    }
  }, [clearSilenceTimer])

  // ميكروفون مفتوح وهو مفيش مكوّن يستقبل الكلام = تسريب؛ اقفل الجلسة مع unmount
  useEffect(() => () => {
    clearRestartTimer()
    clearSilenceTimer()
    recognitionRef.current?.abort()
  }, [clearRestartTimer, clearSilenceTimer])

  return { supported, listening, locked, start, stop, toggleLock }
}
