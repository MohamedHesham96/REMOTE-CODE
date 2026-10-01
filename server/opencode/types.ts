import type {
  FormInfo,
  OpenCodeClient,
  OpenCodeEvent,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client"

// الأشكال السلكية (wire) التي يتكلم بها `/api/*` مع الواجهة ثابتة منذ v1،
// فطبقة المحرك تترجم إليها بدل كشف أنواع المحرك الخام. بهذا لا تتغير
// الواجهة ولا الاختبارات السلوكية مع تبديل المحرك تحتها.
export interface Session {
  id: string
  title: string
  directory: string
  time: { created: number; updated: number }
}

export interface Project {
  id: string
  worktree: string
  name?: string
  time: { created: number; updated: number }
}

export type SessionStatus = { type: "idle" } | { type: "busy" } | { type: "retry" }

// v2 بلا قائمة مهام — الحقل باقٍ في العقد فارغًا حتى لا تتغير الواجهة.
export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

export interface EnginePermission {
  id: string
  sessionID: string
  title: string
  pattern?: string
}

export type { FormInfo, OpenCodeClient, OpenCodeEvent, SessionInfo, SessionMessageInfo }

export interface ServiceOptions {
  projectDirectory: string
  serverUrl?: string
}

export interface GitChangeFile {
  path: string
  status: "added" | "deleted" | "modified"
  added: number
  removed: number
}

export interface GitChanges {
  branch: string
  available: boolean
  files: GitChangeFile[]
  // عدد الـ commits على الفرع المحلي اللي لسه ما وصلتش للفرع البعيد. صفر
  // لما مفيش upstream متظبط — مش معناه "متأكد إنه مفيش"، وده مقصود عشان
  // ما نعرضش رقم مخترع على مستودع ما بقيناش عارفين حالته.
  unpushed: number
}

export interface ResultFile {
  id: string
  name: string
  mime: string
  path: string
  url: string
  downloadUrl: string
  source: "attachment" | "output"
  size?: number
}

export interface ConversationQuestionOption {
  label: string
  description: string
}

export interface ConversationQuestion {
  question: string
  header: string
  options: ConversationQuestionOption[]
  multiple: boolean
  custom: boolean
}

export interface ConversationQuestionRequest {
  id: string
  sessionID: string
  questions: ConversationQuestion[]
}

export interface HistoryTurn {
  id: string
  index: number
  prompt: string
  finalResult: string
  createdAt: number
  completedAt: number
  steps: number
  files: ResultFile[]
}

export type RequestState = "queued" | "running" | "done" | "stopped"

export interface SessionRequest {
  id: string
  index: number
  prompt: string
  state: RequestState
  activity: string
  finalResult: string
  // النص الحي للرد الجاري (يُملأ أثناء state=running فقط) — نفس رسائل
  // opencode وهي بتتكتب، قبل ما تكتمل وتبقى finalResult.
  liveText: string
  stepsCompleted: number
  activeTool: string | null
  todos: Todo[]
  completedTodos: number
  totalTodos: number
  resultFiles: ResultFile[]
  startedAt: number
  completedAt: number
  updatedAt: number
}

export interface SessionRequests {
  status: SessionStatus
  requests: SessionRequest[]
  questions: ConversationQuestionRequest[]
  queued: number
  // حكم كاشف الجمود: OpenCode واقف على busy من غير أي بصمة تقدّم تتغيّر
  // فوق مهلة BUSY_STALL_MS. بيتبعت صريح عشان الواجهة تعرض "متجمّدة" بدل
  // ما تستنتج الجمود من صمت — وكمان لأن effectiveStatus بيحوّل الحالة
  // لـ idle عند الجمود، فبدون الحقل ده المهمة المجمّدة كانت هتبان "خلصت".
  stalled: boolean
  // بصمة خفيفة للحالة الكاملة: السيرفر بيحسب ETag منها، والعميل يوفّر
  // إعادة التحميل لما مفيش تغيير (304). أي تغيير في النص الحي، الحالة،
  // الطابور، الأسئلة أو حكم الجمود لازم يغيّرها — وإلا يحصل stale.
  version: string
}

export interface ModelInfo {
  id: string
  providerID: string
  name: string
  free: boolean
  enabled: boolean
  status?: string
  // الـ variants اللي OpenCode بيسمح بيها للموديل ده (مثل high / max / low)
  variants?: string[]
}

export interface ActiveSession {
  id: string
  title: string
  directory: string
  worktree: string
  projectName: string
  status: SessionStatus
  updatedAt: number
}

// محادثة مثبّتة — مخزّنة على السيرفر عشان تظهر في كل الأجهزة، ومعاه كل
// بياناتها اللي اللوحة بتحتاجها لعرضها وفتحها من غير ما يكون مشروعها هو الحالي.
export interface PinnedConversation {
  id: string
  title: string
  created: number
  // مكان الجلسة الحقيقي — projectID/المشروع بيتغيّروا مع الوقت
  directory: string
  // worktree المشروع وقت التثبيت: بنليني بيه المشروع لما نفتح المحادثة
  worktree: string
  // معرّف المشروع الثابت (المسار المطبّع) — هو اللي بيقسّم المثبّتات بين
  // المشاريع، مش الـ id. فاضي = مشروع المحادثة لسه مجهول (كاش قديم من غير
  // مسار): بتتخزّن عادي بس ما بتظهرش في أي مشروع لحد ما نعرف مشروعها.
  projectKey: string
  projectName: string
}

export interface SessionModelRef {
  providerID: string
  modelID: string
  variant?: string
}
