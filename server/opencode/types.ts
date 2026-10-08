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
  // عدد المحادثات الجذرية في المشروع — بيتحسب أثناء بناء القائمة من نفس
  // ليستة الجلسات المقروءة أصلًا، فالملخص بتاع المشروع ما بيكلفش نداء إضافي.
  // (مهام Task الفرعية لا تُعدّ: المستخدم شايف محادثة واحدة.)
  sessionCount?: number
}

export type SessionStatus = { type: "idle" } | { type: "busy" } | { type: "retry" }

export interface EnginePermission {
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

export type AttentionItem = (AttentionContext & {
  kind: "question"
  request: ConversationQuestionRequest
}) | (AttentionContext & {
  kind: "permission"
  permission: EnginePermission
})

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
  // المسار الكامل يُملأ فقط عندما يكون المسار القادم من بيانات المحرك مطلقًا
  // فعلًا. لو المصدر مسار نسبي (مشروع-نسبي) يفضل فاضي عشان الواجهة تعرض
  // النسبي بدل ما تخترع مسارًا مطلقًا قد يكون غلطًا.
  fullPath: string
  downloadUrl: string
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
  steps: number
  files: ResultFile[]
}

export type RequestState = "queued" | "running" | "done" | "stopped" | "skipped"

// استخدام الرموز كما يرجعه المحرك لكل رد assistant. المجموع بمعادلة OpenCode
// نفسها (الإدخال + الإخراج + التفكير + قراءة الكاش + كتابة الكاش) عشان الرقم
// المعروض يطابق إحصاءات المحرك. total يُحسب على السيرفر مرة واحدة.
export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface RequestUsage {
  // null يعني المحرك لم يرجع أي أرقام رموز موثوقة لهذا الطلب — لا تقدير
  tokens: TokenUsage | null
  // null يعني التكلفة غير معروفة، وليس صفرًا. الصفر قيمة حقيقية لنموذج مجاني.
  cost: number | null
}

// ملخص استهلاك الجلسة: مجموع الطلبات المنتهية والمستمرة مع عدد الطلبات
// ومدة العمل. الطلبات المستنية في الطابور لا تُحتسب قبل أن لها رسائل فعلية.
export interface SessionUsage extends RequestUsage {
  requests: number
  durationMs: number
}

// مرفق أرسله المستخدم مع الطلب (صورة/PDF/نص). بيُقرأ من `files` على رسالة
// المستخدم عشان الواجهة تعرض اللي اتبعت بدل ما تختفي بعد لحظة الإرسال،
// وبيغذّي `files` مباشرة قبل الانضمام للمحرك.
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
  // النص الحي للرد الجاري (يُملأ أثناء state=running فقط) — نفس رسائل
  // opencode وهي بتتكتب، قبل ما تكتمل وتبقى finalResult.
  liveText: string
  stepsCompleted: number
  activeTool: string | null
  // أدوات المهمة الحالية بترتيب استخدامها ("قائمة المستخدم" في واجهة
  // الديسكتوب)، مترجمة على السيرفر. الواجهة بتعرضها واحدة واحدة بدل قائمة طويلة.
  usedTools: string[]
  resultFiles: ResultFile[]
  // استهلاك الرموز والتكلفة لهذا الطلب من ردود المحرك الفعلية
  usage: RequestUsage
  // مرفقات المستخدم في هذا الطلب — بتُقرأ من رسالة المستخدم عشان تفضل ظاهرة.
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
  // ملخص استهلاك الجلسة كله — بيتحسب من نفس رسائل المحرك المقروءة أصلًا
  usage: SessionUsage
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
  // قدرات الإدخال حسب المحرك: text / image / pdf. الواجهة بتقفل زرار الصورة
  // أو PDF على أساسها. غيابها = النموذج مش معروف للمحرك لسه (كتالوج قديم)
  // فما نقفلش زرار النص، لكن الصور تتفلتر حسب اللي معروف.
  capabilities?: { input: string[] }
}

// مرفق مرسل مع الطلب: `uri` لازم يكون رابط data: (محتوى مضمّن). OpenCode
// ما بيدعمش روابط HTTP للمرفقات، وملفات المتصفح مش متاحة للمحرك أصلاً،
// فالترميز المضمّن هو الطريق الوحيد من الهاتف.
export interface PromptAttachment {
  uri: string
  name?: string
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

// طلب مفضّل — نص كامل كما حفظه المستخدم + اسم عرض قصير قابل لإعادة التسمية.
// مفيش أي ربط بجلسة أو مشروع: حذف الجلسة اللي اتحفظ منها مايأثرش على
// المفضّلة، والطلب يفضل قابلًا للاستخدام في أي مشروع.
export interface FavoritePrompt {
  id: string
  text: string
  label: string
  createdAt: number
}
