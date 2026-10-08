// مستمع كلمة التنبيه: جلسة تعرّف مستمرة في الخلفية تفتح لوحة التحكم الصوتي لما
// العبارة المختارة تتقال — من غير لمس الهاتف. الجلسة بتقف لما اللوحة تكون
// مفتوحة أو الصفحة مخفية أو الميكروفون مشغول بمستهلك تاني (الإملاء/الأوامر)،
// وبترجع تلقائيًا لما الشروط تكتمل. المتصفح بيقفل الجلسة على الصمت فبنعيد
// فتحها بتأخير، ومع الأخطاء المتكررة التأخير بيتضاعف لحد سقف عشان مفيش حلقة
// محمومة. الملكية المشتركة مع باقي مستهلكي الميكروفون موصوفة في mic-lock.ts.
import { useCallback, useEffect, useRef, useState } from "react"
import { flattenRecognitionSegments, requiresFinalConfidence, type RecognizedSegment } from "../voice"
import { containsWakePhrase, isValidWakePhrase } from "../wake-word"
import { acquireMic, currentMicOwner, releaseMic, subscribeMic } from "./mic-lock"
import { deviceSpeechLanguage, getSpeechRecognitionCtor, type SpeechRecognitionInstanceLike } from "./speech"

// إعادة فتح الجلسة بعد ما المتصفح يقفلها (صمت طويل أو حد داخلي): التأخير
// يمنع حلقة محمومة لو الـ onend جه فورًا بعد كل start.
const RESTART_DELAY_MS = 400
// سقف التراجع المتضاعف عند الأخطاء المتكررة (تعذّر التقاط الصوت أو الشبكة).
const MAX_RESTART_DELAY_MS = 8000

export interface UseWakeWordOptions {
  // مفعّل = الإعداد شغّال + المستخدم داخل + فيه مشروع مفتوح (اللوحة موجودة أصلًا)
  enabled: boolean
  // العبارة الفعلية (المكتوبة أو الافتراضية) — المطابقة بتتم عليها
  phrase: string
  // وسم لغة التعرف؛ undefined = لغة الجهاز (نفس قاعدة الإدخال الصوتي)
  languageTag: string | undefined
  // لوحة ماسكة الميكروفون دلوقتي: المستمع يقف لحد ما تتحرر
  suspended: boolean
  onWake: () => void
  onBlocked: () => void
}

export interface WakeWordController {
  supported: boolean
  listening: boolean
  blocked: boolean
}

