import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import {
  ApiError,
  abortSession,
  base64ToUint8Array,
  createSession,
  deleteSession,
  downloadCertificate,
  getActivity,
  getConfig,
  getGitChanges,
  getHistory,
  getModels,
  getProjects,
  getRequests,
  getSessionModel,
  getStatuses,
  listPermissions,
  listSessions,
  login,
  logout,
  removeQueuedRequest,
  renameSession,
  replyPermission,
  runQueuedRequest,
  selectProject,
  sendMessage,
  setSessionModel,
  skipRunningRequest,
  subscribePush,
  unsubscribePush,
} from "./api"
import type { ActiveSession, AppConfig, AuthState, ClientEvent, ComposerAttachment, ConversationQuestionRequest, GitChanges, HistoryTurn, ModelInfo, Permission, PinnedConversation, Project, Session, SessionModelRef, SessionRequest, SessionRequests, SessionStatus, Toast, ToastKind } from "./types"
import { isSoundEnabled, playAttentionSound, playCompletionSound, setSoundEnabled, unlockAudio, vibrate } from "./sound"
import { applyTheme, getSavedTheme, nextTheme, saveTheme, themeLabel, THEME_META, type AppTheme } from "./theme"
import { applyLanguage, getSavedLanguage, getStrings, saveLanguage, type Language } from "./i18n"
import { getSavedVoiceLanguage, saveVoiceLanguage, type VoiceLanguage } from "./voice"
import {
  displayTitle,
  getVarietyLevels,
  projectName,
  samePath,
  shortModelName,
} from "./display"
import { ACTIVE_GRACE_MS, RECENT_PROJECTS_KEY, emptyConfig } from "./constants"
import { releases } from "./releases-data"
import { PanelFallback } from "./components/PanelFallback"
import { PanelErrorBoundary } from "./components/PanelErrorBoundary"
import { PermissionCard } from "./components/PermissionCard"
import { ComposerAttachments } from "./components/ComposerAttachments"
import { ComposerClipboardButton } from "./components/ComposerClipboardButton"
import { ComposerInput } from "./components/ComposerInput"
import { ProjectPicker } from "./components/projects/ProjectPicker"
import { Sidebar } from "./components/Sidebar"
import { TopBar } from "./components/TopBar"
import { StickyQuestions } from "./components/requests/StickyQuestions"
import { RequestCard } from "./components/requests/RequestCard"
import { VoiceButton } from "./components/VoiceButton"
import { useActivityGrace } from "./hooks/useActivityGrace"
import { useEventStream } from "./hooks/useEventStream"
import { useGitRequests } from "./hooks/useGitRequests"
import { usePinnedConversations } from "./hooks/usePinnedConversations"
import { useScrollToBottom } from "./hooks/useScrollToBottom"
import { useSettledStatuses } from "./hooks/useSettledStatuses"
import { mergeActiveSessions } from "./utils/active-sessions"
import { addAttachmentFiles, attachmentRejectionMessage, modelSupports } from "./utils/attachments"
import { normalizeProjectPath } from "./utils/paths"
import { forgetLastSession, isRequestsEmpty, loadDefaultModel, loadLastSessions, loadRecentProjects, saveDefaultModel, saveLastSession, sessionMatches, sortSessionsByCreated } from "./utils/storage"

// أدراج ثقيلة تُحمّل عند الطلب فقط (code-splitting): القائمة الرئيسية
// والشات يظهران فورًا، وهذه اللوحات تنزل عند أول فتح لها
const ModelPicker = lazy(() => import("./panels").then((module) => ({ default: module.ModelPicker })))
const ActiveSessionsPanel = lazy(() => import("./panels").then((module) => ({ default: module.ActiveSessionsPanel })))
const GitChangesPanel = lazy(() => import("./panels").then((module) => ({ default: module.GitChangesPanel })))
const HistoryPanel = lazy(() => import("./panels").then((module) => ({ default: module.HistoryPanel })))
const PinnedConversationsPanel = lazy(() => import("./panels").then((module) => ({ default: module.PinnedConversationsPanel })))
// ملاحظات الإصدار: ثابتة ومولّدة من تاريخ Git، فتُحمّل مع اللوحات الكسولة
// عند فتحها فقط ولا تضيف أي طلب شبكة.
const ReleaseNotesPanel = lazy(() => import("./panels").then((module) => ({ default: module.ReleaseNotesPanel })))
// درج الإعدادات: في الإصدار القديم كان inline داخل App.tsx — فكل ما الـ App
// اترسم، JSX الـ drawer اتبنى ومعاها الـ handlers. lazy() يخليها تتحمّل أول
// مرة المستخدم يفتح الإعدادات بس.
const SettingsDrawer = lazy(() => import("./panels").then((module) => ({ default: module.SettingsDrawer })))

interface InstallPrompt {
  preventDefault: () => void
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

// Set فاضي مُجمّع عشان نرجّع نفس المرجع من useMemo لو مفيش طلب معلّق
// في الجلسة — `mergeActiveSessions` بياخد Set فاضي في حالة عدم النشاط
const EMPTY_PENDING_IDS: ReadonlySet<string> = new Set()
// مصفوفات فاضية مُجمّعة كمَراجع مستقرة لـ useMemo — `filter` الفاضي كان
// بيلحق مرجع جديد في كل render حتى لو مفيش إذن/سؤال.
const EMPTY_PERMISSIONS: Permission[] = []
const EMPTY_QUESTIONS: ConversationQuestionRequest[] = []
// بديل فارغ لمفتاح إذن مش موجود في خريطة الردود (مستحيل يحدث: الخريطة بتتبني
// من نفس مصفوفة الأذونات المعروضة) — عشان نوع الـ prop يفضل دالة.
const NOOP_PERMISSION_REPLY = (): void => {}
// Set فيه الـ id النشط لوحده — مُجمّع عشان نرجّع نفس المرجع لما activeId
// ثابت بدل ما نعمل Set جديد كل مرة
const SINGLE_ACTIVE_ID_SET_CACHE = new Map<string, ReadonlySet<string>>()
// سقف للكاش: بدونه كان بيكبر مع كل id محادثة اتفتحت في عمر الصفحة (تسريب
// ذاكرة صغير طويل المدى). الإخلاء مش بيغيّر الناتج — مجرد إعادة حساب.
const SINGLE_ACTIVE_ID_SET_CACHE_LIMIT = 128
function singleActiveIdSet(activeId: string): ReadonlySet<string> {
  let cached = SINGLE_ACTIVE_ID_SET_CACHE.get(activeId)
  if (!cached) {
    if (SINGLE_ACTIVE_ID_SET_CACHE.size >= SINGLE_ACTIVE_ID_SET_CACHE_LIMIT) {
      const oldest = SINGLE_ACTIVE_ID_SET_CACHE.keys().next()
      if (!oldest.done) {
        SINGLE_ACTIVE_ID_SET_CACHE.delete(oldest.value)
      }
    }
    cached = new Set([activeId])
    SINGLE_ACTIVE_ID_SET_CACHE.set(activeId, cached)
  }
  return cached
}

// مقارنة محتوى خرائط الحالة: نفس المفاتيح ونفس النوع لكل مفتاح. الواجهة ما
// بتفرّقش في الحالة غير بنوعها (idle/busy/retry) — نفس ما بتقارن بيه مستمع
// الـ SSE. بنستخدمها عشان نرجّع نفس المرجع من setState فلا يقع رندر من غير
// تغيير حقيقي (poll الحالة كل ٤ ثواني كان بيولّد كائن جديد دايمًا).
function sameStatusMap(left: Record<string, SessionStatus>, right: Record<string, SessionStatus>): boolean {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) {
    return false
  }
  for (const key of keys) {
    if (left[key]?.type !== right[key]?.type) {
      return false
    }
  }
  return true
}

// نفس الفكرة لقائمة المحادثات: طالما المحتوى (المعرّف/العنوان/المجلد/الأوقات)
// ما اتغيّرش، سيب نفس المصفوفة — poll الجلسات كل ١٢ ثانية كان بيولّد مصفوفة
// جديدة ويعيد رسم الـ App رغم إن مفيش محادثة جديدة.
function sameSessionList(left: Session[], right: Session[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]
    const b = right[i]
    if (!a || !b) {
      return false
    }
    if (a.id !== b.id || a.title !== b.title || a.directory !== b.directory || a.time.created !== b.time.created || a.time.updated !== b.time.updated) {
      return false
    }
  }
  return true
}

