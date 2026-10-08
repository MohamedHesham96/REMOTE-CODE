// أنواع الواجهة مفصولة عن محرك OpenCode: عقد `/api/*` السلكي ثابت،
// فهذه الأشكال المحلية هي المرجع الوحيد هنا بدل أنواع SDK الخام.
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
  // عدد محادثات المشروع — بيتحسب على السيرفر من نفس ليستة الجلسات المقروءة
  // أصلًا، فالملخص المفصّل للمشروع ما بيكلفش أي طلب إضافي للعميل.
  sessionCount?: number
}

export interface SessionStatus {
  type: "idle" | "busy" | "retry"
}

export interface Permission {
  id: string
  sessionID: string
  title: string
  pattern?: string | string[]
}

export interface AttentionContext {
  sessionID: string
  conversationID: string
  sessionTitle: string
  projectName: string
  directory: string
}

export interface QuestionAttentionItem extends AttentionContext {
  kind: "question"
  request: ConversationQuestionRequest
}

export interface PermissionAttentionItem extends AttentionContext {
  kind: "permission"
  permission: Permission
}

export type AttentionItem = QuestionAttentionItem | PermissionAttentionItem

interface ServerEventBase {
  properties: {
    sessionID: string
    [key: string]: unknown
  }
}

// أحداث السيرفر على السلك — نفس الأسماء منذ v1، والمحتوى مترجَم في
// server/sse/filter.ts من أحداث v2.
export interface StatusServerEvent extends ServerEventBase {
  type: "session.status"
  properties: { sessionID: string; status: SessionStatus; [key: string]: unknown }
}

export interface IdleServerEvent extends ServerEventBase {
  type: "session.idle"
}

export interface ErrorServerEvent extends ServerEventBase {
  type: "session.error"
}

export interface MessageRefreshServerEvent {
  type: "message.part.updated" | "session.diff"
  properties: { sessionID?: string; [key: string]: unknown }
}

export interface PermissionUpdatedServerEvent {
  type: "permission.updated"
  properties: Permission
}

export interface PermissionRepliedServerEvent {
  type: "permission.replied"
  properties: { sessionID: string; permissionID: string }
}

export interface SessionListServerEvent extends ServerEventBase {
  type: "session.created" | "session.updated" | "session.deleted"
}

export type ServerEvent =
  | StatusServerEvent
  | IdleServerEvent
  | ErrorServerEvent
  | MessageRefreshServerEvent
  | PermissionUpdatedServerEvent
  | PermissionRepliedServerEvent
  | SessionListServerEvent

export type AuthState = "loading" | "signedOut" | "signedIn"