export function useWakeWord(options: UseWakeWordOptions): WakeWordController {
  const { enabled, phrase, languageTag, suspended } = options
  const [supported] = useState(() => getSpeechRecognitionCtor() !== undefined)
  const [listening, setListening] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const tokenRef = useRef<symbol>(Symbol("wake-word"))
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null)
  const restartTimerRef = useRef<number | null>(null)
  const restartDelayRef = useRef(RESTART_DELAY_MS)
  // العلمين دول بيتغيّروا من أحداث خارج دورة الرندر (onresult/onerror) فالقراءة
  // لازم تكون من مراجع مش من حالة: استُهلكت الكلمة، وإذن الميكروفون مرفوض.
  const firedRef = useRef(false)
  const blockedRef = useRef(false)
  // شروط التشغيل مجمّعة في مرجع واحد عشان دالة المزامنة (بتتنادى من مستمعي
  // الميكروفون كمان) تقرا أحدث القيم من غير stale closures.
  const conditionsRef = useRef({ enabled, suspended, phrase, supported, visible })
  conditionsRef.current = { enabled, suspended, phrase, supported, visible }

  const clearRestart = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  const shouldListen = useCallback((): boolean => {
    const conditions = conditionsRef.current
    return conditions.supported
      && conditions.enabled
      && !conditions.suspended
      && conditions.visible
      && !blockedRef.current
      && !firedRef.current
      && isValidWakePhrase(conditions.phrase)
  }, [])

  const stop = useCallback(() => {
    clearRestart()
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      // هنلغي من عندنا: بنفصل المعالجات قبل abort عشان ما نتعاملش مع الـ onend
      // كأنه نهاية طبيعية تستحق إعادة تشغيل
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.abort()
    }
    releaseMic(tokenRef.current)
    setListening(false)
  }, [clearRestart])

  // بناء جلسة جديدة من جوه onend من غير مرجعية ذاتية على start.
  const startRef = useRef<() => void>(() => {})

  const scheduleRestart = useCallback(() => {
    if (!shouldListen()) {
      return
    }
    const owner = currentMicOwner()
    if (owner !== null && owner !== tokenRef.current) {
      return
    }
    clearRestart()
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null
      startRef.current()
    }, restartDelayRef.current)
  }, [clearRestart, shouldListen])

  const start = useCallback(() => {
    if (recognitionRef.current || restartTimerRef.current !== null || !shouldListen()) {
      return
    }
    // الميكروفون عند حد تاني — نستنى إشعار الإفراج بدل ما نتخبط معاه
    const owner = currentMicOwner()
    if (owner !== null && owner !== tokenRef.current) {
      return
    }
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      return
    }
    const recognition = new Ctor()
    recognition.lang = optionsRef.current.languageTag ?? deviceSpeechLanguage() ?? "en-US"
    // continuous=true عشان الجلسة ما تقفلش عند أول وقفة قصيرة في وسط العبارة
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      // الجلسة اشتغلت فعلًا — التأخير يرجع لأصله
      restartDelayRef.current = RESTART_DELAY_MS
    }
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
      const { finalText, interimText } = flattenRecognitionSegments(segments, requiresFinalConfidence())
      const said = [finalText, interimText].filter((part) => part.length > 0).join(" ")
      if (!containsWakePhrase(said, optionsRef.current.phrase)) {
        return
      }
      // الكلمة اتقالت: نقفل الجلسة من عندنا قبل نداء الفتح عشان لوحة الأوامر
      // تلاقي الميكروفون حر لما تبدأ جلستها. firedRef بيمنع إعادة الفتح في
      // الفجوة بين الإفراج وانتقال الواجهة لحالة "اللوحة مفتوحة".
      firedRef.current = true
      clearRestart()
      const current = recognitionRef.current
      recognitionRef.current = null
      if (current) {
        current.onstart = null
        current.onresult = null
        current.onerror = null
        current.onend = null
        current.abort()
      }
      releaseMic(tokenRef.current)
      setListening(false)
      optionsRef.current.onWake()
    }
    recognition.onerror = (event) => {
      // aborted بييجي من إيقافنا إحنا أو من مستهلك تاني خد الميكروفون — مش خطأ
      if (event.error === "aborted") {
        return
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        // إذن مرفوض: إعادة المحاولة في حلقة مش هتصلّح الإذن — نوقف ونعلّم
        blockedRef.current = true
        setBlocked(true)
        optionsRef.current.onBlocked()
        return
      }
      // no-speech طبيعي (سكون) وبيتعالج بإعادة التشغيل المعتادة؛ غيره يستحق
      // تراجع متضاعف عشان الأخطاء المتكررة ما تبقاش محاولات كل ٤٠٠ مللي
      if (event.error !== "no-speech") {
        restartDelayRef.current = Math.min(restartDelayRef.current * 2, MAX_RESTART_DELAY_MS)
      }
    }
    recognition.onend = () => {
      // أُلغيت من عندنا (stop/استهلاك الكلمة) — مش نهاية طبيعية
      if (recognitionRef.current !== recognition) {
        return
      }
      recognitionRef.current = null
      setListening(false)
      // الملكية بتفضل معانا بين الجلسات: كده مفيش فتح فوري بيتخطى التأخير
      scheduleRestart()
    }

    recognitionRef.current = recognition
    // الاستحواذ قبل start عشان أي جلسة تانية شغالة تاخد إشارة الوقوف الأول
    acquireMic(tokenRef.current)
    try {
      recognition.start()
      setListening(true)
    } catch {
      // start() ممكن يرمي لو المحرك لسه بيقفل جلسة قديمة — نرجع الميكروفون
      // ونجرب تاني بعد التأخير بدل ما نفضل عالقين في صمت
      recognitionRef.current = null
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      releaseMic(tokenRef.current)
      setListening(false)
      restartDelayRef.current = Math.min(restartDelayRef.current * 2, MAX_RESTART_DELAY_MS)
      scheduleRestart()
    }
  }, [clearRestart, scheduleRestart, shouldListen])

  useEffect(() => {
    startRef.current = start
  }, [start])

  // المزامنة الواحدة: بتفصل "هل مسموح أسمع؟" عن "مين ماسك الميكروفون؟" وبتتصرف
  // على النتيجتين — بتتنادى عند تغيّر أي شرط وعند تغيّر ملكية الميكروفون.
  const sync = useCallback(() => {
    const conditions = conditionsRef.current
    // استُهلكت الكلمة ولسه بانتظار اللوحة: العلم يتصفّر أول ما الاستماع يتوقف
    // (اللوحة اتفتحت أو الإعداد اتقفل) عشان الدورة الجاية تشتغل.
    if (firedRef.current && (conditions.suspended || !conditions.enabled)) {
      firedRef.current = false
    }
    const owner = currentMicOwner()
    if (owner !== null && owner !== tokenRef.current) {
      stop()
      return
    }
    if (!shouldListen()) {
      stop()
      return
    }
    // إعادة مزامنة مقصودة (تغيّر إعداد/عبارة/رؤية أو تحرر الميكروفون): التأخير
    // المتبقي من فشل سابق مش معناه نستنى — الشروط بقت صالحة الآن
    clearRestart()
    start()
  }, [clearRestart, shouldListen, start, stop])

  useEffect(() => {
    const onVisibilityChange = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])

  // إعادة المزامنة لما أي شرط يتغيّر: القيم بتُقرأ جوه sync من مرجع، والقايمة
  // دي هي اللي بتشغّل المزامنة فعلًا عند التغيّر
  useEffect(() => {
    sync()
  }, [enabled, suspended, phrase, supported, visible, blocked, sync])

  // تغيير لغة التعرف أثناء الاستماع: الجلسة الجارية اتفتحت باللغة القديمة،
  // فبنعيدها بالجديدة عشان العبارة تُلتقط باللغة الصح. المرجع بيمنع إعادة
  // التشغيل على أول تحميل (الجلسة لسه اتفتحت للتو باللغة الصح أصلًا).
  const previousLanguageRef = useRef(languageTag)
  useEffect(() => {
    if (previousLanguageRef.current === languageTag) {
      return
    }
    previousLanguageRef.current = languageTag
    if (recognitionRef.current) {
      stop()
      sync()
    }
  }, [languageTag, stop, sync])

  useEffect(() => subscribeMic(sync), [sync])

  // إعادة تفعيل الإعداد بتصفّر حظر الإذن: المستخدم ممكن يكون صلّحه من إعدادات
  // المتصفح، ومانخليهوش عالقًا في "محظور" للأبد.
  useEffect(() => {
    if (!enabled) {
      blockedRef.current = false
      setBlocked(false)
    }
  }, [enabled])

  // تنظيف كامل عند فك المكوّن: مفيش جلسة تسيب الميكروفون شغال في الخلفية
  useEffect(() => () => {
    clearRestart()
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.abort()
    }
    releaseMic(tokenRef.current)
  }, [clearRestart])

  return { supported, listening, blocked }
}