function App() {
  const [authState, setAuthState] = useState<AuthState>("loading")
  const [accessToken, setAccessToken] = useState("")
  const [config, setConfig] = useState<AppConfig>(emptyConfig)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [switchingProject, setSwitchingProject] = useState<string | null>(null)
  const [recentProjects, setRecentProjects] = useState<string[]>(() => loadRecentProjects())
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  // طلبات المحادثة بالترتيب: الأقدم فوق والأحدث تحت — بتتعرض كلها في كارت واحد
  const [requests, setRequests] = useState<SessionRequest[]>([])
  const [requestQuestions, setRequestQuestions] = useState<ConversationQuestionRequest[]>([])
  const [rawStatuses, setRawStatuses] = useState<Record<string, SessionStatus>>({})
  // محادثات حكمها "واقفة" (كاشف الجمود في السيرفر اتقفل). مخزّنة بمعرّف
  // المحادثة لا كحالة واحدة عشان ما تتسرّبش لمحادثة تانية لو المستخدم
  // غيّر الجلسة قبل ما تحل. بتتظبط من رد /requests بس — مفيش مصدر تاني.
  const [stalledIds, setStalledIds] = useState<Set<string>>(() => new Set())
  // اللي بيتبعرض منه (أيقونة + "شغّال/جاهز" + تنبيه الإتمام) هو حالة مستقرة،
  // مش آخر عيّنة وصلتنا — عشان تضارب الـ SSE مع الـ poll ما يخطفش الشاشة.
  const [statuses, setSettledStatus] = useSettledStatuses(rawStatuses)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [composer, setComposer] = useState("")
  const composerRef = useRef<HTMLDivElement>(null)
  // مرفقات الرسالة الجاية (صور/ملفات). بتتبعت مع أول رسالة وبتتفضّى بعدها.
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  // تصفير الكومبوزر كاملًا (نص + مرفقات) عند تبديل المحادثة/المشروع عشان
  // ما تتسرّبش مرفقات محادثة لمحادثة تانية
  const resetComposer = useCallback(() => {
    setComposer("")
    setAttachments([])
  }, [])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  // حارس متزامن ضد الإرسال المزدوج: ضغطتان سريعتان قبل إعادة الرسم
  // كانتا تتجاوزان فحص `sending` وتنشئان جلستين على السيرفر، فتظهر
  // "محادثتان نشطتان" وهي واحدة. الـ ref يتحدث فورًا بلا انتظار الـ render.
  const sendingRef = useRef(false)
  // معرّف الطلب اللي شغّال عليه فعل في الطابور دلوقتي (تخطّي/حذف) عشان نمنع ضغط مزدوج
  const [queueAction, setQueueAction] = useState<string | null>(null)
  const [loginError, setLoginError] = useState("")
  const [showSessions, setShowSessions] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // منتقي مشروع المحادثة الجديدة: المحادثة ما تتربطش تلقائيًا بالمشروع
  // المفتوح (فتح مشروع لمتابعة شغل مش اختيار له)، فزرار ➕ بيفتح المنتقي
  // والمستخدم يختار المشروع بنفسه قبل ما تبدأ المسودة.
  const [pickingNewSession, setPickingNewSession] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pushState, setPushState] = useState<"unknown" | "enabled" | "unsupported" | "blocked">("unknown")
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState("")
  const [renamingTitle, setRenamingTitle] = useState(false)
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled())
  const [theme, setTheme] = useState<AppTheme>(() => getSavedTheme())
  const [lang, setLang] = useState<Language>(() => getSavedLanguage())
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>(() => getSavedVoiceLanguage())
  const t = getStrings(lang)
  const langRef = useRef<Language>(lang)
  langRef.current = lang
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [currentModel, setCurrentModel] = useState<SessionModelRef | null>(null)
  const [defaultModel, setDefaultModel] = useState<SessionModelRef | null>(null)
  // الموديل + مستوى التفكير اللي المستخدم اختارهم للمشروع الحالي (محفوظ محليًا).
  // ده اللي بيبدأ بيه أي محادثة جديدة — أولوية فوق الـ default العام بتاع opencode.
  const [projectDefaultModel, setProjectDefaultModel] = useState<SessionModelRef | null>(null)
  const [pendingModel, setPendingModel] = useState<SessionModelRef | null>(null)
  const [showModels, setShowModels] = useState(false)
  const [switchingKey, setSwitchingKey] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [showPinned, setShowPinned] = useState(false)
  const [showReleases, setShowReleases] = useState(false)
  const [historyTurns, setHistoryTurns] = useState<HistoryTurn[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [activity, setActivity] = useState<ActiveSession[]>([])
  const [jumpingId, setJumpingId] = useState<string | null>(null)
  // حالة git: الأيقونة بتجيب العدد من غير ما تفتح القائمة، والقائمة بتجيبها لما تفتحها
  const [gitChanges, setGitChanges] = useState<GitChanges | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const toastId = useRef(0)
  const prevStatusesRef = useRef<Record<string, SessionStatus>>({})
  // الجلسات اللي المستخدم وقفها بنفسه — منطلعش لها toast إتمام لما تبقى idle
  const abortedRef = useRef<Set<string>>(new Set())
  // آخر مفتاح طلب اتنبّه عليه لكل جلسة — عشان نفس المهمة ما تتكررش
  const notifiedRef = useRef<Map<string, string>>(new Map())
  // الجلسات اللي اتنبّه عليها بحالة "شغّال → خلص" وهي في الخلفية. لما تفتح
  // الجلسة دي بعدها، نفس الإتمام ده ملاقيش تنبيه تاني (مفتاحين مختلفين لنفس المهمة).
  const notifiedViaStatusRef = useRef<Set<string>>(new Set())
  // الجلسات اللي شفناها شغالة فعلًا في عمر الصفحة دي (busy/retry أو running/queued).
  // فتح محادثة قديمة خلصانة من السيرفر من غير ما نشوفها شغالة لا يستحق صوت إتمام.
  const witnessedBusyRef = useRef<Set<string>>(new Set())
  // عدّاد "شغلانة" لكل جلسة: كل مرة تبدأ تشغلانة جديدة الرقم بيزيد، وبيدي
  const busyPeriodsRef = useRef<Map<string, number>>(new Map())
  // عدّاد تسلسلي بيرفض ردود قديمة لو رجعت بترتيب غلط
  const requestsSeq = useRef(0)
  const localRequestId = useRef(0)
  const sessionsRef = useRef<Session[]>([])
  sessionsRef.current = sessions
  const activeSessionItemRef = useRef<HTMLDivElement | null>(null)
  const workspaceScrollRef = useRef<HTMLDivElement | null>(null)
  // قائمة المهام جوه كارت المحادثة — هي اللي بتسكرول فعليًا (الكارت بحجم
  // النافذة والقائمة جوه flex:1). حاوية الشغل بتنزل معاها كمان عشان بطاقات
  // الأسئلة اللي بتظهر تحت الكارت.
  const requestListRef = useRef<HTMLUListElement | null>(null)
  // مصفوفة ثابتة المرجع: الـ hook بيخزّن آخر مرجع في effect، ولو الـ parent
  // عمل مصفوفة جديدة كل رندر كان الـ effect اشتغل بلا داعي في كل رسم.
  const scrollTargets = useMemo(() => [requestListRef, workspaceScrollRef], [])
  const { pinToBottom, followBottom, release: releaseScrollPin } = useScrollToBottom(scrollTargets)
  // هوية المحتوى المعروض: الـ fetch بيتأخر بعد تبديل المحادثة، فالطلبات اللي
  // على الشاشة ممكن تكون لسه بتاعة المحادثة اللي فاتت. من غير المقارنة دي
  // التثبيت هيستقر على محتوى غلط وميترجعش ينزل للمحادثة الجديدة.
  const contentIdRef = useRef<string | null>(null)
  // آخر محتوى نزلنا لآخره — بعد ما يستقر النزول (أو المستخدم يمسك السكول)
  // بنسيبه، عشان ما نطاردش اللي بيرجع يقرا طلب قديم
  const pinnedContentRef = useRef<string | null>(null)
  // خنق تحديثات النص الحي: أحداث message.part.updated بتيجي عشرات المرات
  // في الثانية أثناء الكتابة — نحدّث فور أول حدث وبعدها بمهلة قصيرة فقط.
  const messageRefreshAt = useRef(0)
  const messageRefreshTimer = useRef<number | null>(null)
  const showHistoryRef = useRef(false)
  showHistoryRef.current = showHistory
  // تنسيق الـ polling مع الـ SSE: طول ما الستريم حي والأحداث واصلة، الـ polls
  // الدورية fallback فقط — لا طلبات مكررة لنفس البيانات اللي الـ SSE جابها.
  const sseLiveRef = useRef(false)
  const lastSseAtRef = useRef(0)
  // آخر جلب ناجح لكل مورد — يمنع refetch متكرر من كذا مصدر لحظيًا
  // (mount + event + visibility + reconnect) لنفس البيانات الطازجة
  const lastFetchRef = useRef<Record<string, number>>({})
  const FRESH_MS = 8000
  const isFresh = useCallback((key: string, ttlMs: number = FRESH_MS): boolean => {
    return Date.now() - (lastFetchRef.current[key] ?? 0) < ttlMs
  }, [])
  const markFetched = useCallback((key: string): void => {
    lastFetchRef.current[key] = Date.now()
  }, [])
  // تحديث النشاط مؤجّل ومدمج: أحداث الرسائل عالية التكرار (عشرات/ثانية)
  // للجلسات الخلفية كانت بتضرب /api/activity مع كل حدث — الآن حد أقصى واحد
  const activityTimerRef = useRef<number | null>(null)

  const activeSession = useMemo(() => sessionMatches(sessions, activeId), [sessions, activeId])
  const activeTitle = displayTitle(activeSession?.title, t)
  const activeStatus = activeId ? statuses[activeId] : undefined
  const isBusy = activeStatus?.type === "busy" || activeStatus?.type === "retry"
  // ids الشغالة في كل المشاريع (من /api/activity) — عشان جلسة اللاب تبان
  // نشطة فورًا حتى لو statuses الم scoped للمشروع المفتوح لسه ملحقتهاش
  const activityIds = useMemo(() => new Set(activity.map((item) => item.id)), [activity])
  // هل المحادثة المفتوحة فيها طلب لسه ما خلصش؟ بنحسبها boolean مرة واحدة لكل
  // تغيّر في الطلبات، ونشيل مصفوفة `requests` من اعتماديات `isSessionWorking`.
  // من غير كده كانت قوايم السايدبار (active/inactive) بتتبني من جديد مع كل
  // عيّنة نص حيّ (كل ١.٥ ثانية) رغم إن حكم "شغالة" ما اتغيّرش. الفحص نفسه
  // بالظبط اللي كان جوه الدالة.
  const activeHasPendingWork = useMemo(
    () => activeId ? requests.some((r) => r.state !== "done" && r.state !== "stopped") : false,
    [activeId, requests],
  )
  const isSessionWorking = useCallback((id: string) => {
    const status = statuses[id]
    const hasRunningOrQueued = id === activeId ? activeHasPendingWork : false
    return (status?.type === "busy" || status?.type === "retry") || activityIds.has(id) || hasRunningOrQueued
  }, [statuses, activeId, activityIds, activeHasPendingWork])

  // في طلبات مستنية في الطابور؟ لو أيوه لازم نفضل نحدّث لحد ما تخلص كلها.
  const hasQueuedRequests = useMemo(() => requests.some((request) => request.state === "queued"), [requests])
  // آخر صف، وبيعتمد عليه قرار "محتاجين نفضل نحدّث؟" تحت.
  const latestRequest = useMemo(() => requests[requests.length - 1], [requests])
  // آخر طلب هو الشغّال فعلًا، من غير طابور وراه.
  const hasRunningRequests = latestRequest?.state === "running" && !hasQueuedRequests

  // القائمة الجانبية: "النشطة" = الشغالة دلوقتي بس. مهلة الـ ٥ دقايق
  // ("نشط أخيرًا") موجودة في لوحة "المحادثات النشطة" بس.
  // المحادثات المثبّتة بتفضل في مجموعتها العادية بالترتيب العادي: التثبيت
  // ما بيحرّكش الصف ولا بيغيّر ترتيب القائمة — بيبان بس كعلامة في الصف.
  // قائمة المثبّتات نفسها (لوحة الدبوس في الهيدر) بتعرض مثبّتات المشروع
  // المفتوح بس، وهي متخزّنة على السيرفر فتبقى على كل الأجهزة وعلى كل الجلسات.
  const { projectPins, isPinned, togglePin, forgetPinned } = usePinnedConversations(
    selectedProject?.worktree ?? null,
    selectedProject ? projectName(selectedProject) : "",
  )
  // نفس القاعدة بتتكرر في العدّاد على أيقونة النشاط وفي القائمة الجانبية، فبنحسب
  // الـ ids مرة واحدة ونتشاركها. متستعملش isSessionWorking هنا — هيتلخبط في الحفظ
  // لو call-backs بتتغير كل render.
  const workingSessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const session of sessions) {
      if (isSessionWorking(session.id)) {
        ids.add(session.id)
      }
    }
    return ids
  }, [sessions, isSessionWorking])
  const sidebarActiveSessions = useMemo(() => sessions.filter((session) => workingSessionIds.has(session.id)), [sessions, workingSessionIds])
  const sidebarInactiveSessions = useMemo(() => sessions.filter((session) => !workingSessionIds.has(session.id)), [sessions, workingSessionIds])
  // العدّاد على ⚡ واللوحة بياخدوا الرقم من القائمة دي مش من /api/activity
  // لوحدها: الشريط الجانبي بيحكم بـ statuses والطلبات المعلّقة، فلو اعتمدنا
  // على السيرفر بس العدّاد كان هيضيع محادثات شغالة لحد ما الجولة الجاية تجيبها.
  // دليلان مستقلين بس — حالة السيرفر (busy/retry) وطلب العميل المعلّق. مهم ما
  // نديش القائمة نفسها (workingSessionIds) هنا: وجودها في استجابة النشاط
  // السابقة بيخلّيها تنضم لنفسها كـ busy حتى بعد ما السيرفر يشيلها، واللوحة
  // بتفضل بتعدّ محادثات خالصة للأبد.
  const busyStatusIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [id, status] of Object.entries(statuses)) {
      if (status.type === "busy" || status.type === "retry") {
        ids.add(id)
      }
    }
    return ids
  }, [statuses])
  // Set ده بيتعمل من `requests` و`activeId` فقط. كان بيتمدّد عبر كل تحديث
  // للـ requests أثناء الكتابة الحية (كل 1.5 ثانية) حتى لو activeId ما اتغيّرش،
  // فبنحسبه مرة واحدة بس هنا ونمرره للـ `mergeActiveSessions`.
  const pendingRequestIds = useMemo(() => {
    if (!activeId) {
      return EMPTY_PENDING_IDS
    }
    const hasPending = requests.some((r) => r.state !== "done" && r.state !== "stopped")
    return hasPending ? singleActiveIdSet(activeId) : EMPTY_PENDING_IDS
  }, [activeId, requests])
  // ممرّرات PermissionCard/ StickyQuestions: نفس الفلتر كان بيتنفّذ مرتين
  // في JSX (مرة لطول الفحص، مرة للـ map). نحسبه مرة واحدة في useMemo عشان
  // مرجع المصفوفة يثبت عبر الـ renders اللي ما بتغيرش `activeId`/`permissions`/
  // `requestQuestions`.
  const activePermissions = useMemo(
    () => activeId ? permissions.filter((permission) => permission.sessionID === activeId) : EMPTY_PERMISSIONS,
    [permissions, activeId],
  )
  const activeQuestions = useMemo(
    () => activeId ? requestQuestions.filter((question) => question.sessionID === activeId) : EMPTY_QUESTIONS,
    [requestQuestions, activeId],
  )
  // Set فيه ids الجلسات اللي عندها إذن معلق — بنستخدمه في القائمة الجانبية
  // بدل `permissions.some(...)` اللي كان بيمشي O(N·M) في كل صف.
  const permissionSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const permission of permissions) {
      set.add(permission.sessionID)
    }
    return set
  }, [permissions])
  const activeSessions = useMemo(() => mergeActiveSessions(
    activity,
    sessions,
    busyStatusIds,
    pendingRequestIds,
    statuses,
    selectedProject ? { worktree: selectedProject.worktree, name: projectName(selectedProject) } : null,
  ), [activity, sessions, busyStatusIds, pendingRequestIds, statuses, selectedProject])

  // في لوحة "المحادثات النشطة": اللي شغالة دلوقتي، واللي كانت نشطة في آخر ٥ دقايق.
  // لازم يتدّال القائمة المدمجة مش activity: القائمة المدمجة هي اللي بتتعرض تحت
  // "نشط دلوقتي"، فلو الـ live اتحسب من غيرها جلسة هتبان في القسمين مع بعض.
  const { track: trackActivity, recent: activityRecent, graceLeft: activityGraceLeft } = useActivityGrace(activeSessions, ACTIVE_GRACE_MS, showActivity)

  // سياسة الـ toast: أضيق الحدود — أخطاء + تنبيه خلفية محتاج تدخّل بس.
  // أي نجاح شايفه بعينك (اتنقل، اتمسح، اتنسخ، اتبدّل الموديل) مبيطلعلوش toast.
  const addToast = useCallback((message: string, kind: ToastKind = "info") => {
    // حارس نوع: أي مفتاح ترجمة ناقص أو خطأ متسلسل بيمرّر undefined كان
    // بيخلّي .trim() ترمي TypeError، والـ catch برّه بيحوّل الخطأ ده نفسه
    // لـ toast مضلّل ("Cannot read properties of undefined"). الرسالة غير
    // النصية تتجاهل بأمان بدل ما تكسر مسار الإجراء.
    const text = typeof message === "string" ? message.trim() : ""
    if (!text) {
      return
    }
    const id = ++toastId.current
    setToasts((current) => {
      // نفس الرسالة ظاهرة already — متكررهاش
      if (current.some((toast) => toast.message === text)) {
        return current
      }
      // بالكتير 2 توست مع بعض عشان الشاشة متتغطاش
      return [...current.slice(-1), { id, message: text, kind }]
    })
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000)
  }, [])

  // إتمام المهمة: صوت واهتزاز بس — منظّمش توست عشان المستخدم مش عايزه يطلع
  const notifyCompletion = useCallback(() => {
    playCompletionSound()
    vibrate([180, 100, 180, 100, 320])
  }, [])

  const notifyAttention = useCallback((message?: string) => {
    playAttentionSound()
    vibrate([120, 80, 120])
    // من غير رسالة = صوت واهتزاز بس. بيستخدمها السؤال: كارت السؤال نفسه هو
    // الإشارة، والتوست المكرر كان بيقول "OpenCode طرح سؤال" من غير ما يبان
    // الكارت فبيوهم المستخدم إن حاجة وصلت وهو مش شايفها.
    if (message) {
      addToast(message, "info")
    }
  }, [addToast])

  // التنبيه لازم يطلع مرة واحدة بس لكل مهمة: نفس المفتاح = نفس المهمة، فمهما
  // تكرّرنا في الحالة أو وصلنا الحدث مرتين، الصوت والـ toast هيبانوا مرة واحدة.
  // سقف الحجم يمنع نمو غير محدود لجلسات قديمة محذوفة (LRU بسيط: الأقدم أولًا).
  const notifyOnce = useCallback((sessionId: string, taskKey: string) => {
    if (notifiedRef.current.get(sessionId) === taskKey) {
      return
    }
    if (notifiedRef.current.size >= 200) {
      const oldest = notifiedRef.current.keys().next()
      if (!oldest.done) {
        notifiedRef.current.delete(oldest.value)
      }
    }
    notifiedRef.current.set(sessionId, taskKey)
    notifyCompletion()
  }, [notifyCompletion])

  // فتح الصوت مع أول لمسة (شرط المتصفحات على الموبايل)
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener("pointerdown", unlock, { passive: true })
    window.addEventListener("keydown", unlock)
    window.addEventListener("touchstart", unlock, { passive: true })
    return () => {
      window.removeEventListener("pointerdown", unlock)
      window.removeEventListener("keydown", unlock)
      window.removeEventListener("touchstart", unlock)
    }
  }, [])

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    applyLanguage(lang)
    saveLanguage(lang)
  }, [lang])

  useEffect(() => {
    saveVoiceLanguage(voiceLanguage)
  }, [voiceLanguage])

  const toggleLanguage = useCallback(() => {
    setLang((current) => (current === "ar" ? "en" : "ar"))
  }, [])

  // مرجع مستقر لـ TopBar: بدون useCallback الدالة بتتجدّد كل رندر فيفشل الـ memo
  const toggleTheme = useCallback(() => {
    setTheme((current) => nextTheme(current))
  }, [])

  // الجلسة المفتوحة: بننبّه مرة واحدة لما المهمة كلها تخلص فعلًا — مش مع كل
  // خطوة وسيطة. الخطوة الوسيطة بتقفل رسالة assistant واحدة (completedAt يتسجل)
  // لكن الكارت لسه running والجلسة لسه busy، فالشرط القديم (completedAt > 0 بس)
  // كان بيطلّع صوت الإتمام مع كل أداة/خطوة. لازم ٣ شروط مع بعض:
  // آخر طلب done/stopped + مفيش أي طلب running/queued + الحالة المستقرة idle.
  // + شرط رابع: لازم نكون شفنا الجلسة شغالة في عمر الصفحة دي — فتح محادثة
  // قديمة خلصانة (من السايدبار أو بعد refresh) لا يطلّع صوت إتمام.
  useEffect(() => {
    if (!activeId) {
      return
    }
    const activeStatus = statuses[activeId]
    if (activeStatus?.type === "busy" || activeStatus?.type === "retry") {
      witnessedBusyRef.current.add(activeId)
      return
    }
    if (requests.some((request) => request.state === "running" || request.state === "queued")) {
      witnessedBusyRef.current.add(activeId)
      return
    }
  }, [activeId, requests, statuses])

  useEffect(() => {
    const last = requests[requests.length - 1]
    if (!activeId || !last || !last.completedAt) {
      return
    }
    if (last.state !== "done" && last.state !== "stopped") {
      return
    }
    if (requests.some((request) => request.state === "running" || request.state === "queued")) {
      return
    }
    const settledKind = statuses[activeId]?.type ?? "idle"
    if (settledKind === "busy" || settledKind === "retry") {
      return
    }
    if (abortedRef.current.delete(activeId)) {
      witnessedBusyRef.current.delete(activeId)
      return
    }
    // الإتمام ده اتنبّه عليه قبل كده وانت في شاشة تانية — متكرّرش
    if (notifiedViaStatusRef.current.delete(activeId)) {
      witnessedBusyRef.current.delete(activeId)
      return
    }
    // محادثة قديمة اتفتحت وهي خلصانة أصلًا — سجّلها بصمت من غير صوت،
    // عشان اختيار أي محادثة done من القائمة لا يشغّل صوت إتمام مهمة.
    if (!witnessedBusyRef.current.has(activeId)) {
      notifiedRef.current.set(activeId, `req:${last.id}:${last.completedAt}`)
      return
    }
    witnessedBusyRef.current.delete(activeId)
    notifyOnce(activeId, `req:${last.id}:${last.completedAt}`)
  }, [activeId, requests, statuses, notifyOnce])

  // باقي الجلسات (اللي مش مفتوحة): انتقال شغّال → خلص، مرة واحدة لكل شغلانة
  useEffect(() => {
    const prev = prevStatusesRef.current
    if (Object.keys(prev).length > 0) {
      for (const [id, status] of Object.entries(statuses)) {
        if (id === activeId) {
          continue
        }
        const busy = status.type === "busy" || status.type === "retry"
        const wasBusy = prev[id]?.type === "busy" || prev[id]?.type === "retry"
        if (busy) {
          // الرقم بيزيد مرة واحدة بس لما الجلسة تتحوّل idle → شغّال.
          // قبل كده كان بيزيد مع كل poll (كل ٤ ثواني) فالرقم كان بيتغيّر
          // والمفتاح `busy:N` كان بيتحدّد جديد فالتنبيه بيتكرّر لنفس المهمة.
          if (!wasBusy) {
            if (busyPeriodsRef.current.size >= 200) {
              const oldest = busyPeriodsRef.current.keys().next()
              if (!oldest.done) {
                busyPeriodsRef.current.delete(oldest.value)
              }
            }
            busyPeriodsRef.current.set(id, (busyPeriodsRef.current.get(id) ?? 0) + 1)
          }
          continue
        }
        if (!wasBusy) {
          continue
        }
        if (abortedRef.current.delete(id)) {
          continue
        }
        notifyOnce(id, `busy:${busyPeriodsRef.current.get(id) ?? 0}`)
        // علّم الجلسة إن اتنبّه على إتمامها، عشان لو فتحتها دلوقتي
        // الـ effect بتاع الجلسة المفتوحة ما يكرّرش نفس التنبيه
        notifiedViaStatusRef.current.add(id)
      }
    }
    prevStatusesRef.current = statuses
  }, [activeId, statuses, notifyOnce])

  const refreshRequests = useCallback(async (id = activeIdRef.current) => {
    if (!id) {
      requestsSeq.current += 1
      setRequests([])
      setRequestQuestions([])
      contentIdRef.current = null
      return
    }
    const ticket = ++requestsSeq.current
    let next: SessionRequests
    let nextPermissions: Permission[]
    try {
      const fetched = await Promise.all([getRequests(id, langRef.current), listPermissions()])
      next = fetched[0]
      nextPermissions = fetched[1]
    } catch {
      return
    }
    // رد قديم وصل بعد رد أحدث — اتجاهله عشان الكارتات ماتقفش بترتيب غلط
    if (activeIdRef.current !== id || ticket !== requestsSeq.current) {
      return
    }
    // الطلبات اللي على الشاشة بقت دي المحادثة دي — التثبيت بيفصل بمعرّفها
    contentIdRef.current = id
    setRequests(next.requests)
    setRequestQuestions(next.questions)
    // حكم الجمود جزء من نفس الرد — من غير سطر ده كان الكارت بيفضّل يعرض
    // آخر حالة عرفها بدل الحكم الجديد.
    setStalledIds((current) => {
      if (next.stalled === current.has(id)) {
        return current
      }
      const updated = new Set(current)
      if (next.stalled) {
        updated.add(id)
      } else {
        updated.delete(id)
      }
      return updated
    })
    // نفس قواعد session.status/event: لو الحالة الفعلية ماتغيرتش متعملش ref
    // جديد للـ rawStatuses عشان الـ useSettledStatuses والـ effect بتاع باقي الجلسات
    // ما يشتغلوش على كل poll عادي.
    setRawStatuses((current) => {
      if (current[id]?.type === next.status?.type) {
        return current
      }
      return { ...current, [id]: next.status }
    })
    setPermissions(nextPermissions)
  }, [])

  const refreshStatuses = useCallback(async () => {
    try {
      const nextStatuses = await getStatuses()
      setRawStatuses((current) => (sameStatusMap(current, nextStatuses) ? current : nextStatuses))
      markFetched("status")
    } catch {
      // Keep last known statuses when the poll fails (offline / reconnecting).
    }
  }, [markFetched])

  // المحادثات الشغالة في كل المشاريع — بتتحدث مع نفس poll الحالات
  const refreshActivity = useCallback(async () => {
    try {
      const items = await getActivity(langRef.current)
      // نفس المحادثة مستحيل تتكرر في قائمة النشاط: ردّ متأخر قد يرجّع
      // نفس الـ id مرتين فتبان "محادثتان نشطتان" وهي واحدة.
      const seen = new Set<string>()
      const unique = items.filter((item) => {
        if (seen.has(item.id)) {
          return false
        }
        seen.add(item.id)
        return true
      })
      setActivity(unique)
      trackActivity(unique, Date.now())
      markFetched("activity")
    } catch {
      // Keep last known activity when the poll fails (offline / reconnecting).
    }
  }, [trackActivity, markFetched])

  // نسخة مدمجة من تحديث النشاط للأحداث عالية التكرار: مهما اتنادت،
  // التنفيذ الفعلي مرة واحدة بعد 700ms من آخر نداء — تمنع عاصفة /api/activity
  const requestActivityRefresh = useCallback(() => {
    if (activityTimerRef.current !== null) {
      return
    }
    activityTimerRef.current = window.setTimeout(() => {
      activityTimerRef.current = null
      void refreshActivity()
    }, 700)
  }, [refreshActivity])

  // حالة git للمشروع المختار — بنجيبها صامتة عشان الأيقونة في الهيدر محدّثة
  const refreshGitChanges = useCallback(async () => {
    setGitLoading(true)
    try {
      setGitChanges(await getGitChanges())
      markFetched("git")
    } catch {
      // نسيب آخر حالة معروفة — الخادم لسه بيوصل أو المشروع مش git
    } finally {
      setGitLoading(false)
    }
  }, [markFetched])

  // Only count files with actual git status (added, modified, deleted)
  // Filter out any potential stale/empty entries from backend
  const gitChangedCount = useMemo(() => {
    if (!gitChanges?.available) return 0
    return gitChanges.files.filter((f) => f.status === "added" || f.status === "modified" || f.status === "deleted").length
  }, [gitChanges])

  const refreshSessions = useCallback(async () => {
    const [nextSessions, nextStatuses] = await Promise.all([
      listSessions(),
      getStatuses().catch(() => null),
    ])
    markFetched("sessions")
    const sorted = sortSessionsByCreated(nextSessions)
    setSessions((current) => (sameSessionList(current, sorted) ? current : sorted))
    if (nextStatuses) {
      setRawStatuses((current) => (sameStatusMap(current, nextStatuses) ? current : nextStatuses))
    }
    setActiveId((current) => {
      // لو في مسودة جديدة (null) نحافظ عليها ومنرجعش لأول جلسة تلقائيًا
      if (current === null) {
        activeIdRef.current = null
        return null
      }
      const next = sorted.some((session) => session.id === current) ? current : sorted[0]?.id || null
      activeIdRef.current = next
      return next
    })
  }, [markFetched])

  const openProject = useCallback(async (project: Project, targetSessionId?: string) => {
    // لو دايس على الحالي خلاص — مفيش داعي للتحميل
    if (selectedProject && samePath(project.worktree, selectedProject.worktree) && !targetSessionId) {
      return
    }
    setSwitchingProject(project.worktree)
    try {
      const result = await selectProject(project)
      setSelectedProject(result.project)
      setProjects((current) => {
        if (current.some((candidate) => samePath(candidate.worktree, result.project.worktree))) {
          return current
        }
        return [...current, result.project]
      })
      setRecentProjects((current) => {
        const next = [result.project.worktree, ...current.filter((path) => !samePath(path, result.project.worktree))].slice(0, 8)
        try {
          localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next))
        } catch {
          // تجاهل — التخزين اختياري
        }
        return next
      })
      const [nextSessions, nextStatuses] = await Promise.all([listSessions(), getStatuses()])
      const sorted = sortSessionsByCreated(nextSessions)
      // أولوية للمحادثة المطلوبة من "شغال الآن"، بعدين آخر محادثة فتحناها في المشروع ده،
      // وأخيرًا الأحدث — عشان الـ refresh يرجّعك لنفس المكان اللي كنت فيه
      const remembered = loadLastSessions()[normalizeProjectPath(result.project.worktree)]
      const fallback = remembered && sorted.some((session) => session.id === remembered)
        ? remembered
        : sorted[0]?.id || null
      const nextActive = targetSessionId && sorted.some((session) => session.id === targetSessionId)
        ? targetSessionId
        : fallback
      setSessions(sorted)
      setRawStatuses(nextStatuses)
      setActiveId(nextActive)
      activeIdRef.current = nextActive
      resetComposer()
      setShowSessions(false)
      setGitChanges(null)
      // الافتراضي المحفوظ بيتقري للمشروع الجديد من effect بتاع selectedProject،
      // فلازم نمسح الاختيار المؤقت القديم عشان ما يتسرّبش لمشروع تاني
      setPendingModel(null)
      // Reset the previous task's Execution Plan right away on project/task
      // switch; refreshRequests below loads the new task's plan.
      setRequests([])
      setRequestQuestions([])
      void refreshGitChanges()
      await refreshRequests(nextActive)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.openProjectFailed, "error")
    } finally {
      setSwitchingProject(null)
    }
  }, [addToast, refreshRequests, refreshGitChanges, selectedProject, t, resetComposer])

  // بياخد config جاهز اختياريًا عشان مسار الإقلاع ما يعيدش نداء /api/config
  // (الفحص الأول بيتأكد إن الجلسة صالحة، فبنتشارك نفس الرد مع الدخول بدل ما
  // نطلبه مرتين). مسار تسجيل الدخول بيسيبها فاضية فيجيبها طازجة زي ما كان.
  const enterApp = useCallback(async (prefetchedConfig?: AppConfig) => {
    const [nextConfig, projectResponse] = await Promise.all([
      prefetchedConfig ? Promise.resolve(prefetchedConfig) : getConfig(),
      getProjects(),
    ])
    setConfig(nextConfig)
    setProjects(projectResponse.projects)
    setAuthState("signedIn")
    if (projectResponse.selected) {
      await openProject(projectResponse.selected)
    }
  }, [openProject])

  useEffect(() => {
    let mounted = true
    void getConfig()
      .then((config) => enterApp(config))
      .catch((error: unknown) => {
        if (!mounted) {
          return
        }
        if (error instanceof ApiError && error.status === 401) {
          setAuthState("signedOut")
        } else {
          setLoginError(error instanceof Error ? error.message : t.serverUnreachable)
          setAuthState("signedOut")
        }
      })
    return () => {
      mounted = false
    }
  }, [enterApp, t])

  useEffect(() => {
    activeIdRef.current = activeId
    // Switching tasks resets the visible Execution Plan immediately so the
    // previous task's plan never lingers while the new task loads.
    setRequests([])
    setRequestQuestions([])
    if (authState === "signedIn" && activeId) {
      void refreshRequests(activeId).catch((error: unknown) => addToast(error instanceof Error ? error.message : t.summaryLoadFailed, "error"))
    }
  }, [activeId, authState, addToast, refreshRequests, t])

  // احفظ آخر محادثة فتحناها لكل مشروع — بعد الـ refresh نرجعلها بدل ما نرجع لأول واحدة
  useEffect(() => {
    if (authState !== "signedIn" || !selectedProject) {
      return
    }
    if (activeId) {
      saveLastSession(selectedProject.worktree, activeId)
    } else {
      // مسودة جديدة: امسح المحادثة المحفوظة عشان الـ refresh ما يرجعش ليها
      forgetLastSession(selectedProject.worktree)
    }
  }, [activeId, authState, selectedProject])

  // القائمة بترتّب بتاريخ الإنشاء، فالمحادثة الحالية ممكن تكون تحت — نبصّ عليها في الشاشة
  useEffect(() => {
    if (authState !== "signedIn" || !activeId || !showSessions) {
      return
    }
    activeSessionItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [activeId, authState, showSessions, sessions])

  // القائمة حية من opencode نفسه — بتتغير حسب المتاح فعلًا (نعيد تحميلها مع كل مشروع/فتح للقائمة)
  const loadModels = useCallback(async (silent = false) => {
    // تحميل النماذج في كل focus كان يضرب /api/models حتى لو حصل، refreshSessions
    // كمان جابها من غير فائدة. القائمة نادرًا بتتغير في عمر الجلسة الواحدة.
    if (silent && isFresh("models")) {
      return
    }
    if (!silent) {
      setModelsLoading(true)
    }
    try {
      const list = await getModels()
      setModels(list)
      markFetched("models")
    } catch (error: unknown) {
      if (!silent) {
        addToast(error instanceof Error ? error.message : t.modelsLoadFailed, "error")
      }
    } finally {
      if (!silent) {
        setModelsLoading(false)
      }
    }
  }, [addToast, t, isFresh, markFetched])

  // تحميل قائمة الموديلات الكاملة بعد الدخول واختيار المشروع
  useEffect(() => {
    if (authState !== "signedIn" || !selectedProject) {
      return
    }
    void loadModels()
  }, [authState, selectedProject, loadModels])

  // كل ما تفتح قائمة الموديلات حدّثها من opencode عشان تعكس المتاح لحظيًا
  useEffect(() => {
    if (showModels && authState === "signedIn" && selectedProject) {
      void loadModels()
    }
  }, [showModels, authState, selectedProject, loadModels])

  // الموديل الافتراضي المحفوظ للمشروع الحالي: يتقري من الكاش مع كل تبديل مشروع
  // (المشاريع المتعددة ليها كل واحدة اختيارها) ويتصفّر من غير مشروع مختار
  useEffect(() => {
    setProjectDefaultModel(selectedProject ? loadDefaultModel(selectedProject.worktree) : null)
  }, [selectedProject])

  const loadHistory = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) {
      setHistoryTurns([])
      setHistoryError("")
      return
    }
    setHistoryLoading(true)
    setHistoryError("")
    try {
      const turns = await getHistory(id, langRef.current)
      if (activeIdRef.current !== id) {
        return
      }
      setHistoryTurns(turns)
    } catch (error: unknown) {
      if (activeIdRef.current !== id) {
        return
      }
      setHistoryError(error instanceof Error ? error.message : t.historyLoadFailed)
    } finally {
      if (activeIdRef.current === id) {
        setHistoryLoading(false)
      }
    }
  }, [t])

  // تحميل سجل المحادثة المنظم كل ما تفتح الدرج أو تتبدل الجلسة
  useEffect(() => {
    if (showHistory && authState === "signedIn" && activeId) {
      void loadHistory()
    }
  }, [showHistory, activeId, authState, loadHistory])

  // عند تبديل اللغة: إعادة تحميل النصوص القادمة من الخادم باللغة الجديدة
  useEffect(() => {
    if (authState !== "signedIn") {
      return
    }
    const id = activeIdRef.current
    if (id) {
      void refreshRequests(id).catch(() => undefined)
    }
    void refreshActivity()
    if (showHistoryRef.current && id) {
      void loadHistory()
    }
  }, [lang, authState, refreshRequests, refreshActivity, loadHistory])

  // تحميل الموديل الحالي للجلسة النشطة
  useEffect(() => {
    if (authState !== "signedIn" || !activeId) {
      return
    }
    void getSessionModel(activeId)
      .then((state) => {
        if (activeIdRef.current !== activeId) {
          return
        }
        setCurrentModel(state.model || state.defaultModel)
        setDefaultModel(state.defaultModel)
      })
      .catch(() => undefined)
  }, [activeId, authState])

  useEffect(() => {
    document.title = authState === "signedIn" && selectedProject ? activeTitle : t.appName
  }, [activeTitle, authState, selectedProject, t])

  // تبديل المحادثة يصفّر علامة التثبيت: الشرط تحت بيفترض إن المحادثة
  // المثبّتة هي الحالية من غير ما يتأكد، فالرجوع لمحادثة نزلنا لآخرها
  // قبل كده كان بيمنع النزول نهائيًا. التصفير لازم يتسجّل قبل تأثير
  // التثبيت — التأثيرات بتتنفّذ بنفس ترتيب تعريفها.
  useEffect(() => {
    pinnedContentRef.current = null
  }, [activeId])

  // فتح أي محادثة ينزل لآخر كارت المهام — أي تبديل لـ activeId أيًّا كان
  // طريقه (اختيار من القائمة، تبديل مشروع، قفزة من النشاط، مثبّتة، أو رجوع
  // تلقائي بعد الـ refresh). المحتوى بيوصل بعد الفتح على دفعات، فالتثبيت
  // بيكمّل لحد ما الطول يستقر؛ وبعد ما يستقر (أو المستخدم يمسك السكول)
  // بنوقف عشان ما نرجعش نزنّده وهو بيقرا طلب قديم.
  useEffect(() => {
    if (authState !== "signedIn" || !activeId || requests.length === 0) {
      return
    }
    // الطلبات لسه بتاعة المحادثة اللي قبلها — نستنى لحد ما تجيب محادثتنا
    if (contentIdRef.current !== activeId || pinnedContentRef.current === activeId) {
      return
    }
    pinToBottom(() => {
      pinnedContentRef.current = activeId
    })
    // الاعتماد على مصفوفة الطلبات نفسها مش طولها: محادثتين بنفس العدد كانت
    // requests.length ثابتة فالتأثير ما بيرجعش يشتغل بعد وصول المحتوى،
    // وحارس contentIdRef كان رفضه أول مرة — فالنزول ما كانش بيحصل خالص.
  }, [activeId, requests, authState, pinToBottom])

  // كل ما يتضاف طلب جديد: انزل تحت على آخر كارت عشان المستخدم يشوفه
  // فورًا — لكن فقط لو قريب من الأسفل أصلًا (ما نزعجش لو قارئ رسائل
  // قديمة). الأسئلة مستثناة عمدًا: كارت السؤال لاصق (sticky) فوق المحادثة
  // فالمحادثة بتفضل في مكانها وهو اللي بيظهر فوقها.
  useEffect(() => {
    if (requests.length === 0) {
      return
    }
    followBottom()
  }, [requests.length, followBottom])

  // حدّث الكارتات طول ما فيه طلب شغّال أو طلبات مستنية في الطابور
  useEffect(() => {
    if (authState !== "signedIn" || !activeId || (!isBusy && !hasQueuedRequests && !hasRunningRequests)) {
      return
    }
    const timer = window.setInterval(() => {
      void refreshRequests(activeId)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [authState, activeId, isBusy, hasQueuedRequests, hasRunningRequests, refreshRequests])

  // فحص دوري احتياطي للأسئلة كل 5 ثوانٍ عندما تكون هناك جلسة نشطة.
  // هذا يضمن ظهور الأسئلة حتى لو فشل جلب SSE أو حدثت مشكلة في تزامن الحالة.
  useEffect(() => {
    if (authState !== "signedIn" || !activeId) {
      return
    }
    const timer = window.setInterval(() => {
      void refreshRequests(activeId).catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [authState, activeId, refreshRequests])

  useEffect(() => {
    if (authState !== "signedIn" || !selectedProject) {
      return
    }
    // Poll all sessions' statuses so the conversation list always shows
    // which chats OpenCode is actively working in, even in background.
    // + قائمة الجلسات نفسها عشان جلسة جديدة من اللاب تبان من غير ما تستنى حدث SSE
    // (الـ SSE بيضيع لما الشاشة تتقفل أو الشبكة تفصل).
    void refreshStatuses()
    void refreshActivity()
    void refreshSessions().catch(() => undefined)
    void refreshGitChanges()
    // Fallback فقط: طول ما اتصال الـ SSE مفتوح، الأحداث هي مصدر التحديث
    // (الحالة والنشاط والجلسات تتحدث مع كل حدث لحظيًا) — فالـ polls الدورية
    // تتخطى لتوفير الطلبات. عند انقطاع الاتصال (error/close) ترجع الـ polls
    // فورًا كشبكة أمان. هذا تنسيق وليس إطالة للمهلة.
    const timer = window.setInterval(() => {
      if (document.hidden || sseLiveRef.current) {
        return
      }
      void refreshStatuses()
      void refreshActivity()
      // طلبات المحادثة المفتوحة (ومعاها الأسئلة والأذونات) مالهاش poll دوري
      // غير ده: بدونها سؤال بييجي وقت ما الستريم ميت والجلسة idle ما بيظهرش
      // غير بعد refresh، لأن الـ poll بتاعها بيقف وهي مش busy ولا فيها طابور.
      const id = activeIdRef.current
      if (id) {
        void refreshRequests(id).catch(() => undefined)
      }
    }, 4000)
    // جلسات اللاب الجديدة تلتقط حتى لو الـ SSE ضاع — كل 12 ثانية كفاية ومش تقيلة
    const sessionsTimer = window.setInterval(() => {
      if (document.hidden || sseLiveRef.current) {
        return
      }
      void refreshSessions().catch(() => undefined)
    }, 12000)
    // لما ترجع لتاب اللاب بعد ما كان في الخلفية: حدّث الطازج فقط بدل العاصفة
    // الكاملة — كل مورد يتخطى لو اتجلب حديثًا، والباقي يتوزع على مهل صغيرة
    // (stagger) عشان reconnect + focus + event ميضربوش نفس الـ endpoints لحظيًا.
    // ومعاه حدّث الموديلات بصمت عشان القائمة تعكس المتاح في opencode لحظيًا.
    const staggerTimers: number[] = []
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (!isFresh("status")) {
          void refreshStatuses()
        }
        if (!isFresh("activity")) {
          staggerTimers.push(window.setTimeout(() => void refreshActivity(), 400))
        }
        if (!isFresh("sessions")) {
          staggerTimers.push(window.setTimeout(() => void refreshSessions().catch(() => undefined), 900))
        }
        if (!isFresh("git", 30000)) {
          staggerTimers.push(window.setTimeout(() => void refreshGitChanges(), 1400))
        }
        void loadModels(true)
        const id = activeIdRef.current
        if (id) {
          void refreshRequests(id).catch(() => undefined)
        }
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(sessionsTimer)
      for (const stagger of staggerTimers) {
        window.clearTimeout(stagger)
      }
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [authState, selectedProject, refreshStatuses, refreshRequests, loadModels, refreshActivity, refreshGitChanges, refreshSessions, isFresh])

  const handleOpenCodeEvent = useCallback((event: ClientEvent) => {
    if (event.type === "session.status") {
      // نفس الحالة اللي عندنا بالفعل (نفس النوع) — مفيش داعي ننتج ref جديد
      // للـ rawStatuses، والـ useSettledStatuses والـ effect بتاع باقي الجلسات
      // هيتجنّبوا أي عمل. ده كاسد صرف حقيقي أثناء الكتابة الفورية لما
      // opencode يبعت نفس الحالة تاني وتاني.
      const incomingType = event.properties.status?.type
      setRawStatuses((current) => {
        if (current[event.properties.sessionID]?.type === incomingType) {
          return current
        }
        return { ...current, [event.properties.sessionID]: event.properties.status }
      })
      // حالة شغل اتغيرت في أي مشروع — حدّث شريط "شغال الآن" فورًا
      void refreshActivity()
      // جلسة من اللاب أول مرة نشوفها busy وهي مش في قائمة المشروع المفتوح:
      // هات القائمة فورًا عشان تبان في النشطة بدل ما تستنى الـ poll
      if ((event.properties.status?.type === "busy" || event.properties.status?.type === "retry")
        && !sessionsRef.current.some((session) => session.id === event.properties.sessionID)) {
        void refreshSessions().catch(() => undefined)
      }
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshRequests(event.properties.sessionID)
      }
    }
    if (event.type === "session.idle") {
      // نفس قاعدة session.status فوق: لو الجلسة أصلًا idle متعملش ref جديد
      setRawStatuses((current) => {
        if (current[event.properties.sessionID]?.type === "idle") {
          return current
        }
        return { ...current, [event.properties.sessionID]: { type: "idle" } }
      })
      void refreshActivity()
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshRequests(event.properties.sessionID)
      }
    }
    // النص الحي للرد الجاري: أي جزء جديد من رسالة opencode يحدّث كارت
    // الطلب الشغّال فورًا (بخنق 1.5 ثانية عشان الأحداث بتيجي متتالية بسرعة).
    if (event.type === "message.part.updated" || event.type === "session.diff") {
      const sessionID = (event.properties as { sessionID?: unknown }).sessionID
      if (typeof sessionID === "string") {
        if (sessionID === activeIdRef.current) {
          const now = Date.now()
          if (now - messageRefreshAt.current > 1500) {
            messageRefreshAt.current = now
            void refreshRequests(sessionID)
          } else if (messageRefreshTimer.current === null) {
            messageRefreshTimer.current = window.setTimeout(() => {
              messageRefreshTimer.current = null
              messageRefreshAt.current = Date.now()
              const id = activeIdRef.current
              if (id) {
                void refreshRequests(id).catch(() => undefined)
              }
            }, 1200)
          }
        } else {
          // رسايل بتتكتب في جلسة خلفية (من اللاب) — حدّث النشطة مدمجًا
          // (الأحداث بالعشرات/ثانية، والفوري كان عاصفة polls)
          requestActivityRefresh()
        }
      }
    }
    if (event.type === "question.asked") {
      // صوت واهتزاز بس من غير toast — كارت السؤال هو الإشارة نفسها
      notifyAttention()
      // سؤال من أي جلسة (حتى اللاب) يحدّث النشطة — مدمجًا (حدث نادر لكن حرج،
      // والكارت نفسه يتحدث فوريًا أدناه فلا يضيع التنبيه)
      requestActivityRefresh()
      const sessionID = event.properties.sessionID
      // جلب متكرر بفواصل متزايدة عشان نغطي أي توقيت ضايع: جلب أولي ممكن
      // يُرمى بسبب ticket guard، أو يفشل بسبب شبكة ضعيفة، أو يرجع فاضي
      // بسبب كاش قديم. الفواصل المتزايدة تمنع العاصفة وتغطي أي تأخير في
      // المحرك أو الشبكة.
      //
      // كان 6 محاولات ([500, 1000, 2000, 3000, 5000, 8000] = 19.5 ثانية، 7 طلبات)
      // على كل سؤال/رد.مع in-flight dedup الجديد في `getRequests`، المحاولة
      // الإضافية بتلحق نفس الـ Promise لو الطلب الحالي قائم — فالفايدة العملية
      // من المحاولات 4–6 صفر. نخلّي محاولتين فقط ([1500, 4000]) لتغطية
      // ticket-guard races على فترات متزايدة.
      const retryDelays = [1500, 4000]
      void refreshRequests(sessionID).catch(() => undefined)
      for (const delay of retryDelays) {
        window.setTimeout(() => {
          void refreshRequests(sessionID).catch(() => undefined)
        }, delay)
      }
    } else if (event.type === "question.replied" || event.type === "question.rejected") {
      const sessionID = event.properties.sessionID
      // نفس الجلب المتكرر: ردّ من جهاز تاني ضاع جلبه كان هيسيب كارت شبحًا للأبد
      const retryDelays = [1500, 4000]
      void refreshRequests(sessionID).catch(() => undefined)
      for (const delay of retryDelays) {
        window.setTimeout(() => {
          void refreshRequests(sessionID).catch(() => undefined)
        }, delay)
      }
    }
    if (event.type === "permission.updated") {
      setPermissions((current) => [...current.filter((permission) => permission.id !== event.properties.id), event.properties])
      notifyAttention(t.permissionNeedsApproval)
      requestActivityRefresh()
    }
    if (event.type === "permission.replied") {
      setPermissions((current) => current.filter((permission) => permission.id !== event.properties.permissionID))
    }
    if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
      void refreshSessions().catch(() => undefined)
      // جلسة جديدة من اللاب تبان في النشطة — مدمجًا مع أي أحداث متتابعة
      requestActivityRefresh()
      // لو الجلسة النشطة اتحدثت (ممكن الموديل اتغير من الديسكتوب) حدّث الموديل المعروض
      if (event.type === "session.updated" && event.properties.sessionID === activeIdRef.current) {
        const id = event.properties.sessionID
        void getSessionModel(id)
          .then((state) => {
            if (activeIdRef.current !== id) {
              return
            }
            setCurrentModel(state.model || state.defaultModel)
            setDefaultModel(state.defaultModel)
          })
          .catch(() => undefined)
      }
    }
    if (event.type === "session.error" && event.properties.sessionID === activeIdRef.current) {
      notifyAttention(t.taskStoppedWithError)
    }
  }, [notifyAttention, refreshSessions, refreshRequests, refreshActivity, requestActivityRefresh, t])

  const handleUnknownEvent = useCallback(() => {
    addToast(t.unknownEvent, "error")
  }, [addToast, t.unknownEvent])

  // الاتصال الحي (SSE) وإعادة المزامنة بعد الانقطاع وحارس الجمود — كله جوه
  // الهوك. App بيسيب بس القراءات المشتركة: حالة الاتصال للعرض، وsseLiveRef
  // للـ polls الدورية، وlastSseAtRef لحارس الإرسال.
  const eventConnected = useEventStream({
    enabled: authState === "signedIn",
    activeIdRef,
    sseLiveRef,
    lastSseAtRef,
    isFresh,
    refreshStatuses,
    refreshRequests,
    refreshActivity,
    onEvent: handleOpenCodeEvent,
    onUnknownEvent: handleUnknownEvent,
  })

  useEffect(() => {
    if (authState !== "signedIn") {
      return
    }
    const onInstallPrompt = (event: globalThis.Event) => {
      event.preventDefault()
      setInstallPrompt(event as unknown as InstallPrompt)
    }
    window.addEventListener("beforeinstallprompt", onInstallPrompt)
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt)
  }, [authState])

  useEffect(() => {
    if (authState !== "signedIn") {
      return
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported")
    } else if (Notification.permission === "denied") {
      setPushState("blocked")
    } else {
      void navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => setPushState(subscription ? "enabled" : "unknown"))
        .catch(() => setPushState("unknown"))
    }
  }, [authState])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError("")
    setLoading(true)
    try {
      await login(accessToken)
      await enterApp()
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : t.loginFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await logout().catch(() => undefined)
    setAuthState("signedOut")
    setProjects([])
    setSelectedProject(null)
    setSessions([])
    setActiveId(null)
    setRequests([])
    setRequestQuestions([])
    setStalledIds(new Set())
    setGitChanges(null)
    setAccessToken("")
  }

  // فتح منتقي المشاريع من زرار "محادثة جديدة": المحادثة الجديدة ما تتربطش
  // تلقائيًا بالمشروع المفتوح حاليًا — فتح مشروع لمجرد متابعة شغل (زي RemoteCode
  // اللي فيه جلسة مساعد) مش اختيار له، والمستخدم يختار مشروع المحادثة بنفسه.
  const requestNewSession = () => {
    if (!selectedProject || switchingProject) {
      return
    }
    setPickingNewSession(true)
  }

  // الاختيار وصل: نبدّل المشروع لو مختلف، وبعدها نفتح مسودة فاضية فيه.
  // المنتقي (بزرار الإلغاء) يفضل مفتوح أثناء التبديل فيعرض "جارٍ فتح المشروع".
  const startNewSessionInProject = async (project: Project) => {
    // لو الجلسة الحالية فاضية ومفيهاش أي رسالة: امسحها الأول عشان متتراكمش.
    // الحذف قبل أي تبديل عشان الجلسة اليتيمة ما تفضلش في المشروع القديم.
    const currentId = activeIdRef.current
    if (currentId && isRequestsEmpty(requests)) {
      try {
        await deleteSession(currentId)
      } catch {
        // لو الحذف فشل نكمل للمسودة عادي
      }
      setSessions((current) => current.filter((session) => session.id !== currentId))
      forgetPinned([currentId])
      setRawStatuses((current) => {
        const next = { ...current }
        delete next[currentId]
        return next
      })
    }
    await openProject(project)
    setPickingNewSession(false)
    // مسودة جديدة بدون حفظ على السيرفر — الحفظ يحصل مع أول رسالة فقط
    setActiveId(null)
    activeIdRef.current = null
    setEditingSessionId(null)
    setTitleDraft("")
    setRequests([])
    setRequestQuestions([])
    resetComposer()
    setShowSessions(false)
  }
  const startNewSessionInProjectRef = useRef(startNewSessionInProject)
  startNewSessionInProjectRef.current = startNewSessionInProject

  const selectSession = async (nextId: string) => {
    if (nextId === activeIdRef.current) {
      setShowSessions(false)
      return
    }
    // لو الجلسة اللي خارج منها فاضية: امسحها تلقائيًا
    const prevId = activeIdRef.current
    const prevWasEmpty = prevId && prevId === activeId && isRequestsEmpty(requests)
    if (prevId && prevWasEmpty && prevId !== nextId) {
      try {
        await deleteSession(prevId)
      } catch {
        // تجاهل خطأ الحذف
      }
      setSessions((current) => current.filter((session) => session.id !== prevId))
      forgetPinned([prevId])
      setRawStatuses((current) => {
        const next = { ...current }
        delete next[prevId]
        return next
      })
    }
    setActiveId(nextId)
    activeIdRef.current = nextId
    // Drop the previous task's requests/plan instantly; the activeId effect
    // re-fetches for the new task right after.
    setRequests([])
    setRequestQuestions([])
    setShowSessions(false)
  }

  // القفز لمحادثة شغالة من شريط "شغال الآن" — حتى لو في مشروع تاني
  const jumpToActivitySession = async (item: ActiveSession) => {
    if (jumpingId || item.id === activeIdRef.current) {
      return
    }
    // نفس المشروع: اختار الجلسة مباشرة (ولو القايمة قديمة حدّثها الأول)
    // نقارن بالـ directory كمان لأن worktree قد يكون مختلفًا عن مكان الجلسة
    const inSelected = selectedProject
      && (samePath(item.worktree, selectedProject.worktree) || samePath(item.directory, selectedProject.worktree))
    if (inSelected) {
      setJumpingId(item.id)
      try {
        const known = sessionsRef.current.some((session) => session.id === item.id)
        if (!known) {
          await refreshSessions()
        }
        await selectSession(item.id)
      } finally {
        setJumpingId(null)
      }
      return
    }
    const project = projects.find((candidate) => samePath(candidate.worktree, item.directory))
      || projects.find((candidate) => samePath(candidate.worktree, item.worktree))
    if (!project) {
      addToast(t.projectNotInList, "error")
      return
    }
    setJumpingId(item.id)
    try {
      await openProject(project, item.id)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.openConversationFailed, "error")
    } finally {
      setJumpingId(null)
    }
  }

  // مراجع مستقرة لأزرار ترويسة كارت المهمة: بدونها الـ RequestCard الـ memo
  // بيفشل مع كل ضغطة حرف في الـ composer ويعيد رسم قائمة الطلبات كلها.
  const startRenamingSession = useCallback(() => {
    if (!activeSession) {
      return
    }
    setTitleDraft(displayTitle(activeSession.title, t))
    setEditingSessionId(activeSession.id)
  }, [activeSession, t])

  const cancelRenamingSession = useCallback(() => {
    if (renamingTitle) {
      return
    }
    setEditingSessionId(null)
    setTitleDraft("")
  }, [renamingTitle])

  const handleRenameSession = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = titleDraft.trim()
    if (!editingSessionId || !title || renamingTitle) {
      return
    }
    const sessionId = editingSessionId
    setRenamingTitle(true)
    try {
      const updated = await renameSession(sessionId, title, langRef.current)
      setSessions((current) => current.map((session) => session.id === updated.id ? updated : session))
      setEditingSessionId(null)
      setTitleDraft("")
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.renameFailed, "error")
    } finally {
      setRenamingTitle(false)
    }
  }, [titleDraft, editingSessionId, renamingTitle, addToast, t])

  const handleSessionTitleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      cancelRenamingSession()
    }
  }, [cancelRenamingSession])

  const handleDeleteSession = async (session: Session) => {
    if (!window.confirm(`${t.deleteSessionConfirm} «${displayTitle(session.title, t)}»؟`)) {
      return
    }
    try {
      await deleteSession(session.id)
      const remaining = sessions.filter((item) => item.id !== session.id)
      setSessions(remaining)
      // مثبّتة كانت؟ التثبيت بيتشال معاها فورًا وإلا هيفضل id ميت في التخزين
      forgetPinned([session.id])
      if (activeId === session.id) {
        const next = remaining[0]?.id || null
        setActiveId(next)
        activeIdRef.current = next
        if (!next) {
          setRequests([])
          setRequestQuestions([])
          resetComposer()
        } else {
          await refreshRequests(next)
        }
      }
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.deleteFailed, "error")
    }
  }

  // تبديل التثبيت: بيغيّر حالة واحدة بس (المحادثة دي) من غير ما يمس الباقي.
  // هنا بيانات العرض بس — المشروع ومعرّفه الثابت هما مسؤولية الـ hook
  // (المشروع المفتوح دلوقتي)، فمش ممكن المثبّتة تطلع في لوحة مشروع تاني.
  // والمخزّن على سيرفر واحد عشان كل الأجهزة والتطبيقات التانية تشوفها فورًا。
  const handlePinSession = (session: Session) => {
    togglePin({
      id: session.id,
      title: session.title || "",
      created: session.time.created,
      directory: session.directory || "",
      worktree: "",
      projectKey: "",
      projectName: "",
    })
  }

  // مراجع (refs) لأحدث نسخ من handlers عشان نبني wrappers مستقرة لـ
  // SessionItem. الـ memo على SessionItem بيشتغل على تغيّر المرجع؛ لو مررنا
  // الكولباك نفسه بتغير كل رندر، كل صف بيعيد الرسم. الـ ref handlers
  // بتتجدد مع كل رندر لكن المرجع اللي في الـ ref بيقرأه الكولباك المستقر
  // بيكون هو الأحدث وقت النقر.
  const selectSessionRef = useRef(selectSession)
  selectSessionRef.current = selectSession
  const handleDeleteSessionRef = useRef(handleDeleteSession)
  handleDeleteSessionRef.current = handleDeleteSession
  const handlePinSessionRef = useRef(handlePinSession)
  handlePinSessionRef.current = handlePinSession
  const handleSelectSessionItem = useCallback((id: string) => {
    void selectSessionRef.current(id)
  }, [])
  const handleDeleteSessionItem = useCallback((session: Session) => {
    void handleDeleteSessionRef.current(session)
  }, [])
  const handleTogglePinItem = useCallback((session: Session) => {
    handlePinSessionRef.current(session)
  }, [])

  // مراجع (refs) لـ openProject + طلب محادثة جديدة عشان نبني wrappers
  // مستقرة للـ Sidebar والـ TopBar. بدون ده الاتنين بيستلموا callbacks جديدة
  // كل رندر، فالـ memo عليهم بيفشل وكل الرندراه بتعيد بناء شجرة كاملة.
  const openProjectRef = useRef(openProject)
  openProjectRef.current = openProject
  const requestNewSessionRef = useRef(requestNewSession)
  requestNewSessionRef.current = requestNewSession
  const handleSelectProjectSidebar = useCallback((project: Project) => {
    void openProjectRef.current(project)
  }, [])
  const handleNewSessionSidebar = useCallback(() => {
    requestNewSessionRef.current()
  }, [])
  // اختيار مشروع المحادثة الجديدة من المنتقي: نفس قاعدة المراجع فوق —
  // الـ callback يفضل ثابت المرجع والـ ProjectPicker الـ memo يعمل bail-out.
  const handlePickNewSessionProject = useCallback((project: Project) => {
    void startNewSessionInProjectRef.current(project)
  }, [])
  const closeNewSessionPicker = useCallback(() => setPickingNewSession(false), [])

  // Stable wrappers للـ TopBar عشان نفس السبب: handlers زي handleAbort/handleSend
  // تتجدّد كل رندر، والـ TopBar الـ memo بيفشل في توفير bail-out.
  // المراجع بتتحط بعد تعريف الـ handlers عشان TypeScript يقدر يتأكد منها.
  const handleOpenSessions = useCallback(() => setShowSessions(true), [])
  const handleCloseSessions = useCallback(() => setShowSessions(false), [])
  const handleShowActivity = useCallback(() => setShowActivity(true), [])
  const handleShowHistory = useCallback(() => setShowHistory(true), [])
  const handleShowPinned = useCallback(() => setShowPinned(true), [])
  const handleShowReleases = useCallback(() => setShowReleases(true), [])
  const handleShowSettings = useCallback(() => setShowSettings(true), [])
  const handleShowModels = useCallback(() => setShowModels(true), [])
  // `toggleLanguage` و `toggleTheme` و `toggleSound` مستقرة فوق (إلا حذفتها
  // في الأعلى عشان تتشارك مع سطر الذيل. التوب بار بياخدها مباشرة).

  // فتح محادثة مثبّتة: اللوحة بتعرض مثبّتات المشروع المفتوح بس، فبنختارها
  // على طول. الفروع اللي ورا guards دي بتخدم الحالة النادرة لمثبّتة لسه ما
  // اتنسبتش لمشروع (كاش قديم) — بنفس سلوك تبديل المشروع في "النشطة".
  const openPinnedConversation = async (pin: PinnedConversation) => {
    if (pin.id === activeIdRef.current) {
      closePinnedPanel()
      return
    }
    const inSelected = selectedProject
      && (samePath(pin.worktree, selectedProject.worktree) || samePath(pin.directory, selectedProject.worktree))
    if (inSelected) {
      closePinnedPanel()
      if (!sessionsRef.current.some((session) => session.id === pin.id)) {
        await refreshSessions()
      }
      await selectSession(pin.id)
      return
    }
    const project = projects.find((candidate) => samePath(candidate.worktree, pin.directory))
      || projects.find((candidate) => samePath(candidate.worktree, pin.worktree))
    if (!project) {
      addToast(t.projectNotInList, "error")
      return
    }
    closePinnedPanel()
    try {
      await openProject(project, pin.id)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.openConversationFailed, "error")
    }
  }

  // فتح/قفل لوحة المثبّتات
  const closePinnedPanel = () => setShowPinned(false)

  // إرسال نص كطلب — المشترك بين زرار الإرسال وزرار commit و push.
  // المرفقات بتُمرَّر صريح (مش من الحالة) عشان طلبات git ما تشيلش مرفقات
  // الكومبوزر بالغلط، ولأن النداء بيحصل بعد ما نفضّي الحالة فورًا.
  const sendPrompt = useCallback(async (rawText: string, files: ComposerAttachment[] = []) => {
    const text = rawText.trim()
    if ((!text && files.length === 0) || sendingRef.current) {
      return
    }
    sendingRef.current = true
    setSending(true)
    resetComposer()
    // كارت optimist: بيظهر الطلب تحت اللي قبله فورًا قبل ما السيرفر يرد
    const optimisticId = `local-${++localRequestId.current}`
    try {
      // لو مسودة جديدة: أنشئ الجلسة مع أول رسالة فقط
      let sessionId = activeIdRef.current
      const isNewSession = !sessionId
      // ترتيب الأسبقية: اختيار المستخدم للمحادثة دي > الافتراضي المحفوظ للمشروع
      // > موديل آخر جلسة > الـ default العام بتاع opencode
      const modelForNewSession = isNewSession ? (pendingModel || projectDefaultModel || currentModel || defaultModel || undefined) : undefined
      if (!sessionId) {
        const created = await createSession(undefined, true)
        sessionId = created.id
        setSessions((current) => sortSessionsByCreated([created, ...current]))
        setActiveId(created.id)
        activeIdRef.current = created.id
        if (modelForNewSession) {
          // ثبّت الموديل المختار على الجلسة الجديدة فور إنشائها
          try {
            await setSessionModel(sessionId, modelForNewSession, langRef.current)
            setCurrentModel(modelForNewSession)
          } catch {
            // لو التثبيت فشل هنبعته مع أول رسالة كـ override
          }
        }
      }
      const now = Date.now()
      // لو المستخدم بعت مرفق من غير نص، الكارت يعرض أسماء المرفقات بدل فراغ
      const displayPrompt = text || files.map((file) => file.name).join(", ")
      setRequests((current) => [...current, {
        id: optimisticId,
        index: current.length + 1,
        prompt: displayPrompt,
        state: "queued",
        activity: getStrings(langRef.current).taskQueued,
        finalResult: "",
        liveText: "",
        stepsCompleted: 0,
        activeTool: null,
        usedTools: [],
        resultFiles: [],
        // المرفقات تظهر فورًا في الكارت الـ optimist قبل ما السيرفر يرجّعها
        // في /requests — بنفس الشكل اللي السيرفر بيبعته (بلا id/size).
        attachments: files.map((file) => ({ name: file.name, mime: file.mime, uri: file.uri })),
        startedAt: now,
        completedAt: 0,
        updatedAt: now,
      }])
      await sendMessage(sessionId, text, undefined, isNewSession && modelForNewSession ? modelForNewSession : undefined, files)
      if (isNewSession && modelForNewSession) {
        setCurrentModel(modelForNewSession)
        setPendingModel(null)
      }
      // الكارت الـ optimistic شايفه بعينك في الطابور — من غير toast
      // Optimistic update so a new conversation shows the current request
      // immediately without a manual refresh. The backend flips to busy
      // asynchronously, so the first refreshRequests may still see idle.
      setSettledStatus(sessionId, { type: "busy" })
      await refreshRequests(sessionId).catch(() => undefined)
      // Re-assert busy if the backend hasn't flipped yet; the safety refresh
      // below plus SSE plus polling will correct to the real status.
      await refreshSessions().catch(() => undefined)
      // فحص أمان واحد بدل ٣ مؤقتات ثابتة: لو وصل أي حدث SSE بعد الإرسال
      // فالحالة تتحدث عبر الأحداث ولا داعي لطلب إضافي. لو مفيش أحداث
      // (SSE فاصل) نحدّث مرة واحدة كـ fallback — من غير عاصفة polls.
      const sentAt = Date.now()
      window.setTimeout(() => {
        if (activeIdRef.current === sessionId && lastSseAtRef.current <= sentAt) {
          void refreshRequests(sessionId).catch(() => undefined)
        }
      }, 6000)
    } catch (error: unknown) {
      setRequests((current) => current.filter((request) => request.id !== optimisticId))
      // رجّع النص والمرفقات بس لو المستخدم لسه ماكتبش/ما أضافش حاجة جديدة
      setComposer((current) => current || text)
      if (files.length > 0) {
        setAttachments((current) => (current.length > 0 ? current : files))
      }
      addToast(error instanceof Error ? error.message : getStrings(langRef.current).messageSendFailed, "error")
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [pendingModel, projectDefaultModel, currentModel, defaultModel, refreshRequests, refreshSessions, setSettledStatus, addToast, resetComposer])

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault()
    await sendPrompt(composer, attachments)
  }

  // طلبات الـ git كلها جوّه hook واحد عشان الـ drawer والـ guard وحالة التأكيد
  // يفضلوا في مكان واحد بدل ما App يوزّعهم
  const gitRequests = useGitRequests(gitChanges, sending, langRef.current, sendPrompt)

  // إضافة الملفات الملصوقة كمرفقات بنفس قواعد الأزرار (نوع/قدرة النموذج/حدود)
  const handleComposerFiles = (files: File[]) => {
    if (files.length === 0) {
      return
    }
    void addAttachmentFiles(attachments, files, { image: supportsImageAttachments, pdf: supportsPdfAttachments }).then(({ attachments: next, rejection }) => {
      if (next.length !== attachments.length) {
        setAttachments(next)
      }
      if (rejection) {
        addToast(attachmentRejectionMessage(rejection, t), "error")
      }
    })
  }

  // إدراج نص ملصوق من الحافظة في آخر المسودة مع مسافة فاصلة عند الحاجة
  const handleComposerText = (text: string) => {
    setComposer((current) => {
      if (!current) {
        return text
      }
      return /\s$/.test(current) ? current + text : `${current} ${text}`
    })
  }

  const handleAbort = async () => {
    if (!activeId) {
      return
    }
    const id = activeId
    abortedRef.current.add(id)
    try {
      await abortSession(id)
      // الوقف شايفه بعينك (الكارت وقف) — من غير toast
      await refreshRequests(id).catch(() => undefined)
      // حدّث الحالة فورًا عشان تختفي من "النشطة"
      setSettledStatus(id, { type: "idle" })
      void refreshActivity()
    } catch (error: unknown) {
      abortedRef.current.delete(id)
      addToast(error instanceof Error ? error.message : t.abortFailed, "error")
    }
  }

  // stable wrappers للـ TopBar (مراجع على handlers المتجدّدة): نفس اللي عملناه
  // فوق لـ selectSession/handleDelete/handlePin. بدون ده الـ TopBar بيتسلم
  // callbacks جديدة كل رندر ويفشل الـ memo.
  const handleLogoutRef = useRef<() => Promise<void>>(handleLogout)
  handleLogoutRef.current = handleLogout
  const handleLogoutTop = useCallback(() => {
    void handleLogoutRef.current()
  }, [])
  const handleOpenGitChanges = useCallback(() => {
    gitRequests.show()
    void refreshGitChanges()
  }, [gitRequests, refreshGitChanges])

  const handleSkip = useCallback(async (request: SessionRequest) => {
    if (!activeId || queueAction) {
      return
    }
    const id = activeId
    setQueueAction(request.id)
    try {
      const result = await skipRunningRequest(id)
      if (result.skipped) {
        // الطلب القديم لسه بيكمل إنهاء بلاشته، فبنمنع صوت الإتمام بتاعه
        abortedRef.current.add(id)
      }
      await refreshRequests(id).catch(() => undefined)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.skipFailed, "error")
    } finally {
      setQueueAction(null)
    }
  }, [activeId, queueAction, refreshRequests, addToast, t.skipFailed])

  const handleRunNow = useCallback(async (request: SessionRequest) => {
    if (!activeId || queueAction) {
      return
    }
    const id = activeId
    setQueueAction(request.id)
    try {
      const result = await runQueuedRequest(id, request.id)
      if (result.steered) {
        // اتحقن جوه المهمة الشغّالة كتوجيه — اتضاف للشغل الجاري من غير مقاطعة
        addToast(t.queuedSteered, "info")
      } else if (result.started) {
        // اشتغل فعلًا (مفيش مهمة شغّالة) — شايفه بعينك، من غير toast
      } else if (result.queued) {
        // السيرفر رفض الحقن فاتنقل لأول الطابور وهيتنفّذ بعد المهمة الحالية.
        // الصف بيبيّن الحالة بعينك — من غير toast
      } else {
        addToast(t.queuedRunFailed, "error")
      }
      await refreshRequests(id).catch(() => undefined)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.queuedRunFailed, "error")
      await refreshRequests(id).catch(() => undefined)
    } finally {
      setQueueAction(null)
    }
  }, [activeId, queueAction, refreshRequests, addToast, t.queuedSteered, t.queuedRunFailed])

  const handleRemoveQueued = useCallback(async (request: SessionRequest) => {
    if (!activeId || queueAction) {
      return
    }
    const id = activeId
    // الكارت المتفائل لسه مش موجود عند السيرفر — نشيله من الواجهة بس
    if (request.id.startsWith("local-")) {
      setRequests((current) => current.filter((item) => item.id !== request.id))
      return
    }
    setQueueAction(request.id)
    setRequests((current) => current.filter((item) => item.id !== request.id))
    try {
      const result = await removeQueuedRequest(id, request.id)
      if (!result.removed) {
        addToast(t.queuedRemoveFailed, "error")
      }
      // اتشال وشايفه بعينك اختفى — من غير toast نجاح
      await refreshRequests(id).catch(() => undefined)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.queuedRemoveFailed, "error")
      await refreshRequests(id).catch(() => undefined)
    } finally {
      setQueueAction(null)
    }
  }, [activeId, queueAction, refreshRequests, addToast, t.queuedRemoveFailed])

  const handlePermission = useCallback(async (permission: Permission, response: "once" | "always" | "reject") => {
    try {
      await replyPermission(permission.sessionID, permission.id, response)
      setPermissions((current) => current.filter((item) => item.id !== permission.id))
      // الرد شايفه بعينك (الكارت اختفى) — من غير toast
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.permissionReplyFailed, "error")
    }
  }, [addToast, t])

  // خريطة ردود ثابتة لكل كارت إذن: الـ arrow inline كان بياخد مرجعًا جديدًا
  // كل رندر فيكسر memo كارت الإذن. الخريطة بتتبني من نفس مصفوفة الأذونات
  // المعروضة، فكل كارت بياخد دالة ثابتة طول ما إذنه ما اتغيّرش.
  const permissionReplyHandlers = useMemo(() => {
    const handlers = new Map<string, (response: "once" | "always" | "reject") => void>()
    for (const permission of activePermissions) {
      handlers.set(permission.id, (response) => {
        void handlePermission(permission, response)
      })
    }
    return handlers
  }, [activePermissions, handlePermission])

  // ردّ سؤال: مرجع مستقر لـ StickyQuestions عشان ما يفقدش الـ memo كل رندر.
  // بيقرا المحادثة من الـ ref وقت النداء — نفس قيمتها في الرندر دايمًا.
  const handleQuestionsAnswered = useCallback(() => {
    const id = activeIdRef.current
    if (id) {
      void refreshRequests(id).catch(() => undefined)
    }
  }, [refreshRequests])

  const displayedModel: SessionModelRef | null = activeId ? currentModel : (pendingModel || projectDefaultModel || currentModel || defaultModel)
  // عنصر النموذج الكامل من القائمة: عنه بنعرف قدرات الإدخال وعنه اسم العرض.
  // البحث كان linear scan في كل render — بنحسبه مرة ونرجّع نفس المرجع.
  const displayedModelInfo = useMemo(
    () => (displayedModel ? models.find((m) => m.providerID === displayedModel.providerID && m.id === displayedModel.modelID) ?? null : null),
    [models, displayedModel],
  )
  const displayedModelName = displayedModelInfo
    ? shortModelName(displayedModelInfo)
    : (displayedModel?.modelID ?? t.defaultModel)
  // قدرات مرفقات الكومبوزر: النص دايماً متاح، والصور/PDF حسب قدرات المحرك.
  // النموذج غير المعروف = مش بنقفل النص، بس الصور والـ PDF يفضلوا مقفولين.
  const supportsImageAttachments = modelSupports(displayedModelInfo, "image")
  const supportsPdfAttachments = modelSupports(displayedModelInfo, "pdf")

  // أي اختيار موديل/مستوى تفكير بيتحفظ كافتراضي للمشروع — عشان المحادثات
  // الجاية تبدأ بيه من غير ما تعيد اختياره كل مرة
  const rememberModelAsProjectDefault = useCallback((ref: SessionModelRef) => {
    if (!selectedProject) {
      return
    }
    saveDefaultModel(selectedProject.worktree, ref)
    setProjectDefaultModel(ref)
  }, [selectedProject])

  const handleSelectModel = async (model: ModelInfo, variant?: string) => {
    const cleanVariant = (variant || "").trim()
    const ref: SessionModelRef = { providerID: model.providerID, modelID: model.id, ...(cleanVariant ? { variant: cleanVariant } : {}) }
    // الموديل ده عنده خيارات variety — نسيب الدروير مفتوح عشان المستخدم يختار منهم
    const keepOpen = getVarietyLevels(model).length > 0
    const sessionId = activeIdRef.current
    // مسودة جديدة: احفظ الاختيار وهيتطبق مع أول رسالة
    if (!sessionId) {
      setPendingModel(ref)
      setCurrentModel(ref)
      rememberModelAsProjectDefault(ref)
      if (!keepOpen) {
        setShowModels(false)
      }
      // الليبل اتغيّر وشايفه بعينك — من غير toast
      return
    }
    if (isBusy) {
      addToast(t.waitBeforeModelChange, "error")
      return
    }
    const key = `${ref.providerID}/${ref.modelID}`
    setSwitchingKey(key)
    try {
      const result = await setSessionModel(sessionId, ref, lang)
      setCurrentModel(result.model)
      rememberModelAsProjectDefault(result.model)
      if (!keepOpen) {
        setShowModels(false)
      }
      // الليبل اتغيّر وشايفه بعينك — من غير toast
      await refreshRequests(sessionId).catch(() => undefined)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.modelChangeFailed, "error")
    } finally {
      setSwitchingKey(null)
    }
  }

  // مرجع مستقر: بيتنقل لكل صف وزر نسخ — تجدّده كان بيكسر memo الصفوف.
  const copyText = useCallback((text: string) => {
    if (!text) return
    if (navigator.clipboard && window.isSecureContext) {
      void navigator.clipboard.writeText(text)
    } else {
      // Fallback for non-secure contexts
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      try {
        document.execCommand("copy")
      } catch {
        // Ignore
      }
      document.body.removeChild(textarea)
    }
    // النسخ فعل واضح من الزرار — من غير toast
  }, [])

  const enablePush = async () => {
    if (!config.push.enabled || !config.push.publicKey) {
      addToast(t.pushNotConfigured, "error")
      return
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported")
      return
    }
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setPushState("blocked")
        return
      }
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToUint8Array(config.push.publicKey) as BufferSource })
      }
      await subscribePush(subscription.toJSON() as Parameters<typeof subscribePush>[0], langRef.current)
      setPushState("enabled")
      // الزرار بقى enabled وشايفه بعينك — من غير toast
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.pushEnableFailed, "error")
    }
  }

  const disablePush = async () => {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await unsubscribePush(subscription.endpoint)
        await subscription.unsubscribe()
      }
      setPushState("unknown")
      // الزرار رجع وشايفه بعينك — من غير toast
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.pushDisableFailed, "error")
    }
  }

  const installApp = async () => {
    if (!installPrompt) {
      return
    }
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === "accepted") {
      setInstallPrompt(null)
    }
  }

  // تنزيل شهادة الـ CA: الملف اللي بيتثبّت مرة على الهاتف عشان الكروم يثق
  // بأصل HTTPS، ومن غيره المايك والإشعارات مرفوضين. الفشل بيظهر كـ toast
  // (مش زي التنزيل الناجح اللي المتصفح بيبيّنه لوحده).
  const downloadCertificateFile = async () => {
    try {
      await downloadCertificate()
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.installCertificateFailed, "error")
    }
  }

  // مرجع مستقر لـ TopBar (تجدّده كان بيفشل الـ memo) — بيتغيّر مع soundOn فقط
  const toggleSound = useCallback(() => {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
    if (next) {
      unlockAudio()
      playCompletionSound()
      // سامع الصوت وشايف الزرار — من غير toast
    }
    // القفل شايفه بعينك في الزرار — من غير toast
  }, [soundOn])

  const testSound = () => {
    unlockAudio()
    playCompletionSound()
    vibrate([180, 100, 180, 100, 320])
  }

  // صف المحادثة في القائمة الجانبية — مرر لـ SessionItem ككولباكز مستقرة
  // (memoized) عشان كل صف يعمل bail-out لما بياناته ما تتغيرش، بدل ما
  // الـ App كله يعيد رسم 50+ صف في كل setState.

  if (authState === "loading") {
    return <div className="center-screen"><div className="loader" /><p>{t.connectingToOpencode}</p></div>
  }

  if (authState === "signedOut") {
    return (
      <main className="login-screen">
        <div className="login-card">
          <div className="brand-mark"><img src="/icon.svg" alt="OpenCode" /></div>
          <div className="eyebrow">RemoteCode</div>
          <h1>{t.loginTitle}</h1>
          <p className="login-copy">{t.loginCopyEnv} <code>pwa/.env</code> {t.loginCopyAfter}</p>
          <form onSubmit={handleLogin}>
            <label htmlFor="access-token">{t.accessToken}</label>
            <input id="access-token" type="password" autoComplete="current-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="••••••••••••••••" required />
            {loginError ? <div className="form-error">{loginError}</div> : null}
            <button className="button button-primary button-wide" disabled={loading}>{loading ? t.verifying : t.secureLogin}</button>
          </form>
          <div className="login-footnote"><span className="status-dot offline" /> {t.localEncryptedNote}</div>
          <button className="button button-ghost button-wide" onClick={toggleTheme}>{t.switchThemeNext}: {THEME_META[nextTheme(theme)].icon} {themeLabel(nextTheme(theme), t)}</button>
          <button className="button button-ghost button-wide" onClick={toggleLanguage}>{t.language}: {lang === "ar" ? "English" : "العربية"}</button>
        </div>
      </main>
    )
  }

  if (!selectedProject) {
    return (
      <ProjectPicker
        projects={projects}
        selectedId={undefined}
        switchingKey={switchingProject}
        recentPaths={recentProjects}
        onSelect={handleSelectProjectSidebar}
        t={t}
        lang={lang}
      />
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        showSessions={showSessions}
        onClose={handleCloseSessions}
        eventConnected={eventConnected}
        projects={projects}
        selectedProject={selectedProject}
        switchingProject={switchingProject}
        recentProjects={recentProjects}
        onSelectProject={handleSelectProjectSidebar}
        onNewSession={handleNewSessionSidebar}
        latestVersion={releases[0]?.version ?? ""}
        onShowReleases={handleShowReleases}
        sessionsCount={sessions.length}
        activeSessionsCount={sidebarActiveSessions.length}
        inactiveSessionsCount={sidebarInactiveSessions.length}
        activeSessions={sidebarActiveSessions}
        inactiveSessions={sidebarInactiveSessions}
        activeId={activeId}
        isPinned={isPinned}
        permissionSessionIds={permissionSessionIds}
        statuses={statuses}
        activeSessionItemRef={activeSessionItemRef}
        onSelectSession={handleSelectSessionItem}
        onTogglePin={handleTogglePinItem}
        onDeleteSession={handleDeleteSessionItem}
        t={t}
        lang={lang}
      />

      <main className="main-panel">
        <TopBar
          selectedProject={selectedProject}
          switchingProject={switchingProject}
          onOpenSessions={handleOpenSessions}
          onNewSession={handleNewSessionSidebar}
          onShowActivity={handleShowActivity}
          onShowHistory={handleShowHistory}
          onShowPinned={handleShowPinned}
          onShowReleases={handleShowReleases}
          onShowSettings={handleShowSettings}
          onShowModels={handleShowModels}
          onOpenGitChanges={handleOpenGitChanges}
          onToggleTheme={toggleTheme}
          onToggleLanguage={toggleLanguage}
          onToggleSound={toggleSound}
          onLogout={handleLogoutTop}
          activeSessionsCount={activeSessions.length}
          gitChangedCount={gitChangedCount}
          projectPinsCount={projectPins.length}
          displayedModelName={displayedModelName}
          displayedModel={displayedModel}
          theme={theme}
          soundOn={soundOn}
          lang={lang}
          t={t}
        />

        <div className="workspace">
          <div className="workspace-scroll" ref={workspaceScrollRef} onPointerDown={releaseScrollPin}>
            {requests.length > 0 ? (
              <div className="request-stack">
                <RequestCard requests={requests} sessionId={activeId} listRef={requestListRef} title={activeTitle} status={activeStatus} stalled={activeId ? stalledIds.has(activeId) : false} waitingOnUser={activeId !== null && (activeQuestions.length > 0 || activePermissions.length > 0)} canRenameTitle={activeSession !== undefined} isEditingTitle={editingSessionId !== null && editingSessionId === activeId} titleDraft={titleDraft} renamingTitle={renamingTitle} onStartRename={startRenamingSession} onCancelRename={cancelRenamingSession} onTitleDraftChange={setTitleDraft} onRenameSubmit={handleRenameSession} onTitleKeyDown={handleSessionTitleKeyDown} onCopy={copyText} onToast={addToast} onSkip={handleSkip} onRunNow={handleRunNow} onRemove={handleRemoveQueued} busyAction={queueAction} t={t} />
              </div>
            ) : (
              <div className="welcome-state">
                <div className="welcome-orb"><img src="/icon.svg" alt="OpenCode" /></div>
                <h2>{t.startNewTask}</h2>
                <p>{t.welcomeCopy}</p>
                <div className="suggestions">
                  {t.suggestions.map((suggestion) => <button key={suggestion} onClick={() => setComposer(suggestion)}>{suggestion}<span>↗</span></button>)}
                </div>
              </div>
            )}
            {activeId ? (
              <StickyQuestions questions={activeQuestions} sessionId={activeId} onAnswered={handleQuestionsAnswered} t={t} />
            ) : null}
          </div>

          {activePermissions.length > 0 ? (
            <div className="permissions-stack">
              {activePermissions.map((permission) => <PermissionCard key={permission.id} permission={permission} onReply={permissionReplyHandlers.get(permission.id) ?? NOOP_PERMISSION_REPLY} t={t} />)}
            </div>
          ) : null}

          <div className="composer-wrap">
            <form className="composer" onSubmit={handleSend}>
              <ComposerInput
                inputRef={composerRef}
                value={composer}
                onChange={setComposer}
                onSubmit={() => void handleSend()}
                onFiles={handleComposerFiles}
                placeholder={t.composerPlaceholder}
              />
              <div className="composer-toolbar">
                <ComposerAttachments
                  attachments={attachments}
                  supportsImage={supportsImageAttachments}
                  supportsPdf={supportsPdfAttachments}
                  disabled={sending}
                  onChange={setAttachments}
                  onError={(message) => addToast(message, "error")}
                  t={t}
                />
                <ComposerClipboardButton
                  disabled={sending}
                  onFiles={handleComposerFiles}
                  onText={handleComposerText}
                  onError={(message) => addToast(message, "error")}
                  t={t}
                />
                <VoiceButton t={t} voiceLanguage={voiceLanguage} composer={composer} onComposerChange={setComposer} onError={(message) => addToast(message, "error")} onVoiceLanguageChange={(value) => setVoiceLanguage(value)} />
                <div className="composer-actions">
                  <span className="composer-hint">{t.composerHint}</span>
                  {isBusy || hasQueuedRequests ? <button type="button" className="stop-button" onClick={() => void handleAbort()}>■ {t.stop}</button> : null}
                  <button
                    className={`send-button${composer.trim() || attachments.length > 0 ? " is-ready" : ""}${sending ? " is-sending" : ""}`}
                    disabled={(!composer.trim() && attachments.length === 0) || sending}
                    aria-label={t.launch}
                    title={`${t.launch} 🚀`}
                  >
                    <span className="launch-bezel">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden className="liftoff" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                      </svg>
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </main>

      {showActivity ? (
        <Suspense fallback={<PanelFallback />}>
          <PanelErrorBoundary t={t} panelName="ActiveSessionsPanel" onClose={() => setShowActivity(false)}>
            <ActiveSessionsPanel
              items={activeSessions}
              recent={activityRecent}
              graceLeft={activityGraceLeft}
              activeId={activeId}
              jumpingId={jumpingId}
              onJump={(item) => { setShowActivity(false); void jumpToActivitySession(item) }}
              onClose={() => setShowActivity(false)}
              t={t}
              lang={lang}
            />
          </PanelErrorBoundary>
        </Suspense>
      ) : null}
      {gitRequests.isOpen ? (
        <Suspense fallback={<PanelFallback />}>
          <PanelErrorBoundary t={t} panelName="GitChangesPanel" onClose={gitRequests.close}>
            <GitChangesPanel
              changes={gitChanges}
              loading={gitLoading}
              busy={sending}
              confirming={gitRequests.confirming}
              confirmingPush={gitRequests.confirmingPush}
              onRefresh={() => void refreshGitChanges()}
              onCommitPush={() => void gitRequests.commitPush()}
              onAskCommitPush={gitRequests.askCommitPush}
              onCancelCommitPush={gitRequests.cancelCommitPush}
              onCommit={() => void gitRequests.commit()}
              onPull={() => void gitRequests.pull()}
              onAskRevertAll={gitRequests.askRevertAll}
              onRevertAll={() => void gitRequests.revertAll()}
              onCancelRevertAll={gitRequests.cancelRevertAll}
              onRevertFile={(file) => void gitRequests.revertFile(file)}
              onClose={gitRequests.close}
              t={t}
            />
          </PanelErrorBoundary>
        </Suspense>
      ) : null}
      {showHistory ? (
        <Suspense fallback={<PanelFallback />}>
          <PanelErrorBoundary t={t} panelName="HistoryPanel" onClose={() => setShowHistory(false)}>
            <HistoryPanel
              turns={historyTurns}
              loading={historyLoading}
              error={historyError}
              sessionId={activeId}
              onClose={() => setShowHistory(false)}
              onCopy={copyText}
              onRetry={() => void loadHistory()}
              t={t}
              lang={lang}
            />
          </PanelErrorBoundary>
        </Suspense>
      ) : null}
      {showPinned ? (
        <Suspense fallback={<PanelFallback />}>
          <PanelErrorBoundary t={t} panelName="PinnedConversationsPanel" onClose={closePinnedPanel}>
            <PinnedConversationsPanel
              pins={projectPins}
              activeId={activeId}
              projectName={selectedProject ? projectName(selectedProject) : ""}
              statuses={statuses}
              onSelect={(pin) => { void openPinnedConversation(pin) }}
              onUnpin={(pin) => togglePin(pin)}
              onClose={closePinnedPanel}
              t={t}
              lang={lang}
            />
          </PanelErrorBoundary>
        </Suspense>
      ) : null}
      {showReleases ? (
        <Suspense fallback={<PanelFallback />}>
          <PanelErrorBoundary t={t} panelName="ReleaseNotesPanel" onClose={() => setShowReleases(false)}>
            <ReleaseNotesPanel
              releases={releases}
              onClose={() => setShowReleases(false)}
              t={t}
              lang={lang}
            />
          </PanelErrorBoundary>
        </Suspense>
      ) : null}
      {showModels ? (
        <Suspense fallback={<PanelFallback />}>
          <PanelErrorBoundary t={t} panelName="ModelPicker" onClose={() => setShowModels(false)}>
            <ModelPicker
              models={models}
              loading={modelsLoading}
              current={displayedModel}
              busy={isBusy}
              switching={switchingKey}
              onSelect={(model, variant) => void handleSelectModel(model, variant)}
              onRefresh={() => void loadModels()}
              onClose={() => setShowModels(false)}
              t={t}
            />
          </PanelErrorBoundary>
        </Suspense>
      ) : null}
      {showSettings ? (
        <Suspense fallback={<PanelFallback />}>
          <PanelErrorBoundary t={t} panelName="SettingsDrawer" onClose={() => setShowSettings(false)}>
            <SettingsDrawer
              open
              onClose={() => setShowSettings(false)}
              t={t}
              config={config}
              projectName={selectedProject ? projectName(selectedProject) : ""}
              eventConnected={eventConnected}
              pushState={pushState}
              onEnablePush={() => void enablePush()}
              onDisablePush={() => void disablePush()}
              installPromptAvailable={installPrompt !== null}
              onInstallApp={() => void installApp()}
              onDownloadCertificate={() => void downloadCertificateFile()}
              theme={theme}
              onThemeChange={(value) => setTheme(value)}
              lang={lang}
              onLangChange={(value) => setLang(value)}
              voiceLanguage={voiceLanguage}
              onVoiceLanguageChange={(value) => setVoiceLanguage(value)}
              soundOn={soundOn}
              onTestSound={testSound}
              onToggleSound={toggleSound}
            />
          </PanelErrorBoundary>
        </Suspense>
      ) : null}

      {/* منتقي مشروع المحادثة الجديدة: طبقة فوق التطبيق فالشاشة اللي وراها
          تفضل زي ما هي، والمحادثة ما تبدأش إلا بعد اختيار صريح للمشروع. */}
      {pickingNewSession ? (
        <div className="new-session-picker-overlay">
          <ProjectPicker
            projects={projects}
            selectedId={selectedProject.worktree}
            switchingKey={switchingProject}
            recentPaths={recentProjects}
            onSelect={handlePickNewSessionProject}
            onClose={closeNewSessionPicker}
            title={t.newSessionPickProject}
            subtitle={t.newSessionPickProjectHint}
            t={t}
            lang={lang}
          />
        </div>
      ) : null}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div className={`toast toast-${toast.kind}`} key={toast.id}>{toast.message}<button onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button></div>)}
      </div>
    </div>
  )
}

export default App
