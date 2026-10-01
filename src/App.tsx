import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import {
  ApiError,
  abortSession,
  base64ToUint8Array,
  createSession,
  deleteSession,
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
import type { ActiveSession, AppConfig, AuthState, ClientEvent, ConversationQuestionRequest, GitChanges, HistoryTurn, ModelInfo, Permission, PinnedConversation, Project, Session, SessionModelRef, SessionRequest, SessionStatus, Toast, ToastKind } from "./types"
import { isSoundEnabled, playAttentionSound, playCompletionSound, setSoundEnabled, unlockAudio, vibrate } from "./sound"
import { applyTheme, getSavedTheme, nextTheme, saveTheme, themeDescription, themeLabel, THEMES, THEME_META, type AppTheme } from "./theme"
import { applyLanguage, getSavedLanguage, getStrings, saveLanguage, type Language } from "./i18n"
import {
  displayTitle,
  formatDateTime,
  formatRelative,
  GitBranchIcon,
  getVarietyLevels,
  LogoutIcon,
  projectName,
  samePath,
  SettingsIcon,
  shortModelName,
  SoundMuteIcon,
  SoundOnIcon,
  statusLabel,
} from "./display"
import { ACTIVE_GRACE_MS, COMPOSER_MAX_LINES, PINS_SYNC_EVENT, RECENT_PROJECTS_KEY, emptyConfig } from "./constants"
import { PanelFallback } from "./components/PanelFallback"
import { PermissionCard } from "./components/PermissionCard"
import { ProjectDropdown, ProjectPicker } from "./components/projects/ProjectPicker"
import { QuestionCard } from "./components/requests/QuestionCard"
import { RequestCard } from "./components/requests/RequestCard"
import { useActivityGrace } from "./hooks/useActivityGrace"
import { useGitRequests } from "./hooks/useGitRequests"
import { usePinnedConversations } from "./hooks/usePinnedConversations"
import { useSettledStatuses } from "./hooks/useSettledStatuses"
import { mergeActiveSessions } from "./utils/active-sessions"
import { isTouchComposer } from "./utils/device"
import { normalizeProjectPath } from "./utils/paths"
import { forgetLastSession, isRequestsEmpty, loadDefaultModel, loadLastSessions, loadRecentProjects, saveDefaultModel, saveLastSession, sessionMatches, sortSessionsByCreated } from "./utils/storage"

// أدراج ثقيلة تُحمّل عند الطلب فقط (code-splitting): القائمة الرئيسية
// والشات يظهران فورًا، وهذه اللوحات تنزل عند أول فتح لها
const ModelPicker = lazy(() => import("./panels").then((module) => ({ default: module.ModelPicker })))
const ActiveSessionsPanel = lazy(() => import("./panels").then((module) => ({ default: module.ActiveSessionsPanel })))
const GitChangesPanel = lazy(() => import("./panels").then((module) => ({ default: module.GitChangesPanel })))
const HistoryPanel = lazy(() => import("./panels").then((module) => ({ default: module.HistoryPanel })))
const PinnedConversationsPanel = lazy(() => import("./panels").then((module) => ({ default: module.PinnedConversationsPanel })))

interface InstallPrompt {
  preventDefault: () => void
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
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
  // اللي بيتبعرض منه (أيقونة + "شغّال/جاهز" + تنبيه الإتمام) هو حالة مستقرة،
  // مش آخر عيّنة وصلتنا — عشان تضارب الـ SSE مع الـ poll ما يخطفش الشاشة.
  const [statuses, setSettledStatus] = useSettledStatuses(rawStatuses)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [composer, setComposer] = useState("")
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  // حارس متزامن ضد الإرسال المزدوج: ضغطتان سريعتان قبل إعادة الرسم
  // كانتا تتجاوزان فحص `sending` وتنشئان جلستين على السيرفر، فتظهر
  // "محادثتان نشطتان" وهي واحدة. الـ ref يتحدث فورًا بلا انتظار الـ render.
  const sendingRef = useRef(false)
  // معرّف الطلب اللي شغّال عليه فعل في الطابور دلوقتي (تخطّي/حذف) عشان نمنع ضغط مزدوج
  const [queueAction, setQueueAction] = useState<string | null>(null)
  const [loginError, setLoginError] = useState("")
  const [eventConnected, setEventConnected] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pushState, setPushState] = useState<"unknown" | "enabled" | "unsupported" | "blocked">("unknown")
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState("")
  const [renamingTitle, setRenamingTitle] = useState(false)
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled())
  const [theme, setTheme] = useState<AppTheme>(() => getSavedTheme())
  const [lang, setLang] = useState<Language>(() => getSavedLanguage())
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
  const eventsConnectedOnce = useRef(false)
  const workspaceScrollRef = useRef<HTMLDivElement | null>(null)
  // خنق تحديثات النص الحي: أحداث message.part.updated بتيجي عشرات المرات
  // في الثانية أثناء الكتابة — نحدّث فور أول حدث وبعدها بمهلة قصيرة فقط.
  const messageRefreshAt = useRef(0)
  const messageRefreshTimer = useRef<number | null>(null)
  const showHistoryRef = useRef(false)
  // لتتبع متى نحتاج ننزل لآخر المحادثة عند فتح جلسة جديدة
  const shouldScrollToBottomRef = useRef(false)
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
  const isSessionWorking = useCallback((id: string) => {
    const status = statuses[id]
    const isActiveSession = id === activeId
    const hasRunningOrQueued = isActiveSession
      ? requests.some((r) => r.state !== "done" && r.state !== "stopped")
      : false
    return (status?.type === "busy" || status?.type === "retry") || activityIds.has(id) || hasRunningOrQueued
  }, [statuses, requests, activeId, activityIds])

  // في طلبات مستنية في الطابور؟ لو أيوه لازم نفضل نحدّث لحد ما تخلص كلها
  const hasQueuedRequests = useMemo(() => requests.some((request) => request.state === "queued"), [requests])
  // كارت واقف على "شغّال" لازم يفضل يسأل السيرفر لحد ما السيرفر نفسه يقول
  // إنه خلص. الاعتماد على حالة الجلسة بس كان بيخلي الكارت يعلق شغّال للأبد
  // لما الـ SSE يفصل (قفل الشاشة/الشبكة) والحالة في الموبايل تتأخر عن OpenCode.
  const hasRunningRequests = useMemo(() => requests.some((request) => request.state === "running"), [requests])

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
  const pendingRequestIds = useMemo(() => new Set(activeId && requests.some((r) => r.state !== "done" && r.state !== "stopped") ? [activeId] : []), [activeId, requests])
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
    const text = message.trim()
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

  const notifyAttention = useCallback((message: string) => {
    playAttentionSound()
    vibrate([120, 80, 120])
    addToast(message, "info")
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

  const toggleLanguage = useCallback(() => {
    setLang((current) => (current === "ar" ? "en" : "ar"))
  }, [])

  const toggleTheme = () => {
    setTheme((current) => nextTheme(current))
  }

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
      return
    }
    const ticket = ++requestsSeq.current
    const [next, nextPermissions] = await Promise.all([getRequests(id, langRef.current), listPermissions()])
    // رد قديم وصل بعد رد أحدث — اتجاهله عشان الكارتات ماتقفش بترتيب غلط
    if (activeIdRef.current !== id || ticket !== requestsSeq.current) {
      return
    }
    setRequests(next.requests)
    setRequestQuestions(next.questions)
    setRawStatuses((current) => ({ ...current, [id]: next.status }))
    setPermissions(nextPermissions)
  }, [])

  const refreshStatuses = useCallback(async () => {
    try {
      const nextStatuses = await getStatuses()
      setRawStatuses(nextStatuses)
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
    setSessions(sorted)
    if (nextStatuses) {
      setRawStatuses(nextStatuses)
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
      setComposer("")
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
  }, [addToast, refreshRequests, refreshGitChanges, selectedProject, t])

  const enterApp = useCallback(async () => {
    const [nextConfig, projectResponse] = await Promise.all([getConfig(), getProjects()])
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
      .then(() => enterApp())
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
    if (!silent) {
      setModelsLoading(true)
    }
    try {
      const list = await getModels()
      setModels(list)
    } catch (error: unknown) {
      if (!silent) {
        addToast(error instanceof Error ? error.message : t.modelsLoadFailed, "error")
      }
    } finally {
      if (!silent) {
        setModelsLoading(false)
      }
    }
  }, [addToast, t])

  // تحميل قائمة الموديلات (free فقط في العرض) بعد الدخول واختيار المشروع
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

  // كل ما يتضاف طلب جديد: انزل تحت على آخر كارت عشان المستخدم يشوفه فورًا
  // لكن فقط لو المستخدم قريب من الأسفل أصلًا (ما نزعجش لو قارئ رسائل قديمة)
  // أو لو فتح محادثة جديدة — في الحالة دي ننزل لآخرها فورًا
  useEffect(() => {
    const element = workspaceScrollRef.current
    if (!element || requests.length === 0) {
      return
    }
    const { scrollTop, scrollHeight, clientHeight } = element
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
    if (shouldScrollToBottomRef.current) {
      shouldScrollToBottomRef.current = false
      element.scrollTo({ top: scrollHeight, behavior: "smooth" })
    } else if (isNearBottom) {
      element.scrollTo({ top: scrollHeight, behavior: "smooth" })
    }
  }, [requests.length])

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
    // أي حدث واصل = الستريم حي — يحدّث ساعة الصحة للـ fallback والـ safety checks
    lastSseAtRef.current = Date.now()
    if (event.type === "session.status") {
      setRawStatuses((current) => ({ ...current, [event.properties.sessionID]: event.properties.status }))
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
      setRawStatuses((current) => ({ ...current, [event.properties.sessionID]: { type: "idle" } }))
      void refreshActivity()
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshRequests(event.properties.sessionID)
      }
    }
    if (event.type === "todo.updated") {
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshRequests(event.properties.sessionID)
      } else {
        // شغل على جلسة خلفية (غالبًا من اللاب) — حدّث النشطة مدمجًا لا فوريًا
        requestActivityRefresh()
      }
    }
    // النص الحي للرد الجاري: أي جزء جديد من رسالة opencode يحدّث كارت
    // الطلب الشغّال فورًا (بخنق 1.5 ثانية عشان الأحداث بتيجي متتالية بسرعة).
    if (
      event.type === "message.updated"
      || event.type === "message.part.updated"
      || event.type === "message.part.removed"
      || event.type === "message.removed"
      || event.type === "session.diff"
      || event.type === "session.compacted"
    ) {
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
    if (
      (event.type === "question.asked" || event.type === "question.v2.asked")
    ) {
      notifyAttention(t.questionNeedsChoice)
      // سؤال من أي جلسة (حتى اللاب) يحدّث النشطة — مدمجًا (حدث نادر لكن حرج،
      // والكارت نفسه يتحدث فوريًا أدناه فلا يضيع التنبيه)
      requestActivityRefresh()
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshRequests(event.properties.sessionID)
      }
    } else if (
      (event.type === "question.replied" || event.type === "question.rejected" || event.type === "question.v2.replied" || event.type === "question.v2.rejected")
      && event.properties.sessionID === activeIdRef.current
    ) {
      void refreshRequests(event.properties.sessionID)
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

  useEffect(() => {
    if (authState !== "signedIn") {
      return
    }
    const source = new EventSource("/api/events", { withCredentials: true })
    // EventSource يعيد الاتصال تلقائيًا بفاصل متزايد داخليًا؛ هنا نضيف:
    // (1) تتبّع حالة الاتصال لإيقاف الـ polls الدورية أثناء الاتصال الحي،
    // (2) resync متدرج (stagger) يتخطى الموارد الطازجة بدل العاصفة الكاملة.
    const resyncTimers: number[] = []
    source.addEventListener("ready", () => {
      setEventConnected(true)
      sseLiveRef.current = true
      lastSseAtRef.current = Date.now()
      // First connection: the mount effects already fetch. Any later one means the
      // stream dropped (screen lock, network change) and every event in that window
      // is gone, so re-sync now instead of waiting for the next poll tick.
      if (!eventsConnectedOnce.current) {
        eventsConnectedOnce.current = true
        return
      }
      if (!isFresh("status")) {
        void refreshStatuses()
      }
      const id = activeIdRef.current
      if (id) {
        resyncTimers.push(window.setTimeout(() => void refreshRequests(id).catch(() => undefined), 300))
      }
      if (!isFresh("activity")) {
        resyncTimers.push(window.setTimeout(() => void refreshActivity(), 700))
      }
    })
    source.addEventListener("opencode", (rawEvent) => {
      try {
        handleOpenCodeEvent(JSON.parse((rawEvent as MessageEvent<string>).data) as ClientEvent)
      } catch {
        addToast(t.unknownEvent, "error")
      }
    })
    // تغيير في المثبّتات (جهاز تاني أو نافذة تانية): نحوّله لحدث داخلي
    // يسمعه hook المثبّتات — نفس اتصال SSE واحد لكل نافذة، مش اتصال تاني.
    source.addEventListener("pins", (rawEvent) => {
      try {
        const payload = JSON.parse((rawEvent as MessageEvent<string>).data) as { pins?: PinnedConversation[] }
        window.dispatchEvent(new CustomEvent(PINS_SYNC_EVENT, { detail: { pins: payload.pins } }))
      } catch {
        // رد مش مفهوم — الـ resync والـ poll بيجيبوا الصورة الصح
      }
    })
    source.onerror = () => {
      setEventConnected(false)
      sseLiveRef.current = false
    }
    return () => {
      for (const timer of resyncTimers) {
        window.clearTimeout(timer)
      }
      source.close()
      sseLiveRef.current = false
      setEventConnected(false)
    }
  }, [authState, addToast, handleOpenCodeEvent, refreshActivity, refreshRequests, refreshStatuses, isFresh, t])

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
    setGitChanges(null)
    setAccessToken("")
  }

  const handleNewSession = async () => {
    if (!selectedProject) {
      return
    }
    // لو واقف على مسودة فاضية أصلًا: فقط نضف الكتابة
    if (!activeId) {
      setEditingSessionId(null)
      setTitleDraft("")
      setRequests([])
      setRequestQuestions([])
      setComposer("")
      setShowSessions(false)
      return
    }
    // لو الجلسة الحالية فاضية ومفيهاش أي رسالة: امسحها الأول عشان متتراكمش
    const currentId = activeId
    const currentWasEmpty = isRequestsEmpty(requests)
    if (currentWasEmpty) {
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
    // مسودة جديدة بدون حفظ على السيرفر — الحفظ يحصل مع أول رسالة فقط
    setActiveId(null)
    activeIdRef.current = null
    setEditingSessionId(null)
    setTitleDraft("")
    setRequests([])
    setRequestQuestions([])
    setComposer("")
    setShowSessions(false)
  }

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
    shouldScrollToBottomRef.current = true
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

  const startRenamingSession = () => {
    if (!activeSession) {
      return
    }
    setTitleDraft(displayTitle(activeSession.title, t))
    setEditingSessionId(activeSession.id)
  }

  const cancelRenamingSession = () => {
    if (renamingTitle) {
      return
    }
    setEditingSessionId(null)
    setTitleDraft("")
  }

  const handleRenameSession = async (event: FormEvent<HTMLFormElement>) => {
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
  }

  const handleSessionTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      cancelRenamingSession()
    }
  }

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
          setComposer("")
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
  // والمخزّن على سيرفر واحد عشان كل الأجهزة والتطبيقات التانية تشوفها فورًا.
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

  // إرسال نص كطلب — المشترك بين زرار الإرسال وزرار commit و push
  const sendPrompt = useCallback(async (rawText: string) => {
    const text = rawText.trim()
    if (!text || sendingRef.current) {
      return
    }
    sendingRef.current = true
    setSending(true)
    setComposer("")
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
            await setSessionModel(sessionId, modelForNewSession)
            setCurrentModel(modelForNewSession)
          } catch {
            // لو التثبيت فشل هنبعته مع أول رسالة كـ override
          }
        }
      }
      const now = Date.now()
      setRequests((current) => [...current, {
        id: optimisticId,
        index: current.length + 1,
        prompt: text,
        state: "queued",
        activity: getStrings(langRef.current).taskQueued,
        finalResult: "",
        liveText: "",
        stepsCompleted: 0,
        activeTool: null,
        todos: [],
        completedTodos: 0,
        totalTodos: 0,
        resultFiles: [],
        startedAt: now,
        completedAt: 0,
        updatedAt: now,
      }])
      await sendMessage(sessionId, text, undefined, isNewSession && modelForNewSession ? modelForNewSession : undefined)
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
      // رجّع النص بس لو المستخدم لسه ميكتبش حاجة جديدة
      setComposer((current) => current || text)
      addToast(error instanceof Error ? error.message : getStrings(langRef.current).messageSendFailed, "error")
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [pendingModel, projectDefaultModel, currentModel, defaultModel, refreshRequests, refreshSessions, setSettledStatus, addToast])

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault()
    await sendPrompt(composer)
  }

  // طلبات الـ git كلها جوّه hook واحد عشان الـ drawer والـ guard وحالة التأكيد
  // يفضلوا في مكان واحد بدل ما App يوزّعهم
  const gitRequests = useGitRequests(gitChanges, sending, langRef.current, sendPrompt)

  const openGitChanges = useCallback(() => {
    gitRequests.show()
    void refreshGitChanges()
  }, [gitRequests, refreshGitChanges])

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter يبعت على الديسكتوب بس. على الموبايل سيبه يسلك سطر جديد عادي.
    // isComposing: لو المستخدم بيكمّل كلمة بلغة تانية (إixes عربي/إنجليزي)
    // Enter بيسجّل الكلمة مش يبعت الطلب.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !isTouchComposer()) {
      event.preventDefault()
      void handleSend()
    }
  }

  // البوكس بيكبر مع كل سطر جديد لحد 6 سطور بس، وبعدها بيفتح 스크ول جوه
  useLayoutEffect(() => {
    const element = composerRef.current
    if (!element) {
      return
    }
    element.style.height = "auto"
    const styles = window.getComputedStyle(element)
    const lineHeight = Number.parseFloat(styles.lineHeight) || Number.parseFloat(styles.fontSize) * 1.5 || 22
    const maxHeight = Math.round(lineHeight * COMPOSER_MAX_LINES)
    const contentHeight = element.scrollHeight
    element.style.height = `${Math.min(contentHeight, maxHeight)}px`
    element.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden"
  }, [composer])

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

  const handleSkip = async (request: SessionRequest) => {
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
  }

  const handleRunNow = async (request: SessionRequest) => {
    if (!activeId || queueAction) {
      return
    }
    const id = activeId
    setQueueAction(request.id)
    try {
      const result = await runQueuedRequest(id, request.id)
      if (!result.started) {
        addToast(t.queuedRunFailed, "error")
      } else {
        // اشتغل وشايفه بعينك بيجري — من غير toast
        // الطلب اللي كان شغّال اتوقّف، فنمنع صوت الإتمام بتاعه
        abortedRef.current.add(id)
      }
      await refreshRequests(id).catch(() => undefined)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.queuedRunFailed, "error")
      await refreshRequests(id).catch(() => undefined)
    } finally {
      setQueueAction(null)
    }
  }

  const handleRemoveQueued = async (request: SessionRequest) => {
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
  }

  const handlePermission = async (permission: Permission, response: "once" | "always" | "reject") => {
    try {
      await replyPermission(permission.sessionID, permission.id, response)
      setPermissions((current) => current.filter((item) => item.id !== permission.id))
      // الرد شايفه بعينك (الكارت اختفى) — من غير toast
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.permissionReplyFailed, "error")
    }
  }

  const displayedModel: SessionModelRef | null = activeId ? currentModel : (pendingModel || projectDefaultModel || currentModel || defaultModel)

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
      const result = await setSessionModel(sessionId, ref)
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

  const copyText = (text: string) => {
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
  }

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

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
    if (next) {
      unlockAudio()
      playCompletionSound()
      // سامع الصوت وشايف الزرار — من غير toast
    }
    // القفل شايفه بعينك في الزرار — من غير toast
  }

  const testSound = () => {
    unlockAudio()
    playCompletionSound()
    vibrate([180, 100, 180, 100, 320])
  }

  // صف المحادثة في القائمة الجانبية — نفس الشكل بالظبط في المجموعتين
  // (نشطة / غير نشطة) عشان التثبيت والحذف يفضلوا بنفس السلوك في كل مكان
  const renderSessionItem = (session: Session, working: boolean) => {
    const pinned = isPinned(session.id)
    const selected = session.id === activeId
    const needsPermission = permissions.some((permission) => permission.sessionID === session.id)
    const pinLabel = pinned ? t.unpinConversation : t.pinConversation
    return (
      <div
        ref={selected ? activeSessionItemRef : undefined}
        className={`session-item${working ? " is-working" : ""}${pinned ? " is-pinned" : ""}${selected ? " active" : ""}${needsPermission ? " needs-permission" : ""}`}
        key={session.id}
      >
        <button className="session-select" onClick={() => void selectSession(session.id)} aria-current={selected ? "true" : undefined}>
          <span className="session-title-row">
            <span className="session-title">{displayTitle(session.title, t)}</span>
            {needsPermission ? <span className="permission-badge">{t.needsPermission}</span> : null}
          </span>
          <span className="session-meta">
            {working ? <span className="working-spinner" aria-hidden /> : <span className="status-dot" aria-hidden />}
            <span className="session-status">{statusLabel(statuses[session.id], t)}</span>
            <span className="session-meta-dot" aria-hidden />
            <span className="session-time" title={formatDateTime(session.time.created, lang)}>{formatRelative(session.time.created, lang)}</span>
          </span>
        </button>
        <button
          className={`session-pin${pinned ? " is-on" : ""}`}
          onClick={(event) => { event.stopPropagation(); handlePinSession(session) }}
          aria-pressed={pinned}
          aria-label={pinLabel}
          title={pinLabel}
        >
          <span className={pinned ? "pin-on" : "pin-off"} aria-hidden>📌</span>
        </button>
        <button className="session-delete" onClick={() => void handleDeleteSession(session)} aria-label={t.deleteSession}>⌫</button>
      </div>
    )
  }

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
        onSelect={(project) => void openProject(project)}
        t={t}
        lang={lang}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showSessions ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand"><span className="brand-mark small"><img src="/icon.svg" alt="RemoteCode" /></span><span>RemoteCode</span></div>
          <button className="icon-button mobile-only" onClick={() => setShowSessions(false)} aria-label={t.closeMenu}>×</button>
        </div>
        <div className="connection-state" role="status">
          <span className={`status-dot ${eventConnected ? "online" : "offline"}`} />
          <span className="connection-label">{eventConnected ? t.connectedLive : t.reconnecting}</span>
        </div>
        <ProjectDropdown
          variant="sidebar"
          projects={projects}
          selectedId={selectedProject?.worktree}
          switchingKey={switchingProject}
          recentPaths={recentProjects}
          onSelect={(project) => void openProject(project)}
          t={t}
          lang={lang}
        />
        <button className="new-session" onClick={() => void handleNewSession()}><span>＋</span> {t.newConversation}</button>
        <div className="session-list">
          {sessions.length === 0 ? (
            <div className="empty-state">{t.noSessionsYet}</div>
          ) : (
            <>
              {sidebarActiveSessions.length > 0 ? (
                <section className="session-group" aria-label={t.activeConversations}>
                  <div className="session-group-header">
                    <span className="session-group-title"><span aria-hidden>⚡</span> {t.active}</span>
                    <span className="session-group-count" aria-label={`${sidebarActiveSessions.length} ${sidebarActiveSessions.length === 1 ? t.conversation : t.conversations}`}>{sidebarActiveSessions.length}</span>
                  </div>
                  {sidebarActiveSessions.map((session) => renderSessionItem(session, true))}
                </section>
              ) : null}
              <section className="session-group" aria-label={t.inactiveConversations}>
                <div className="session-group-header">
                  <span className="session-group-title"><span aria-hidden>💤</span> {t.inactive}</span>
                  <span className="session-group-count" aria-label={`${sidebarInactiveSessions.length} ${sidebarInactiveSessions.length === 1 ? t.conversation : t.conversations}`}>{sidebarInactiveSessions.length}</span>
                </div>
                {sidebarInactiveSessions.length === 0 ? (
                  <div className="session-group-empty">{t.noInactiveConversations}</div>
                ) : (
                  sidebarInactiveSessions.map((session) => renderSessionItem(session, false))
                )}
              </section>
            </>
          )}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="current-session">
            <div className="session-head">
              <div className="topbar-project-row">
                <div className="project-name-badge" title={selectedProject ? projectName(selectedProject) : undefined}>
                  <span aria-hidden>📁</span>
                  <span className="compact-trigger-name">{switchingProject ? t.opening : selectedProject ? projectName(selectedProject) : "—"}</span>
                </div>
                <button className="new-chat-top" type="button" onClick={() => void handleNewSession()} disabled={!selectedProject} title={t.newConversation} aria-label={t.newConversation}>
                  <span aria-hidden>＋</span>
                  <span className="new-chat-top-label">{t.newConversation}</span>
                </button>
                <div className="model-bar">
                  <button className="model-pill" onClick={() => setShowModels(true)} title={t.modelInUse}>
                    <span className="model-pill-id">
                      <span aria-hidden>🤖</span>
                      <span className="model-pill-name" dir="ltr">
                        {displayedModel ? (() => {
                          const model = models.find((m) => m.providerID === displayedModel.providerID && m.id === displayedModel.modelID);
                          return model ? shortModelName(model) : displayedModel.modelID;
                        })() : t.defaultModel}
                      </span>
                    </span>
                    {displayedModel?.variant && (
                      <span className="model-pill-variant">
                        <span className="model-pill-variant-value" dir="ltr">{displayedModel.variant}</span>
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="topbar-rail">
            <button className="icon-button mobile-only" onClick={() => setShowSessions(true)} aria-label={t.openSessions}>☰</button>
            <span className="topbar-rail-divider mobile-only" aria-hidden />
            <div className="topbar-actions">
              <button className="icon-button activity-button icon-activity" onClick={() => setShowActivity(true)} aria-label={t.activeFromAllProjects} title={`${t.activeFromAllProjects} ⚡`}>⚡{activeSessions.length > 0 ? <span className="count-badge">{activeSessions.length}</span> : null}</button>
              {/* ترتيب الأزرار مقصود: زر الـ git جنب زر "النشطة" عشان متابعة الملفات
                  والرجوع لأقوى محادثة شغّالة يبقوا في نفس السطر من الذهن، والمثبّتة
                  تاني وراهم عشان الشريط يفضل مقسوم: حالة ← ملفات ← مرجع. */}
              <button className="icon-button activity-button git-button icon-git" onClick={openGitChanges} aria-label={t.gitChangesAria} title={`${t.gitChangesAria} ⑂`}><GitBranchIcon />{gitChangedCount > 0 ? <span className="count-badge">{gitChangedCount}</span> : null}</button>
              <button
                className="icon-button icon-pinned"
                onClick={() => setShowPinned(true)}
                aria-label={t.pinnedConversations}
                title={`${t.pinnedConversations} — ${selectedProject ? projectName(selectedProject) : t.unknownProject} 📌`}
              >
                <span aria-hidden>📌</span>
                {projectPins.length > 0 ? <span className="count-badge">{projectPins.length}</span> : null}
              </button>
              <button className="icon-button icon-history" onClick={() => setShowHistory(true)} aria-label={t.historyAria} title={`${t.historyAria} 🕘`}>🕘</button>
              <span className="topbar-rail-divider" aria-hidden />
              <button className="icon-button icon-theme" onClick={toggleTheme} aria-label={`${t.themeNext}: ${themeLabel(nextTheme(theme), t)}`} title={`${t.themeNext}: ${themeLabel(nextTheme(theme), t)}`}><span aria-hidden>{THEME_META[theme].icon}</span></button>
              <button className="icon-button lang-button icon-lang" onClick={toggleLanguage} aria-label={t.language} title={t.language}><span className="lang-globe" aria-hidden>🌐</span><span className={`lang-code${lang === "ar" ? "" : " lang-ar"}`}>{lang === "ar" ? "EN" : "ع"}</span></button>
              <button
                className={`icon-button ${soundOn ? "icon-sound" : "icon-muted"}`}
                onClick={toggleSound}
                aria-pressed={soundOn}
                aria-label={soundOn ? t.mute : t.unmute}
                title={soundOn ? t.mute : t.unmute}
              >
                {soundOn ? <SoundOnIcon /> : <SoundMuteIcon />}
              </button>
              <span className="topbar-rail-divider" aria-hidden />
              <button className="icon-button icon-settings" onClick={() => setShowSettings(true)} aria-label={t.settingsAria} title={t.settingsAria}><SettingsIcon /></button>
              <button className="icon-button icon-logout" onClick={() => void handleLogout()} aria-label={t.logout} title={t.logout}><LogoutIcon /></button>
            </div>
          </div>
        </header>

        <div className="workspace">
          <div className="workspace-scroll" ref={workspaceScrollRef}>
            {requests.length > 0 ? (
              <div className="request-stack">
                <RequestCard requests={requests} sessionId={activeId} title={activeTitle} canRenameTitle={activeSession !== undefined} isEditingTitle={editingSessionId !== null && editingSessionId === activeId} titleDraft={titleDraft} renamingTitle={renamingTitle} onStartRename={startRenamingSession} onCancelRename={cancelRenamingSession} onTitleDraftChange={setTitleDraft} onRenameSubmit={handleRenameSession} onTitleKeyDown={handleSessionTitleKeyDown} onCopy={copyText} onToast={addToast} onSkip={(request) => void handleSkip(request)} onRunNow={(request) => void handleRunNow(request)} onRemove={(request) => void handleRemoveQueued(request)} busyAction={queueAction} t={t} lang={lang} />
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
            {activeId ? requestQuestions.filter((question) => question.sessionID === activeId).map((question) => (
              <QuestionCard key={question.id} request={question} sessionId={activeId} onAnswered={() => void refreshRequests(activeId).catch(() => undefined)} t={t} />
            )) : null}
          </div>

          {permissions.filter((permission) => permission.sessionID === activeId).length > 0 ? (
            <div className="permissions-stack">
              {permissions.filter((permission) => permission.sessionID === activeId).map((permission) => <PermissionCard key={permission.id} permission={permission} onReply={(response) => void handlePermission(permission, response)} t={t} />)}
            </div>
          ) : null}

          <div className="composer-wrap">
            <form className="composer" onSubmit={handleSend}>
              <textarea ref={composerRef} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={t.composerPlaceholder} rows={1} />
              <div className="composer-actions">
                <span className="composer-hint">{t.composerHint}</span>
                {isBusy || hasQueuedRequests ? <button type="button" className="stop-button" onClick={() => void handleAbort()}>■ {t.stop}</button> : null}
                <button
                  className={`send-button${composer.trim() ? " is-ready" : ""}${sending ? " is-sending" : ""}`}
                  disabled={!composer.trim() || sending}
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
            </form>
          </div>
        </div>
      </main>

      {showActivity ? (
        <Suspense fallback={<PanelFallback />}>
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
        </Suspense>
      ) : null}
      {gitRequests.isOpen ? (
        <Suspense fallback={<PanelFallback />}>
          <GitChangesPanel
            changes={gitChanges}
            loading={gitLoading}
            busy={sending}
            confirming={gitRequests.confirming}
            confirmingCommit={gitRequests.confirmingCommit}
            confirmingPush={gitRequests.confirmingPush}
            confirmingPull={gitRequests.confirmingPull}
            onRefresh={() => void refreshGitChanges()}
            onCommit={() => void gitRequests.commit()}
            onAskCommit={gitRequests.askCommit}
            onCancelCommit={gitRequests.cancelCommit}
            onPush={() => void gitRequests.push()}
            onAskPush={gitRequests.askPush}
            onCancelPush={gitRequests.cancelPush}
            onPull={() => void gitRequests.pull()}
            onAskPull={gitRequests.askPull}
            onCancelPull={gitRequests.cancelPull}
            onAskRevertAll={gitRequests.askRevertAll}
            onRevertAll={() => void gitRequests.revertAll()}
            onCancelRevertAll={gitRequests.cancelRevertAll}
            onRevertFile={(file) => void gitRequests.revertFile(file)}
            onClose={gitRequests.close}
            t={t}
          />
        </Suspense>
      ) : null}
      {showHistory ? (
        <Suspense fallback={<PanelFallback />}>
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
        </Suspense>
      ) : null}
      {showPinned ? (
        <Suspense fallback={<PanelFallback />}>
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
        </Suspense>
      ) : null}
      {showModels ? (
        <Suspense fallback={<PanelFallback />}>
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
        </Suspense>
      ) : null}
      {showSettings ? (
        <div className="drawer-backdrop" onClick={() => setShowSettings(false)}>
          <aside className="drawer settings-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><div className="eyebrow">{t.settings}</div><h2>{t.settingsDetails}</h2></div><button className="icon-button" onClick={() => setShowSettings(false)} aria-label={t.close}>×</button></div>
            <div className="settings-list">
              <div className="setting-row"><div><strong>{t.project}</strong><small>📁 {projectName(selectedProject)} · {t.projectSwitchHint}</small></div><button className="button button-secondary" onClick={() => setShowSettings(false)}>{t.ok} ✓</button></div>
              <div className="setting-row"><div><strong>{t.opencode}</strong><small>{config.openCode.version === "connected" ? t.connected : config.openCode.version}</small></div><span className="status-pill success">{t.connected}</span></div>
              <div className="setting-row"><div><strong>{t.statusStream}</strong><small>{eventConnected ? t.realtimeWorking : t.offline}</small></div><span className={`status-pill ${eventConnected ? "success" : "warning"}`}>{eventConnected ? t.active : t.inactive}</span></div>
              <div className="setting-row"><div><strong>{t.phoneNotifications}</strong><small>{config.secureContext ? t.pushViaHttps : t.pushNeedsHttps}</small></div>{pushState === "enabled" ? <button className="button button-ghost" onClick={() => void disablePush()}>{t.disable}</button> : <button className="button button-secondary" onClick={() => void enablePush()}>{t.enable}</button>}</div>
              <div className="setting-row setting-row-theme"><div><strong>🌓 {t.appearance}</strong><small>{themeDescription(theme, t)}</small></div><div className="theme-picker" role="radiogroup" aria-label={t.appearance}>{THEMES.map((value) => <button key={value} type="button" role="radio" aria-checked={theme === value} className={`theme-option${theme === value ? " active" : ""}`} onClick={() => setTheme(value)}><span className="theme-option-icon" aria-hidden>{THEME_META[value].icon}</span><span>{themeLabel(value, t)}</span></button>)}</div></div>
              <div className="setting-row"><div><strong>🌐 {t.language}</strong><small>{t.languageName}</small></div><div className="theme-picker" role="radiogroup" aria-label={t.language}><button type="button" role="radio" aria-checked={lang === "ar"} className={`theme-option${lang === "ar" ? " active" : ""}`} onClick={() => setLang("ar")}><span>ع</span><span>العربية</span></button><button type="button" role="radio" aria-checked={lang === "en"} className={`theme-option${lang === "en" ? " active" : ""}`} onClick={() => setLang("en")}><span>EN</span><span>English</span></button></div></div>
              <div className="setting-row"><div><strong>🔔 {t.taskDoneSound}</strong><small>{soundOn ? t.soundOnDesc : t.soundOffDesc}</small></div><div style={{ display: "flex", gap: 6 }}><button className="button button-secondary" onClick={testSound}>{t.tryIt} 🔊</button><button className={`button ${soundOn ? "button-ghost" : "button-primary"}`} onClick={toggleSound}>{soundOn ? t.mute : t.enable}</button></div></div>
              {installPrompt ? <button className="button button-secondary button-wide" onClick={() => void installApp()}>{t.installApp}</button> : null}
              {pushState === "unsupported" ? <div className="info-box">{t.pushUnsupported}</div> : null}
              {pushState === "blocked" ? <div className="info-box">{t.pushBlocked}</div> : null}
              {!config.secureContext ? <div className="warning-box">{t.pushNeedsSecure}</div> : null}
            </div>
          </aside>
        </div>
      ) : null}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div className={`toast toast-${toast.kind}`} key={toast.id}>{toast.message}<button onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button></div>)}
      </div>
    </div>
  )
}

export default App
