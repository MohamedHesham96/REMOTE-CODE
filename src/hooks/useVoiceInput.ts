import { useCallback, useEffect, useRef, useState } from "react"

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
  onspeechstart: (() => void) | null
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

// الفاصل اللي بيفصل الأساس (اللي كان في الحقل) عن الكلام المُفرّغ.
const JOINT = " "

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

// تجميع الحقل: الأساس + (فاصل) + الكلام المُفرّغ.
function compose(base: string, spoken: string): string {
  if (!spoken) {
    return base
  }
  return base ? `${base}${JOINT}${spoken}` : spoken
}

// ضمّ الجملة الجارية على اللي قبلها: بنضيف فاصل المسافة لو مش موجود، عشان
// الجملتين ما يلزقوش في بعض ("السلام عليكم" + "إزيك" = "السلام عليكم إزيك").
function joinChunks(base: string, chunk: string): string {
  if (!base) {
    return chunk
  }
  if (!chunk) {
    return base
  }
  return /\s$/.test(base) || /^\s/.test(chunk) ? `${base}${chunk}` : `${base}${JOINT}${chunk}`
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
  // بناء جلسة جديدة من جوه onend من غير مرجعية ذاتية على start.
  const beginRef = useRef<() => void>(() => {})

  // النص المُفرّغ النهائي المتراكم عبر كل الجلسات. كل onresult بيعيد حسابه
  // *من الأول* من مصفوفة النتائج الكاملة، فمفيش أي إضافة تراكمية بتعمل
  // تكرار (ده اللي كان بيكرّر "كيف كيف كيف" مع المبدئي اللي بيتراجع).
  const finalizedRef = useRef("")
  // النص النهائي اللي كان موجود *قبل* ما المتحدث يبدأ الجملة الحالية. عشان
  // Web Speech بيمسح نتائج الجملة الجارية ويبدأها من جديد مع كل تنفّس، بنرجّع
  // الأساس ده في كل مرة نتائج الجملة الجارية تتصفّر — فما فيش فقد للكلام.
  const baseRef = useRef("")
  // آخر نص كامل بعتناه للحقل — بنقارن بيه عشان ما نبعتش نفس النص مرتين.
  const lastSentRef = useRef("")
  // الجلسة الحالية بتبني نصها من results، فهي محتاجة تشوف الأساس اللي كان
  // *قبل* ما تتكتب، وده بيتثبّت في onspeechstart.
  const pendingRef = useRef("")
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
    // continuous=false: المتصفح بيقفل التعرف لوحده بمجرد ما يحسّ بالصمت،
    // فالمستخدم بيخلّص جملته ومش محتاج يضغط إيقاف. وضع القفل بيعيد تشغيل
    // الجلسة كل ما تقفل عشان يفضل سامع.
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    // الجلسة الجارية بتبدأ من الأساس اللي كان متسجّل وقت بداية الكلام.
    pendingRef.current = baseRef.current

    // أول ما المتحدث يبدأ الجملة الجارية، الجلسة بتسجّل النص اللي قبلها. لو
    // شغّلنا وسكتنا (مفيش كلام)، الأساس يفضل زي ما هو.
    recognition.onspeechstart = () => {
      pendingRef.current = baseRef.current
    }

    // النص بيتحسب من مصفوفة النتائج الكاملة في كل حدث:
    //   sessionText = نهائي الجلسة + مبدئي الجلسة
    // وبنقارن مع اللي اتسجّل في الحدث اللي قبله. لو المبدئي اتقلّص (المحرك
    // بيرجع في كلمة وكان بيجرّبها)، بنعرف إن الجملة الجارية بدأت من جديد؛
    // بنحفظ النص اللي قبلها في baseRef عشان ما يضيعش. الحفظ مش بيتكرر لأن
    // بنطلب إن الجملة دي تكون أصغر فعلاً من اللي قبلها.
    let lastSessionText = ""
    recognition.onresult = (event) => {
      let finalText = ""
      let interimText = ""
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        // أي نتيجة واحدة مش نهائية معناها إن الجملة لسه مفتوحة. لو لقيناها،
        // كل اللي بعدها بيتعامل كمبدئي.
        if (i >= event.resultIndex && !result.isFinal) {
          interimText += result[0].transcript
        } else {
          finalText += result[0].transcript
        }
      }
      finalText = finalText.trim()
      const sessionText = `${finalText}${interimText}`.trim()
      // الجملة الجارية بدأت من جديد (المبدئي اتقلّص) → اللي قبلها يتحفظ.
      if (sessionText.length < lastSessionText.length) {
        baseRef.current = pendingRef.current
      }
      lastSessionText = sessionText
      // نهائي الجلسة = نهائي اللي قبلها + نهائي الجلسة دي، بفاصل مسافة عشان
      // الجمل اللي بعد السكوت ما تلزقش في بعض ("إزيك" مش "عليكمإزيك").
      finalizedRef.current = joinChunks(finalizedRef.current, finalText)
      // النص المعروض = الأساس + النهائي المتراكم + المبدئي اللحظي، بينهم مسافات.
      const next = joinChunks(compose(baseRef.current, finalizedRef.current), interimText.trim())
      if (next && next !== lastSentRef.current) {
        lastSentRef.current = next
        optionsRef.current.onText(next)
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
      if (lockedRef.current && !failedRef.current) {
        // وضع القفل: المتصفح قفل الجلسة عند الصمت رغم إننا لسه مقفولين،
        // فبنبدأ جلسة جديدة عشان المايك يفضل سامع. النص النهائي محفوظ في
        // finalizedRef والأساس في baseRef، فالإعادة بتكمّل من غير تكرار.
        baseRef.current = finalizedRef.current
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
    } catch {
      // start() بيقدر يرمي لو الجلسة السابقة لسه مـ finalizing
      recognitionRef.current = null
      lockedRef.current = false
      setLocked(false)
      setListening(false)
      optionsRef.current.onError("failed")
    }
  }, [clearRestartTimer])

  useEffect(() => {
    beginRef.current = beginSession
  }, [beginSession])

  const start = useCallback(() => {
    if (!getSpeechRecognitionCtor() || recognitionRef.current) {
      return
    }
    // بداية استماع جديدة من ضغطة المستخدم: الأساس يتثبّت على اللي في الحقل
    // دلوقتي، والتراكم يبدأ من الصفر.
    baseRef.current = optionsRef.current.baseText
    finalizedRef.current = ""
    lastSentRef.current = baseRef.current
    beginSession()
  }, [beginSession])

  const stop = useCallback(() => {
    // stop() مش abort(): بيسيب النتيجة النهائية تكتمل قبل ما الـ onend يجي
    lockedRef.current = false
    setLocked(false)
    clearRestartTimer()
    recognitionRef.current?.stop()
  }, [clearRestartTimer])

  // قفل/إلغاء قفل الاستماع. القفل بيخلي الجلسة تفضل سامعة: المتصفح بيقفلها
  // عند الصمت وبنرجّع نفتحها تاني عشان ما يقفلش من نفسه.
  const toggleLock = useCallback(() => {
    if (!recognitionRef.current) {
      return
    }
    const next = !lockedRef.current
    lockedRef.current = next
    setLocked(next)
  }, [])

  // ميكروفون مفتوح وهو مفيش مكوّن يستقبل الكلام = تسريب؛ اقفل الجلسة مع unmount
  useEffect(() => () => {
    clearRestartTimer()
    recognitionRef.current?.abort()
  }, [clearRestartTimer])

  return { supported, listening, locked, start, stop, toggleLock }
}
