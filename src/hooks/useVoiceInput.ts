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
  // مؤقت الصمت في الوضع غير المقفول: بيتصفّر مع كل نتيجة، ولما السكون يكمل
  // مهلة الصمت بنقفل الجلسة. في وضع القفل بيتم تجاهله خالص.
  const silenceTimerRef = useRef<number | null>(null)
  // بناء جلسة جديدة من جوه onend من غير مرجعية ذاتية على start.
  const beginRef = useRef<() => void>(() => {})

  // النص النهائي المتفَق عليه من الجلسات اللي فاتت + نص الحقل الأصلي. ده اللي
  // بنبني عليه الجلسة الجارية، وبيتحدّث **مرة واحدة** عند إعادة التشغيل في
  // اللوك أو تبديل القفل. المجموع المعروض = baseRef + نص الجلسة الحالي.
  const baseRef = useRef("")
  // آخر نص كامل بعتناه للحقل — بنقارن بيه عشان ما نبعتش نفس النص مرتين.
  const lastSentRef = useRef("")
  // آخر نص نهائي اتعرّف عليه في الجلسة. بنستخدمه للحالتين: نرصد لو المتصفح بدأ
  // مصفوفة نتائج جديدة (فبنضم القديم للأساس مرة واحدة)، وعند إعادة التشغيل في
  // اللوك بنضمه للأساس. بيبدأ فاضي مع كل جلسة.
  const lastFinalRef = useRef("")
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

    // نص الجلسة (المحلي) يبدأ من الصفر؛ التراكم بيتخزّن في baseRef عند الإعادة
    // بس (إعادة تشغيل في اللوك أو تبديل القفل).
    lastFinalRef.current = ""

    // نص الجلسة بيتحسب من مصفوفة النتائج الكاملة **من الأول في كل حدث**. ده
    // المصدر الوحيد للحقيقة: في continuous mode الـ results شايلة كل النتائج
    // النهائية من أول الجلسة، فمفيش داعي نجمع بأنفسنا (اللي كان بيكرّر) ولا
    // نرصد تقلّص المبدئي (اللي كان بيلخبط الأساس في اللوك). المجموع المعروض =
    // الأساس المتفَق عليه + نص الجلسة الحالي.
    recognition.onresult = (event) => {
      let finalText = ""
      let interimText = ""
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        // التصنيف على أساس isFinal لكل نتيجة لوحدها. من غير أي اعتماد على
        // resultIndex: في continuous mode النتيجة اللي كانت نهائية ممكن
        // المحرّك يرجّعها مبدئية تاني وهو بيصحّح، فتعاملها كنهائية كان بيخلط
        // الكلام ("howhowhowhow are"). isFinal هو المصدر الوحيد للحقيقة.
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      finalText = finalText.trim()
      // لو نص الحدث الحالي مش بيكمل نص الحدث اللي قبله (المتصفح بدأ مصفوفة
      // نتائج جديدة لجملة جديدة)، نضم النص القديم للأساس مرة واحدة عشان ما
      // يضيعش. لو بيكمله (نفس الجلسة بتكبر) مش محتاجين أي حاجة.
      const previousFinal = lastFinalRef.current
      if (previousFinal && !finalText.startsWith(previousFinal)) {
        baseRef.current = joinChunks(baseRef.current, previousFinal)
      }
      lastFinalRef.current = finalText
      const next = joinChunks(compose(baseRef.current, finalText), interimText.trim())
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
        // الكلام اللي اتقال (lastFinalRef هيتصفّر في beginSession).
        baseRef.current = joinChunks(baseRef.current, lastFinalRef.current)
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
    baseRef.current = optionsRef.current.baseText
    lastSentRef.current = baseRef.current
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
  // يقفلها المستخدم). بندفع النص النهائي الحالي للأساس مرة واحدة، ومش محتاجين
  // نعيد بناء الجلسة لأن continuous=true في الحالتين.
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
