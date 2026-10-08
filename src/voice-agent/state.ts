// آلة حالات واجهة التحكم الصوتي كدالة بحتة — عشان كل حالة (استماع، معالجة،
// تنفيذ، نجاح، خطأ، إلغاء، غير مدعوم، إذن مرفوض، انتظار رد) تُختبر من غير
// متصفح. الهوك بيستخدم useReducer بنفس الدالة، فالواجهة ما تقدرش تدخل حالة
// غير معرّفة هنا.
export type VoiceControlPhase =
  | "idle"
  | "listening"
  | "processing"
  | "executing"
  | "success"
  | "error"
  | "cancelled"
  | "unsupported"
  | "permission-denied"
  | "awaiting"

export type VoiceFeedbackTone = "info" | "success" | "error"

export interface VoiceControlState {
  phase: VoiceControlPhase
  // النص الجاري (مبدئي + نهائي) اللي بيتعرض أثناء الاستماع
  transcript: string
  // آخر تفريغ نهائي — بيفضل معروض بعد انتهاء الاستماع للمراجعة
  heard: string
  feedback: string
  tone: VoiceFeedbackTone
  planLines: string[]
  pendingKind: "clarify" | "confirm" | "preview" | null
  pendingQuestion: string
  candidates: string[]
}

export const INITIAL_VOICE_CONTROL_STATE: VoiceControlState = {
  phase: "idle",
  transcript: "",
  heard: "",
  feedback: "",
  tone: "info",
  planLines: [],
  pendingKind: null,
  pendingQuestion: "",
  candidates: [],
}

export type VoiceControlEvent =
  | { type: "unsupported" }
  | { type: "permission-denied" }
  | { type: "start" }
  | { type: "transcript"; text: string }
  | { type: "process"; text: string }
  | { type: "heard"; text: string }
  | { type: "await"; question: string; pendingKind: "clarify" | "confirm" | "preview"; candidates?: string[]; planLines?: string[] }
  | { type: "execute"; planLines: string[] }
  | { type: "success"; feedback: string; planLines?: string[]; keepPending?: boolean }
  | { type: "error"; feedback: string; keepPending?: boolean }
  | { type: "cancelled"; feedback: string }
  | { type: "stopped" }
  | { type: "reset" }

export function reduceVoiceControl(state: VoiceControlState, event: VoiceControlEvent): VoiceControlState {
  switch (event.type) {
    case "unsupported":
      return { ...INITIAL_VOICE_CONTROL_STATE, phase: "unsupported" }
    case "permission-denied":
      return { ...INITIAL_VOICE_CONTROL_STATE, phase: "permission-denied" }
    case "start":
      // بداية استماع جديدة: ننضّف النص والتغذية الراجعة، ونسيب السؤال المعلّق
      // معروض لو المستخدم بيرد على توضيح/تأكيد
      return {
        ...state,
        phase: "listening",
        transcript: "",
        feedback: "",
        tone: "info",
        planLines: [],
      }
    case "transcript":
      return { ...state, phase: "listening", transcript: event.text }
    case "heard":
      // آخر تفريغ نهائي بيفضل معروض بعد ما الجلسة تقفل، للشفافية والمراجعة
      return { ...state, heard: event.text, transcript: event.text }
    case "process":
      return { ...state, phase: "processing", transcript: event.text }
    case "await":
      return {
        ...state,
        phase: "awaiting",
        feedback: "",
        tone: "info",
        planLines: event.planLines ?? [],
        pendingKind: event.pendingKind,
        pendingQuestion: event.question,
        candidates: event.candidates ?? [],
      }
    case "execute":
      return { ...state, phase: "executing", planLines: event.planLines, pendingKind: null, pendingQuestion: "", candidates: [] }
    case "success":
      // keepPending للردود اللي بتسيب سؤال معلّقًا شغّالًا (إجابة غير مفهومة
      // على توضيح): السؤال والمرشحين بيفضلوا معروضين لحد ما يفهم
      return {
        ...state,
        phase: "success",
        feedback: event.feedback,
        tone: "success",
        planLines: event.planLines ?? [],
        ...(event.keepPending ? {} : { pendingKind: null, pendingQuestion: "", candidates: [] }),
      }
    case "error":
      // خطأ أثناء انتظار رد (فشل مايك مثلًا) بيسيب السؤال معروضًا — المستخدم
      // يقدر يرد تاني أو يلغي
      return {
        ...state,
        phase: "error",
        feedback: event.feedback,
        tone: "error",
        ...(event.keepPending ? {} : { pendingKind: null, pendingQuestion: "", candidates: [] }),
      }
    case "cancelled":
      return { ...state, phase: "cancelled", feedback: event.feedback, tone: "info", planLines: [], pendingKind: null, pendingQuestion: "", candidates: [] }
    case "stopped":
      // إيقاف الاستماع بدون إلغاء الطلب المعلّق — نرجع للخمول والسؤال فاضل
      return { ...state, phase: "idle", transcript: "", feedback: "", tone: "info", planLines: [] }
    case "reset":
      return INITIAL_VOICE_CONTROL_STATE
  }
}
