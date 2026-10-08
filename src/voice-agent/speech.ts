// أنواع Web Speech API المستخدمة في التطبيق. lib.dom القياسية عندها كائنات
// النتائج بس، والمتصفحات بتعرّف المُنشئ تحت اسمين (SpeechRecognition و
// webkitSpeechRecognition)؛ التعريف هنا أدنى حد التشغيل عايزه ومش واجهة
// كاملة للـ API. الطبقة دي مشتركة بين الإملاء في الكومبوزر والتحكم الصوتي.
export interface SpeechRecognitionInstanceLike {
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

export interface SpeechRecognitionResultEventLike {
  resultIndex: number
  results: SpeechRecognitionResultList
}

export interface SpeechRecognitionErrorEventLike {
  error: string
}

export type SpeechRecognitionCtorLike = new () => SpeechRecognitionInstanceLike

interface WindowWithSpeechRecognition {
  SpeechRecognition?: SpeechRecognitionCtorLike
  webkitSpeechRecognition?: SpeechRecognitionCtorLike
}

// الكشف مرة واحدة على الواجهة: لو المُنشئ مش موجود نتجاهل الميزة نهائيًا
// بدل ما نحاول ونفشل في كل ضغطة.
export function getSpeechRecognitionCtor(): SpeechRecognitionCtorLike | undefined {
  const enhancedWindow = window as unknown as WindowWithSpeechRecognition
  return enhancedWindow.SpeechRecognition ?? enhancedWindow.webkitSpeechRecognition
}

// لغة الجهاز الفعلية (navigator.language) — هي الأصدق للتعرف على الصوت:
// بتعكس اللغة اللي المستخدم بيتكلم بيها فعلًا، مش لغة واجهة التطبيق.
export function deviceSpeechLanguage(): string | undefined {
  const value = navigator.language?.trim()
  return value || undefined
}
