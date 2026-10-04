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

export type VoiceInputErrorKind = "unsupported" | "denied" | "failed"

export interface UseVoiceInputOptions {
  // وسم لغة التعرف (BCP-47، مثل "ar-EG"). undefined = اتبع لغة الجهاز.
  language?: string
  // بتتستدعى مع النص المتعرف عليه (النهائي + المبدئي المتراكم) عند كل تحديث
  onTranscript: (text: string) => void
  // بتتستدعى عند خطأ يمنع التعرف من الأصل (رفض المايك / فشل عام)
  onError: (kind: VoiceInputErrorKind) => void
}

export interface UseVoiceInputResult {
  supported: boolean
  listening: boolean
  start: () => void
  stop: () => void
}

export function useVoiceInput({ language, onTranscript, onError }: UseVoiceInputOptions): UseVoiceInputResult {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== undefined)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null)
  // أحدث نسخة من الـ callbacks: التعرف بيتعمل مرة واحدة عند كل start() بس،
  // فلازم يقرا أحدث قيمة من غير ما نعيد إنشاء الجلسة عشان نص واحد قديم
  const callbacksRef = useRef({ onTranscript, onError })
  useEffect(() => {
    callbacksRef.current = { onTranscript, onError }
  }, [onTranscript, onError])

  // جلسة جديدة لكل start(): متصفحات كتير بتسقط الجلسة بعد أول onend، فبناء
  // واحدة جديدة مضمون أكتر من محاولة إعادة استخدام نفس الكائن
  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor || recognitionRef.current) {
      return
    }
    const recognition = new Ctor()
    // اللغة جايه من إعداد الإدخال الصوتي؛ لو "تلقائي" نتبع لغة الجهاز
    // (navigator.language) لأنها الأصدق للغة اللي المستخدم بيتكلم بيها فعلاً.
    recognition.lang = language ?? deviceLanguage() ?? "en-US"
    // continuous=false: الصمت بعد الكلام بيقفل التعرف لوحده، فالمستخدم
    // بيخلص جملته ومش محتاج يفتكر يضغط إيقاف
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    // النص بيتجمع على مراحل: النهائي ثابت داخل closure الجلسة (مش ref)
    // عشان كل onresult لاحق يبني على اللي قبله، والمبدئي بيظهر لحظيًا
    // ويتبدل مع كل تصحيح في الكلام
    let finalText = ""
    recognition.onresult = (event) => {
      let interimText = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      const combined = `${finalText}${interimText}`.trim()
      if (combined) {
        callbacksRef.current.onTranscript(combined)
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
      callbacksRef.current.onError(kind)
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      // start() بيقدر يرمي لو الجلسة السابقة لسه مـ finalizing
      recognitionRef.current = null
      callbacksRef.current.onError("failed")
    }
  }, [language])

  const stop = useCallback(() => {
    // stop() مش abort(): بيسيب النتيجة النهائية تكتمل قبل ما الـ onend يجي
    recognitionRef.current?.stop()
  }, [])

  // ميكروفون مفتوح وهو مفيش مكوّن يستقبل الكلام = تسريب؛ اقفل الجلسة مع unmount
  useEffect(() => () => recognitionRef.current?.abort(), [])

  return { supported, listening, start, stop }
}