export type ToastKind = "info" | "success" | "error"

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export interface ProjectResponse {
  projects: Project[]
  selected: Project | null
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

export type ConversationQuestionAnswers = string[][]

export type QuestionClientEventType =
  | "question.asked"
  | "question.replied"
  | "question.rejected"

export interface QuestionClientEvent {
  type: QuestionClientEventType
  properties: {
    sessionID: string
    requestID?: string
  }
}

export type ClientEvent = ServerEvent | QuestionClientEvent

// حالة كل طلب داخل الجلسة: مستخبي في الطابور، شغّال دلوقتي، خلص، اتوقف،
// أو اتخطّاه المستخدم بإيده وهو شغّال. التخطّي حالة مستقلة عن "تمت" لأن
// المحرك بيقفل رسالة الطلب كأنها خلصت، والمستخدم لازم يشوف إنه هو اللي
// تخطّاه مش إن الشغل نجح.
export type RequestState = "queued" | "running" | "done" | "stopped" | "skipped"

// الطلبات بتتراص في كارت واحد على شكل قائمة — الأقدم فوق والأحدث تحت.
// مرفق أرسله المستخدم مع الطلب — بيُعرض في صف الطلب (صور مصغّرة/أسماء).
// `uri` إما رابط data: أو رابط قابل للعرض مباشرة.
export interface RequestAttachment {
  name: string
  mime: string
  uri: string
}

export interface SessionRequest {
  id: string
  index: number
  prompt: string
  state: RequestState
  activity: string
  finalResult: string
  // النص الحي للرد الجاري أثناء التنفيذ (فارغ بعد الاكتمال)
  liveText: string
  stepsCompleted: number
  activeTool: string | null
  // أدوات المهمة الحالية بترتيب استخدامها ("قائمة المستخدم" في واجهة
  // الديسكتوب)، مترجمة على السيرفر. الواجهة بتعرضها واحدة واحدة.
  usedTools: string[]
  resultFiles: ResultFile[]
  // مرفقات المستخدم اللي اتبعتت مع الطلب دي (صور/ملفات) — عشان تفضل ظاهرة
  // بجانب نص الطلب بدل ما تختفي بعد الإرسال.
  attachments: RequestAttachment[]
  startedAt: number
  completedAt: number
  updatedAt: number
  error?: string
  retryAgent?: string
  retryModel?: SessionModelRef
}

export interface SessionRequests {
  status: SessionStatus
  requests: SessionRequest[]
  questions: ConversationQuestionRequest[]
  queued: number
  // حكم كاشف الجمود في السيرفر — اتقفل عليه بعد مهلة بلا أي بصمة تقدّم
  // تتغيّر. بيتحوّل معه status لـ idle، فلو الواجهة اعتمدت على status بس
  // كانت هتعرض المهمة المجمّدة كأنها "خلصت".
  stalled: boolean
  // بصمة الحالة من السيرفر لدعم ETag/304 — غيابها (ردود قديمة) يعني "دايمًا جديد"
  version: string
}

// حالة المهمة كما تُعرض في لوحة الحالة أعلى الكارت. الترتيب مقصود: كل حالة
// تُقاس قبل التي بعدها، فالجمود بيتقدّم على كل حاجة عشان المهمة الواقفة ما
// تبانش شغّالة (زي ما الكارت القديم كان بيعمل).
export type TaskPhase = "running" | "waiting" | "stuck" | "error" | "completed" | "skipped"

export interface ResultFile {
  id: string
  name: string
  mime: string
  path: string
  downloadUrl: string
}

export interface AppConfig {
  openCode: {
    healthy: boolean
    version: string
  }
  push: {
    enabled: boolean
    publicKey: string | null
  }
  secureContext: boolean
}

export interface PushSubscriptionJson {
  endpoint: string
  expirationTime?: number | null
  keys: {
    auth: string
    p256dh: string
  }
}

export interface ModelInfo {
  id: string
  providerID: string
  name: string
  free: boolean
  enabled: boolean
  status?: string
  variants?: string[]
  // قدرات الإدخال: text / image / pdf. الواجهة بتقفل زرار الصورة أو PDF
  // حسبها. غيابها = النموذج مش معروف لسه، فالصور تتعامل كغير مدعومة.
  capabilities?: { input: string[] }
}

// مرفق محمّل في الكومبوزر قبل الإرسال: `uri` رابط data: مضمّن (نفس الشكل
// اللي OpenCode بيقبله)، والباقي للعرض والإزالة.
export interface ComposerAttachment {
  id: string
  name: string
  mime: string
  size: number
  uri: string
}

export interface SessionModelRef {
  providerID: string
  modelID: string
  variant?: string
}

export interface SessionModelState {
  model: SessionModelRef | null
  defaultModel: SessionModelRef | null
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

// محادثة مثبّتة — مصدرها السيرفر (مش localStorage) عشان تظهر في كل الأجهزة
// وتفضل بعد ما المتصفح يعمل refresh. ومعاه كل بياناته عشان اللوحة تعرضها
// وتفتحها. projectKey = معرّف المشروع الثابت اللي بتتبّpan بيه (مش الـ id).
export interface PinnedConversation {
  id: string
  title: string
  created: number
  directory: string
  worktree: string
  // معرّف المشروع الثابت (المسار المطبّع). فاضي = مشروع المحادثة لسه مجهول
  // (كاش قديم من غير مسار): ما بتظهرش في أي مشروع لحد ما السيرفر يعرفها.
  projectKey: string
  projectName: string
}

export interface HistoryTurn {
  id: string
  index: number
  prompt: string
  finalResult: string
  createdAt: number
  steps: number
  files: ResultFile[]
}

// طلب مفضّل — نص كامل + اسم عرض قصير. مفيش ربط بجلسة أو مشروع، فحذف
// الجلسة اللي اتحفظ منها مايأثرش على المفضّلة.
export interface FavoritePrompt {
  id: string
  text: string
  label: string
  createdAt: number
}

export type GitChangeStatus = "added" | "deleted" | "modified"

export interface GitChangeFile {
  path: string
  status: GitChangeStatus
  added: number
  removed: number
}

// حالة git للمشروع المختار — available = false لما المشروع مش مستودع git.
export interface GitChanges {
  branch: string
  available: boolean
  files: GitChangeFile[]
  // عدد الـ commits اللي لسه ما اتدفعتش — بيظهر على زرار commit & push.
  // صفر معناه "مفيش حاجة مستنية push" أو "مفيش upstream متظبط".
  unpushed: number
}
