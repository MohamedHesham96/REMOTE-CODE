import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import {
  ApiError,
  abortSession,
  base64ToUint8Array,
  createSession,
  deleteSession,
  downloadResultFile,
  fileDownloadUrl,
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
  replyQuestion,
  rejectQuestion,
  runQueuedRequest,
  selectProject,
  sendMessage,
  setSessionModel,
  shareResultFile,
  skipRunningRequest,
  subscribePush,
  unsubscribePush,
} from "./api"
import type { ActiveSession, AppConfig, ClientEvent, ConversationQuestionAnswers, ConversationQuestionRequest, GitChanges, HistoryTurn, ModelInfo, Permission, Project, RequestState, ResultFile, Session, SessionModelRef, SessionRequest, SessionStatus, Todo } from "./types"
import { isSoundEnabled, playAttentionSound, playCompletionSound, setSoundEnabled, unlockAudio, vibrate } from "./sound"
import { applyTheme, getSavedTheme, nextTheme, saveTheme, THEMES, THEME_META, type AppTheme } from "./theme"
import { applyLanguage, getSavedLanguage, getStrings, localeOf, saveLanguage, type Language, type Strings } from "./i18n"
import {
  displayTitle,
  formatDate,
  formatTime,
  getVarietyLevels,
  GitBranchIcon,
  modelLabel,
  projectName,
  samePath,
  statusLabel,
  variantLabel,
  VARIANT_ORDER,
} from "./display"

// أدراج ثقيلة تُحمّل عند الطلب فقط (code-splitting): القائمة الرئيسية
// والشات يظهران فورًا، وهذه اللوحات تنزل عند أول فتح لها
const ModelPicker = lazy(() => import("./panels").then((module) => ({ default: module.ModelPicker })))
const ActiveSessionsPanel = lazy(() => import("./panels").then((module) => ({ default: module.ActiveSessionsPanel })))
const GitChangesPanel = lazy(() => import("./panels").then((module) => ({ default: module.GitChangesPanel })))
const HistoryPanel = lazy(() => import("./panels").then((module) => ({ default: module.HistoryPanel })))

function PanelFallback() {
  return <div className="picker-loading"><span className="loader" /></div>
}

type AuthState = "loading" | "signedOut" | "signedIn"
type ToastKind = "info" | "success" | "error"

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface InstallPrompt {
  preventDefault: () => void
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const emptyConfig: AppConfig = {
  openCode: { healthy: false, version: "" },
  push: { enabled: false, publicKey: null },
  secureContext: false,
}

function themeLabel(value: AppTheme, t: Strings): string {
  if (value === "glass") {
    return t.themeLight
  }
  if (value === "hacker") {
    return t.themeHacker
  }
  return t.themeDark
}

function themeDescription(value: AppTheme, t: Strings): string {
  if (value === "glass") {
    return t.themeLightDesc
  }
  if (value === "hacker") {
    return t.themeHackerDesc
  }
  return t.themeDarkDesc
}

// الحالة الخام مش موثوقة لحظيًا: الـ SSE والـ poll بيقولوا حاجات مختلفة
// لأجزاء من الثانية، وكمان OpenCode نفسه بيعدّي بلحظات idle وسيطة بين
// خطوات المهمة الواحدة (بين أداة والتانية). من غير مهلة، عنوان
// "شغّال ⇄ جاهز" (وكمان صوت الإتمام) كان بيتكرّر كل بضع ثواني.
// القاعدة: الدخول في "شغّال" فوري (عشان المستخدم يشوفها لحظيًا)،
// أما الخروج لـ "جاهز" فلازم يفضل ثابت المدة دي قبل ما يتطبّق —
// الفجوات الوسيطة بين الخطوات أقصر منها فمش هتخطف الشاشة.
// أما التحديثات المحلية (إرسال جديد) فدي مش عيّنة، وبتتطبّق فورًا.
const STATUS_TO_IDLE_MS = 8000
const STATUS_TO_BUSY_MS = 0

function statusKind(status: SessionStatus | undefined): string {
  return status?.type ?? "idle"
}

function isBusyKind(kind: string): boolean {
  return kind === "busy" || kind === "retry"
}

function useSettledStatuses(
  raw: Record<string, SessionStatus>,
  toIdleMs: number = STATUS_TO_IDLE_MS,
  toBusyMs: number = STATUS_TO_BUSY_MS,
): [Record<string, SessionStatus>, (id: string, status: SessionStatus) => void] {
  const [settled, setSettled] = useState<Record<string, SessionStatus>>(raw)
  const settledRef = useRef(settled)
  const rawRef = useRef(raw)
  // مؤقتات عند الطلب فقط: لا توجد حلقة tick دائمة. المؤقت يُزرع فقط عندما
  // يكون هناك انتقال "لجاهز" معلّق، ويُلغى لو تغيّرت العيّنة قبل انتهائه.
  const timersRef = useRef(new Map<string, number>())

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  useEffect(() => {
    // أحدث عيّنة معروفة للمؤقتات المعلّقة — تُقرأ عند انتهاء المؤقت لا عند زرعه
    rawRef.current = raw
    const current = settledRef.current
    const next: Record<string, SessionStatus> = { ...current }
    let changed = false
    for (const id of new Set([...Object.keys(current), ...Object.keys(raw)])) {
      const incoming = raw[id]
      const kind = statusKind(incoming)
      // جلسة جديدة: اعرضها زي ما هي من غير مهلة
      if (incoming && current[id] === undefined) {
        next[id] = incoming
        clearTimer(id)
        changed = true
        continue
      }
      if (current[id]?.type === kind) {
        clearTimer(id)
        continue
      }
      // اتجاه التحوّل هو اللي يحدد المهلة: لشغّال فوري، لجاهز بعد ثبات
      const settleMs = isBusyKind(kind) ? toBusyMs : toIdleMs
      if (settleMs <= 0) {
        clearTimer(id)
        if (incoming) {
          next[id] = incoming
        } else {
          delete next[id]
        }
        changed = true
        continue
      }
      // انتقال مؤجّل: ازرع مؤقتًا واحدًا فقط، وعند انتهائه طبّق آخر عيّنة
      // معروفة (rawRef) بدل العيّنة القديمة — فلا يطبّق حالة منتهية الصلاحية
      if (!timersRef.current.has(id)) {
        timersRef.current.set(id, window.setTimeout(() => {
          timersRef.current.delete(id)
          const latest = rawRef.current[id]
          const latestKind = statusKind(latest)
          const settledNow = settledRef.current
          if (settledNow[id]?.type === latestKind) {
            return
          }
          const applied = { ...settledNow }
          if (latest) {
            applied[id] = latest
          } else {
            delete applied[id]
          }
          settledRef.current = applied
          setSettled(applied)
        }, settleMs))
      }
    }
    if (changed) {
      settledRef.current = next
      setSettled(next)
    }
  }, [raw, toIdleMs, toBusyMs, clearTimer])

  // إلغاء كل المؤقتات عند الفك — منع تسريب واستیقاظ بعد unmount
  useEffect(() => () => {
    for (const timer of timersRef.current.values()) {
      window.clearTimeout(timer)
    }
    timersRef.current.clear()
  }, [])

  // تحديث محلي مؤكد (Optimistic) — مش عيّنة، يتطبّق على طول
  const setStatus = useCallback((id: string, status: SessionStatus) => {
    clearTimer(id)
    const next = { ...settledRef.current, [id]: status }
    settledRef.current = next
    setSettled(next)
  }, [clearTimer])

  return [settled, setStatus]
}

function sessionMatches(sessions: Session[], id: string | null): Session | undefined {
  return id ? sessions.find((session) => session.id === id) : undefined
}

function isRequestsEmpty(candidate: SessionRequest[] | null): boolean {
  return !candidate || candidate.length === 0
}

function PermissionCard({ permission, onReply, t }: { permission: Permission; onReply: (value: "once" | "always" | "reject") => void; t: Strings }) {
  const [working, setWorking] = useState(false)
  const reply = async (value: "once" | "always" | "reject") => {
    setWorking(true)
    try {
      await onReply(value)
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="permission-card">
      <div className="permission-icon">!</div>
      <div className="permission-content">
        <strong>{t.permissionRequest}</strong>
        <p>{permission.title}</p>
        {permission.pattern ? <code>{Array.isArray(permission.pattern) ? permission.pattern.join("، ") : permission.pattern}</code> : null}
        <div className="permission-actions">
          <button className="button button-primary" disabled={working} onClick={() => void reply("once")}>{t.allowOnce}</button>
          <button className="button button-secondary" disabled={working} onClick={() => void reply("always")}>{t.allowAlways}</button>
          <button className="button button-ghost" disabled={working} onClick={() => void reply("reject")}>{t.reject}</button>
        </div>
      </div>
    </div>
  )
}

const RECENT_PROJECTS_KEY = "opencode.recentProjects"
// آخر محادثة فتحناها لكل مشروع — بنرجعلها بعد الـ refresh بدل أول محادثة في القائمة
const LAST_SESSION_KEY = "opencode.lastSessionByProject"

// ترتيب المحادثات: الأحدث إنشاءً فوق. بنقارن وقت الإنشاء مش وقت آخر تعديل،
// عشان مجرد فتح محادثة قديمة ما يرفعهاش فوق المحادثات اللي اتعملت بعده.
function sortSessionsByCreated(list: Session[]): Session[] {
  return [...list].sort((a, b) => (b.time.created - a.time.created) || (b.time.updated - a.time.updated))
}

function loadLastSessions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const result: Record<string, string> = {}
    for (const [worktree, sessionId] of Object.entries(parsed)) {
      if (typeof sessionId === "string" && sessionId) {
        result[normalizeProjectPath(worktree)] = sessionId
      }
    }
    return result
  } catch {
    return {}
  }
}

function saveLastSession(worktree: string, sessionId: string): void {
  const key = normalizeProjectPath(worktree)
  try {
    const all = loadLastSessions()
    if (all[key] === sessionId) {
      return
    }
    all[key] = sessionId
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(all))
  } catch {
    // تجاهل — التخزين اختياري
  }
}

function forgetLastSession(worktree: string): void {
  const key = normalizeProjectPath(worktree)
  try {
    const all = loadLastSessions()
    if (all[key] === undefined) {
      return
    }
    delete all[key]
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(all))
  } catch {
    // تجاهل — التخزين اختياري
  }
}

// مهلة النشاط: بعد ما المحادثة تخلص شغل بتفضل في "المحادثات النشطة" ٥ دقايق
// وبعدين لوحدها بتنتقل لـ "غير النشطة" (من غير ما تحتاج تعمل refresh).
const ACTIVE_GRACE_MS = 5 * 60 * 1000

// أقصى عدد سطور لصندوق كتابة الرسالة — بيقف عنده ولا يكبر تاني (بيعمل scroll جوه)
const COMPOSER_MAX_LINES = 6

// نفس استعلام الـ media المستخدَم في styles.css للّمس، عشان سلوك Enter
// يطابق نفس تعريف "جهاز لمس" اللي الأزرار بتبني عليه
const TOUCH_QUERY = "(hover: none), (pointer: coarse)"

// Enter يبعت بس على الأجهزة اللي فيها لوحة مفاتيح فعلية؛ على الموبايل
// (والكيبورد على الشاشة) Enter ياخد سطر جديد والإرسال بزر الإرسال
function isTouchComposer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia(TOUCH_QUERY).matches
}

function loadRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function normalizeProjectPath(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
}

function useSortedProjects(projects: Project[], query: string, selectedId: string | undefined, recentPaths: string[], lang: Language): Project[] {
  const recentOrder = useMemo(() => {
    const order = new Map<string, number>()
    recentPaths.forEach((path, index) => order.set(normalizeProjectPath(path), index))
    return order
  }, [recentPaths])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? projects.filter((project) => `${projectName(project)} ${project.worktree}`.toLowerCase().includes(q))
      : [...projects]
    return filtered.sort((a, b) => {
      const aCurrent = samePath(a.worktree, selectedId) ? 0 : 1
      const bCurrent = samePath(b.worktree, selectedId) ? 0 : 1
      if (aCurrent !== bCurrent) {
        return aCurrent - bCurrent
      }
      const aRecent = recentOrder.get(normalizeProjectPath(a.worktree)) ?? 999
      const bRecent = recentOrder.get(normalizeProjectPath(b.worktree)) ?? 999
      if (aRecent !== bRecent) {
        return aRecent - bRecent
      }
      return projectName(a).localeCompare(projectName(b), localeOf(lang))
    })
  }, [projects, query, selectedId, recentOrder, lang])

  return sorted
}

function ProjectOptionRows({ items, selectedId, switchingKey, onSelect, t }: {
  items: Project[]
  selectedId?: string
  switchingKey: string | null
  onSelect: (project: Project) => void
  t: Strings
}) {
  return (
    <div className="project-listbox" role="listbox" aria-label={t.projects}>
      {items.map((project) => {
        const key = `${project.id}:${project.worktree}`
        const isCurrent = samePath(project.worktree, selectedId)
        const isSwitching = switchingKey === project.worktree
        return (
          <button
            role="option"
            aria-selected={isCurrent}
            className={`project-option${isCurrent ? " selected" : ""}`}
            key={key}
            disabled={switchingKey !== null}
            onClick={() => onSelect(project)}
          >
            <span className="project-option-icon" aria-hidden>{isCurrent ? "✓" : "📁"}</span>
            <span className="project-option-body">
              <strong>{projectName(project)}</strong>
              <small dir="ltr">{project.worktree}</small>
            </span>
            <span className="project-option-badges">
              {isCurrent ? <span className="current-badge">{t.current}</span> : null}
              {isSwitching ? <span className="loader small" /> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Dropdown سريع لتبديل المشاريع: زر يعرض الحالي + قائمة منسدلة ببحث فوري
function ProjectDropdown({ projects, selectedId, switchingKey, recentPaths, onSelect, variant, t, lang }: {
  projects: Project[]
  selectedId?: string
  switchingKey: string | null
  recentPaths: string[]
  onSelect: (project: Project) => void
  variant: "sidebar" | "compact"
  t: Strings
  lang: Language
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const boxRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const sorted = useSortedProjects(projects, query, selectedId, recentPaths, lang)
  const selected = projects.find((project) => samePath(project.worktree, selectedId)) ?? null

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const toggle = () => {
    if (switchingKey) {
      return
    }
    if (!open) {
      setQuery("")
    }
    setOpen(!open)
  }

  const pick = (project: Project) => {
    setOpen(false)
    setQuery("")
    onSelect(project)
  }

  const label = switchingKey ? t.opening : selected ? projectName(selected) : t.chooseProject

  if (variant === "compact") {
    return (
      <div className="project-dropdown project-dropdown-compact" ref={boxRef}>
        <button
          className="project-dropdown-trigger compact-trigger"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={t.switchProjectsTitle}
          disabled={switchingKey !== null}
        >
          <span aria-hidden>📁</span>
          <span className="compact-trigger-name">{label}</span>
          <span aria-hidden>{open ? "⌃" : "⌄"}</span>
        </button>
        {open ? (
          <div className="project-dropdown-menu compact-menu">
            <input
              ref={searchRef}
              className="project-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.searchProjectPlaceholder}
              aria-label={t.searchProjectAria}
            />
            {projects.length === 0 ? (
              <div className="empty-state">{t.noProjectsFound}</div>
            ) : sorted.length === 0 ? (
              <div className="empty-state">{t.noResultsFor} «{query}».</div>
            ) : (
              <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={pick} t={t} />
            )}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="project-dropdown project-dropdown-sidebar" ref={boxRef}>
      <button
        className="project-dropdown-trigger project-switch"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t.switchProjectsTitle}
        disabled={switchingKey !== null}
      >
        <span className="project-switch-icon">📁</span>
        <span><small>{t.currentProject} · {t.switch}</small><strong>{label}</strong></span>
        <span aria-hidden>{open ? "⌃" : "⌄"}</span>
      </button>
      {open ? (
        <div className="project-dropdown-menu">
          {projects.length > 4 ? (
            <input
              ref={searchRef}
              className="project-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.searchProjectPlaceholder}
              aria-label={t.searchProjectAria}
            />
          ) : null}
          {projects.length === 0 ? (
            <div className="empty-state">{t.openProjectFirst}</div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">{t.noResultsFor} «{query}».</div>
          ) : (
            <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={pick} t={t} />
          )}
        </div>
      ) : null}
    </div>
  )
}

function ProjectPicker({ projects, selectedId, switchingKey, recentPaths, onSelect, onCancel, t, lang }: {
  projects: Project[]
  selectedId?: string
  switchingKey: string | null
  recentPaths: string[]
  onSelect: (project: Project) => void
  onCancel?: () => void
  t: Strings
  lang: Language
}) {
  const [query, setQuery] = useState("")
  const sorted = useSortedProjects(projects, query, selectedId, recentPaths, lang)
  return (
    <main className="project-screen">
      <div className="project-picker">
        <div className="project-picker-header">
          <div className="brand-mark"><img src="/icon.svg" alt="OpenCode" /></div>
          <div className="eyebrow">OpenCode Mobile</div>
          <h1>{t.chooseProject}</h1>
          <p>{t.chooseFromList}</p>
        </div>
        <div className="project-dropdown-standalone">
          <input
            className="project-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.searchProjectPlaceholder}
            aria-label={t.searchProjectAria}
          />
          {projects.length === 0 ? (
            <div className="empty-state">{t.openProjectFirst}</div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">{t.noResultsFor} «{query}».</div>
          ) : (
            <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={onSelect} t={t} />
          )}
        </div>
        {switchingKey ? <div className="picker-loading"><span className="loader" /> {t.openingProject}</div> : null}
        {onCancel ? <button className="button button-ghost" onClick={onCancel}>{t.back}</button> : null}
      </div>
    </main>
  )
}

function ResultFilesList({ files, sessionId, onToast, t }: { files: ResultFile[]; sessionId: string; onToast: (message: string, kind?: ToastKind) => void; t: Strings }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const canShare = typeof navigator.share === "function"

  if (files.length === 0) {
    return null
  }

  const handleDownload = async (file: ResultFile) => {
    setBusyId(file.id)
    try {
      await downloadResultFile(sessionId, file)
      // المتصفح بيبيّن التحميل بعينك — من غير toast نجاح
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : t.downloadFailed, "error")
    } finally {
      setBusyId(null)
    }
  }

  const handleShare = async (file: ResultFile) => {
    setBusyId(file.id)
    try {
      const shared = await shareResultFile(sessionId, file)
      if (!shared) {
        await handleDownload(file)
      }
      // اتشارك/اتحمّل وشايفه بعينك — من غير toast نجاح
    } catch (error: unknown) {
      if (error instanceof Error && /abort|cancel/i.test(error.message)) {
        return
      }
      onToast(error instanceof Error ? error.message : t.shareFailed, "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="result-files">
      <div className="final-result-label">{t.resultFilesTitle} ({files.length})</div>
      <div className="result-files-list">
        {files.map((file) => (
          <div className="result-file-item" key={file.id}>
            <span className="result-file-icon" aria-hidden>📄</span>
            <span className="result-file-body">
              <strong title={file.path || file.name}>{file.name}</strong>
              <small>{file.mime}{file.path ? ` · ${file.path}` : ""}</small>
            </span>
            <span className="result-file-actions">
              <a
                className="button button-secondary"
                href={fileDownloadUrl(sessionId, file)}
                download={file.name}
                rel="noopener"
              >
                {t.open}
              </a>
              <button
                className="button button-primary"
                disabled={busyId === file.id}
                onClick={() => void handleDownload(file)}
              >
                {busyId === file.id ? "…" : t.download}
              </button>
              {canShare ? (
                <button
                  className="button button-ghost"
                  disabled={busyId === file.id}
                  onClick={() => void handleShare(file)}
                  aria-label={`${t.share} ${file.name}`}
                >
                  {t.share}
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div className="result-files-hint">{t.resultFilesHint}</div>
    </div>
  )
}

function QuestionCard({ request, sessionId, onAnswered, t }: { request: ConversationQuestionRequest; sessionId: string; onAnswered: () => void; t: Strings }) {
  const [answers, setAnswers] = useState<ConversationQuestionAnswers>(() => request.questions.map(() => []))
  const [customDrafts, setCustomDrafts] = useState<string[]>(() => request.questions.map(() => ""))
  const [working, setWorking] = useState<"reply" | "reject" | null>(null)
  const [error, setError] = useState("")

  const toggleOption = (questionIndex: number, label: string) => {
    const multiple = request.questions[questionIndex]?.multiple
    setAnswers((current) => current.map((selected, index) => {
      if (index !== questionIndex) {
        return selected
      }
      if (!multiple) {
        return [label]
      }
      return selected.includes(label) ? selected.filter((value) => value !== label) : [...selected, label]
    }))
    if (!multiple) {
      setCustomDrafts((current) => current.map((draft, index) => index === questionIndex ? "" : draft))
    }
  }

  const updateCustomDraft = (questionIndex: number, value: string) => {
    setCustomDrafts((current) => current.map((draft, index) => index === questionIndex ? value : draft))
    if (!request.questions[questionIndex]?.multiple) {
      setAnswers((current) => current.map((selected, index) => index === questionIndex ? [] : selected))
    }
  }

  const payload = request.questions.map((question, index) => {
    const draft = customDrafts[index]?.trim() || ""
    if (question.multiple) {
      return [...new Set(draft && question.custom ? [...answers[index], draft] : answers[index])]
    }
    if (draft && question.custom) {
      return [draft]
    }
    return answers[index].slice(0, 1)
  })

  const canReply = request.questions.every((question, index) => {
    const draft = customDrafts[index]?.trim() || ""
    if (question.custom && draft) {
      return true
    }
    if (question.multiple) {
      return payload[index]?.length > 0
    }
    return payload[index]?.length === 1
  })

  const submitReply = async () => {
    if (!canReply || working) {
      return
    }
    setWorking("reply")
    setError("")
    try {
      const result = await replyQuestion(sessionId, request.id, payload)
      if (!result.accepted) {
        throw new Error(t.replyFailed)
      }
      // الكارت اختفى وشايفه بعينك — من غير toast
      onAnswered()
    } catch (replyError: unknown) {
      setError(replyError instanceof Error ? replyError.message : t.replyFailed)
    } finally {
      setWorking(null)
    }
  }

  const submitReject = async () => {
    if (working) {
      return
    }
    setWorking("reject")
    setError("")
    try {
      const result = await rejectQuestion(sessionId, request.id)
      if (!result.accepted) {
        throw new Error(t.rejectFailed)
      }
      // الكارت اختفى وشايفه بعينك — من غير toast
      onAnswered()
    } catch (rejectError: unknown) {
      setError(rejectError instanceof Error ? rejectError.message : t.rejectFailed)
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="question-card">
      <div className="question-card-top">
        <div><div className="eyebrow">{t.questionFromOpencode}</div><h3>{t.chooseBeforeContinue}</h3></div>
        <span className="question-count">{request.questions.length > 1 ? `${request.questions.length} ${t.questionsCount}` : t.oneQuestion}</span>
      </div>
      {request.questions.map((question, questionIndex) => (
        <div className="question-block" key={`${request.id}:${questionIndex}`}>
          <div className="question-header">{question.header}</div>
          <p className="question-text">{question.question}</p>
          {question.multiple ? <div className="question-hint">{t.multiChoiceHint}</div> : null}
          <div className="question-options">
            {question.options.map((option) => {
              const selected = answers[questionIndex]?.includes(option.label) || false
              return (
                <button
                  type="button"
                  className={`question-option${selected ? " selected" : ""}`}
                  disabled={Boolean(working)}
                  onClick={() => toggleOption(questionIndex, option.label)}
                  aria-pressed={selected}
                  key={`${request.id}:${questionIndex}:${option.label}`}
                >
                  <span className="question-option-check" aria-hidden>{question.multiple ? (selected ? "☑" : "☐") : selected ? "●" : "○"}</span>
                  <span className="question-option-body"><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
                </button>
              )
            })}
          </div>
          {question.custom ? (
            <label className="question-custom"><span>{t.customAnswer}</span><input value={customDrafts[questionIndex] || ""} onChange={(event) => updateCustomDraft(questionIndex, event.target.value)} placeholder={t.customAnswerPlaceholder} disabled={Boolean(working)} /></label>
          ) : null}
          {question.options.length === 0 && !question.custom ? <div className="empty-state">{t.noOptions}</div> : null}
        </div>
      ))}
      {error ? <div className="form-error">{error}</div> : null}
      <div className="question-actions">
        <button className="button button-primary" disabled={!canReply || Boolean(working)} onClick={() => void submitReply()}>{working === "reply" ? t.sending : t.sendChoice}</button>
        <button className="button button-ghost" disabled={Boolean(working)} onClick={() => void submitReject()}>{working === "reject" ? t.rejecting : t.rejectQuestion}</button>
      </div>
    </div>
  )
}

function todoPresentation(status: string, t: Strings): { className: string; label: string; mark: string } {
  const normalized = status.toLowerCase().replace(/-/g, "_")
  if (normalized === "completed") {
    return { className: "todo-completed", label: t.todoCompleted, mark: "✓" }
  }
  if (normalized === "in_progress") {
    return { className: "todo-in_progress", label: t.todoInProgress, mark: "◐" }
  }
  if (normalized === "cancelled") {
    return { className: "todo-cancelled", label: t.todoCancelled, mark: "×" }
  }
  return { className: "todo-pending", label: t.todoPending, mark: "○" }
}

function TodoList({ todos, t }: { todos: Todo[]; t: Strings }) {
  if (todos.length === 0) {
    return null
  }
  return (
    <div className="todo-panel">
      <div className="todo-panel-header">
        <div className="section-title">{t.planTitle} <span>({todos.length})</span></div>
        <span className="todo-updated-label">{t.planAutoUpdate}</span>
      </div>
      <div className="todo-list">
        {todos.map((todo) => {
          const presentation = todoPresentation(todo.status, t)
          return (
            <div className={`todo-item ${presentation.className}`} key={todo.id}>
              <span className="todo-mark" aria-hidden>{presentation.mark}</span>
              <span className="todo-content">{todo.content}</span>
              <span className="todo-status">{presentation.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatElapsed(since: number | undefined, t: Strings, now: number = Date.now()): string {
  if (!since) {
    return ""
  }
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) {
    return `${seconds} ${t.secondsShort}`
  }
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes} ${t.minutesShort} ${rest} ${t.secondsShort}` : `${minutes} ${t.minutesShort}`
}

// عدّاد محلي كل ثانية عشان وقت المهمة يمشي حتى لو الـ poll اتأخر
// أو التبويب اتخنق (throttle) — قبل كده الوقت كان بيتحدث فقط مع كل refreshRequests.
function useNowTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

interface ActivitySeenEntry {
  at: number
  item: ActiveSession
}

// ذاكرة نشاط قائمة "المحادثات النشطة": آخر لحظة ظهرت فيها كل محادثة وآخر بيانات معروفة عنها.
// لازم تكون في App مش في اللوحة نفسها، عشان لما تفتح اللوحة تلاقي اللي اشتغل من شوية لسه معروض.
function useActivityGrace(items: ActiveSession[], graceMs: number, ticking: boolean) {
  const [seen, setSeen] = useState<Record<string, ActivitySeenEntry>>({})
  const live = useMemo(() => new Set(items.map((item) => item.id)), [items])

  // بيتنادى مع كل poll للنشاط: نعرف آخر بيانات كل محادثة، ونسيب اللي خرج من القائمة
  // لسه في مهلة الـ ٥ دقايق، ونضف اللي عدّت مهلته.
  const track = useCallback((next: ActiveSession[], stamp: number) => {
    setSeen((current) => {
      const result: Record<string, ActivitySeenEntry> = {}
      const nextIds = new Set<string>()
      for (const item of next) {
        nextIds.add(item.id)
        result[item.id] = { at: stamp, item }
      }
      for (const [id, entry] of Object.entries(current)) {
        if (nextIds.has(id) || stamp - entry.at >= graceMs) {
          continue
        }
        result[id] = entry
      }
      return result
    })
  }, [graceMs])

  const pending = useMemo(() => Object.keys(seen).some((id) => !live.has(id)), [seen, live])
  // العدّاد بيوقف لو اللوحة مقفولة — نضف القديم مع كل poll وحنا كده
  const nowTick = useNowTick(pending && ticking)

  // المحادثات اللي خرجت من "نشط دلوقتي" بس لسه في مهلة الـ ٥ دقايق
  const recent = useMemo(() => Object.values(seen)
    .filter((entry) => !live.has(entry.item.id) && nowTick - entry.at < graceMs)
    .map((entry) => entry.item)
    .sort((left, right) => right.updatedAt - left.updatedAt), [seen, live, nowTick, graceMs])

  const graceLeft = useCallback((id: string) => {
    const entry = seen[id]
    if (entry === undefined || live.has(id)) {
      return 0
    }
    return graceMs - (nowTick - entry.at)
  }, [seen, live, nowTick, graceMs])

  return { track, recent, graceLeft }
}

const REQUEST_STATE_LABEL: Record<RequestState, keyof Strings> = {
  queued: "inQueue",
  running: "running",
  done: "done",
  stopped: "stopped",
}

const REQUEST_STATE_TITLE: Record<RequestState, keyof Strings> = {
  queued: "taskQueued",
  running: "taskRunning",
  done: "taskFinished",
  stopped: "taskStopped",
}

// كل طلب في المحادثة بيتعرض كسطر واحد جوه كارت واحد، زي قائمة المهام.
const REQUEST_STATE_ROW: Record<RequestState, string> = {
  queued: "request-row-queued",
  running: "request-row-running",
  done: "request-row-done",
  stopped: "request-row-stopped",
}

const REQUEST_STATE_MARK: Record<RequestState, string> = {
  queued: "⋯",
  running: "◐",
  done: "✓",
  stopped: "×",
}

function RequestRow({ request, expanded, onToggle, sessionId, onCopy, onToast, onSkip, onRunNow, onRemove, busyAction, t, lang }: { request: SessionRequest; expanded: boolean; onToggle: () => void; sessionId: string | null; onCopy: (text: string) => void; onToast: (message: string, kind?: ToastKind) => void; onSkip: () => void; onRunNow: () => void; onRemove: () => void; busyAction: string | null; t: Strings; lang: Language }) {
  const running = request.state === "running"
  const queued = request.state === "queued"
  // الكارت المتفائل لسه ما وصلش السيرفر، فمعندناش id نبعته له
  const notSentYet = request.id.startsWith("local-")
  const now = useNowTick(running && expanded)
  const hasTodos = request.totalTodos > 0
  const progress = hasTodos ? Math.round((request.completedTodos / request.totalTodos) * 100) : 0
  const steps = request.stepsCompleted ?? 0
  const elapsed = running ? formatElapsed(request.startedAt, t, now) : ""
  // تخطّي للطلب الشغّال، وتنفيذ حالًا وحذف من الطابور لكل طلب مستني بس
  const actions = running || queued ? (
    <span className="request-row-actions">
      {running ? (
        <button type="button" className="request-action request-action-skip" onClick={onSkip} disabled={busyAction === request.id} title={t.skipCurrent}>
          <svg className="request-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4.5v15l10.5-7.5L6 4.5z" fill="currentColor" stroke="none" />
            <path d="M19 5v14" />
          </svg>
          <span className="request-action-label">{t.skipCurrent}</span>
        </button>
      ) : null}
      {queued ? (
        <>
          <button type="button" className="request-action request-action-run" onClick={onRunNow} disabled={busyAction === request.id || notSentYet} title={t.runNow}>
            <svg className="request-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4.5v15l12-7.5-12-7.5z" fill="currentColor" stroke="none" />
            </svg>
            <span className="request-action-label">{t.runNow}</span>
          </button>
          <button type="button" className="request-action request-action-remove" onClick={onRemove} disabled={busyAction === request.id} title={t.removeFromQueue}>
            <svg className="request-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
            <span className="request-action-label">{t.removeFromQueue}</span>
          </button>
        </>
      ) : null}
    </span>
  ) : null
  return (
    <li className={`request-row ${REQUEST_STATE_ROW[request.state]}${expanded ? " is-open" : ""}`}>
      <div className="request-row-head">
        <button type="button" className="request-row-toggle" onClick={onToggle} aria-expanded={expanded}>
          <span className="request-row-mark" aria-hidden>{REQUEST_STATE_MARK[request.state]}</span>
          <span className="request-row-index">{t.requestNumber} {request.index}</span>
          <span className="request-row-prompt">{request.prompt || t.yourRequest}</span>
          <span className="request-row-state">{t[REQUEST_STATE_LABEL[request.state]]}</span>
          <span className="request-row-caret" aria-hidden>{expanded ? "▾" : "▸"}</span>
        </button>
        {actions}
      </div>
      {expanded ? (
        <div className="request-row-body">
          <div className="task-activity">
            <span className="activity-pulse" />
            {request.activity || (running ? t.workingOnTask : t.noNewActivity)}
          </div>
          {hasTodos ? (
            <>
              <div className="progress-track"><span style={{ width: `${Math.min(progress, 100)}%` }} /></div>
              <div className="task-stats"><span>{request.completedTodos}/{request.totalTodos} {t.completedStepsOf}</span><span>{request.updatedAt ? formatTime(request.updatedAt, lang) : ""}</span></div>
            </>
          ) : running ? (
            <>
              <div className="progress-track indeterminate" aria-label={t.running} />
              <div className="live-stats">
                <span className="live-stat">⚙️ {request.activeTool || t.preparingTools}</span>
                {steps > 0 ? <span className="live-stat">✅ {steps} {steps === 1 ? t.executedStep : t.executedSteps}</span> : null}
                {elapsed ? <span className="live-stat live-time">⏱️ {elapsed}</span> : null}
              </div>
            </>
          ) : steps > 0 ? (
            <div className="live-stats finished">
              <span className="live-stat">✅ {steps} {steps === 1 ? t.executedStep : t.executedSteps}</span>
            </div>
          ) : null}
          <TodoList todos={request.todos} t={t} />
          {running && request.liveText ? <div className="final-result live-result"><div className="final-result-label">{t.liveResponse}</div><div className="final-result-text">{request.liveText}<span className="live-cursor" aria-hidden>▍</span></div><button className="copy-result" onClick={() => onCopy(request.liveText)}>{t.copyResult}</button></div> : null}
          {request.finalResult && !running ? <div className="final-result"><div className="final-result-label">{t.finalResult}</div><div className="final-result-text">{request.finalResult}</div><button className="copy-result" onClick={() => onCopy(request.finalResult)}>{t.copyResult}</button></div> : running && !request.liveText ? <div className="result-pending">{t.resultWillAppear}</div> : null}
          {sessionId && request.resultFiles.length > 0 ? <ResultFilesList files={request.resultFiles} sessionId={sessionId} onToast={onToast} t={t} /> : null}
          {sessionId && !running && request.resultFiles.length === 0 && request.finalResult ? <div className="result-files-hint">{t.noResultFileHint}</div> : null}
        </div>
      ) : null}
    </li>
  )
}

// كارت واحد للمحادثة كلها: كل الطلبات قائمة جواه، والطلب الأخير هو المفتوح.
function RequestCard({ requests, sessionId, onCopy, onToast, onSkip, onRunNow, onRemove, busyAction, t, lang }: { requests: SessionRequest[]; sessionId: string | null; onCopy: (text: string) => void; onToast: (message: string, kind?: ToastKind) => void; onSkip: (request: SessionRequest) => void; onRunNow: (request: SessionRequest) => void; onRemove: (request: SessionRequest) => void; busyAction: string | null; t: Strings; lang: Language }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const latest = requests[requests.length - 1]
  // الطلب الشغّال هو المفتوح افتراضيًا؛ بعد ما يخلص آخر طلب هو اللي يفضل مفتوح.
  const activeId = requests.find((request) => request.state === "running") || latest
  const expandedId = openId && requests.some((request) => request.id === openId) ? openId : activeId ? activeId.id : null
  return (
    <section className={`task-summary task-${latest ? latest.state : "done"}`}>
      <div className="task-summary-top">
        <div>
          <div className="eyebrow">{t.taskStatus} · {t.requestsInSession} {requests.length}</div>
          <h2>{latest ? t[REQUEST_STATE_TITLE[latest.state]] : t.taskFinished}</h2>
        </div>
        <span className="task-summary-state">{latest ? t[REQUEST_STATE_LABEL[latest.state]] : t.done}</span>
      </div>
      <ul className="request-list">
        {requests.map((request) => (
          <RequestRow
            key={request.id}
            request={request}
            expanded={request.id === expandedId}
            onToggle={() => setOpenId(request.id === expandedId ? null : request.id)}
            sessionId={sessionId}
            onCopy={onCopy}
            onToast={onToast}
            onSkip={() => onSkip(request)}
            onRunNow={() => onRunNow(request)}
            onRemove={() => onRemove(request)}
            busyAction={busyAction}
            t={t}
            lang={lang}
          />
        ))}
      </ul>
    </section>
  )
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
  const [pendingModel, setPendingModel] = useState<SessionModelRef | null>(null)
  const [showModels, setShowModels] = useState(false)
  const [switchingKey, setSwitchingKey] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [historyTurns, setHistoryTurns] = useState<HistoryTurn[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [activity, setActivity] = useState<ActiveSession[]>([])
  const [jumpingId, setJumpingId] = useState<string | null>(null)
  // حالة git: الأيقونة بتجيب العدد من غير ما تفتح القائمة، والقائمة بتجيبها لما تفتحها
  const [showGitChanges, setShowGitChanges] = useState(false)
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
  const sidebarActiveSessions = useMemo(() => sessions.filter((session) => isSessionWorking(session.id)), [sessions, isSessionWorking])
  const sidebarInactiveSessions = useMemo(() => sessions.filter((session) => !isSessionWorking(session.id)), [sessions, isSessionWorking])

  // في لوحة "المحادثات النشطة": اللي شغالة دلوقتي، واللي كانت نشطة في آخر ٥ دقايق
  const { track: trackActivity, recent: activityRecent, graceLeft: activityGraceLeft } = useActivityGrace(activity, ACTIVE_GRACE_MS, showActivity)

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
      return
    }
    // الإتمام ده اتنبّه عليه قبل كده وانت في شاشة تانية — متكرّرش
    if (notifiedViaStatusRef.current.delete(activeId)) {
      return
    }
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
      setActivity(items)
      trackActivity(items, Date.now())
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

  const openGitChanges = useCallback(() => {
    setShowGitChanges(true)
    void refreshGitChanges()
  }, [refreshGitChanges])

  const gitChangedCount = gitChanges?.available ? gitChanges.files.length : 0

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
  useEffect(() => {
    const element = workspaceScrollRef.current
    if (!element || requests.length === 0) {
      return
    }
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" })
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
      if (event.type === "session.updated" && event.properties.info.id === activeIdRef.current) {
        const id = event.properties.info.id
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
      setRawStatuses((current) => {
        const next = { ...current }
        delete next[prevId]
        return next
      })
    }
    setActiveId(nextId)
    activeIdRef.current = nextId
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
      if (activeId === session.id) {
        const next = remaining[0]?.id || null
        setActiveId(next)
        activeIdRef.current = next
        if (!next) {
          // مفيش جلسات: نرجع لمسودة فاضية بدون إنشاء جلسة على السيرفر
          setRequests([])
          setRequestQuestions([])
          setComposer("")
        } else {
          await refreshRequests(next)
        }
      }
      // اتمسحت وشايفها بعينك — من غير toast نجاح
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.deleteFailed, "error")
    }
  }

  // إرسال نص كطلب — المشترك بين زرار الإرسال وزرار commit و push
  const sendPrompt = useCallback(async (rawText: string) => {
    const text = rawText.trim()
    if (!text || sending) {
      return
    }
    setSending(true)
    setComposer("")
    // كارت optimist: بيظهر الطلب تحت اللي قبله فورًا قبل ما السيرفر يرد
    const optimisticId = `local-${++localRequestId.current}`
    try {
      // لو مسودة جديدة: أنشئ الجلسة مع أول رسالة فقط
      let sessionId = activeIdRef.current
      const isNewSession = !sessionId
      const modelForNewSession = isNewSession ? (pendingModel || currentModel || defaultModel || undefined) : undefined
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
      setSending(false)
    }
  }, [sending, pendingModel, currentModel, defaultModel, refreshRequests, refreshSessions, setSettledStatus, addToast])

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault()
    await sendPrompt(composer)
  }

  // زرار الـ side menu بتاع الـ git: يبعت طلب يعمل commit و push للتغييرات
  const handleCommitPush = useCallback(async () => {
    const files = gitChanges?.files ?? []
    if (!gitChanges?.available || files.length === 0 || sending) {
      return
    }
    const branch = gitChanges.branch || ""
    const fileLines = files.slice(0, 50).map((file) => `- ${file.path} (${file.status})`).join("\n")
    const prompt = langRef.current === "ar"
      ? `اعمل commit لكل التغييرات الحالية في git وبعدها push${branch ? ` على الفرع '${branch}'` : ""}.\nخطواتك:\n1) راجع git status و git diff.\n2) اعمل git add للملفات المتغيرة.\n3) اعمل commit برسالة واضحة ومختصرة.\n4) اعمل push${branch ? ` إلى '${branch}'` : ""}.\nالملفات المتغيرة:\n${fileLines}\nلو مفيش remote متظبط قولي بوضوح ومتخترعش حاجة.`
      : `Commit all current git changes and then push${branch ? ` to branch '${branch}'` : ""}.\nSteps:\n1) Review git status and git diff.\n2) git add the changed files.\n3) Commit with a clear, concise message.\n4) Push${branch ? ` to '${branch}'` : ""}.\nChanged files:\n${fileLines}\nIf no remote is configured, say so clearly and don't invent anything.`
    setShowGitChanges(false)
    await sendPrompt(prompt)
  }, [gitChanges, sending, sendPrompt])

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

  const displayedModel: SessionModelRef | null = activeId ? currentModel : (pendingModel || currentModel || defaultModel)

  // صف سريع لمستويات التفكير تحت شريط الكتابة — بيظهر للموديل المختار الحالي بس
  const composerVariety = useMemo(() => {
    if (!displayedModel) {
      return null
    }
    const model = models.find((item) => item.providerID === displayedModel.providerID && item.id === displayedModel.modelID)
    if (!model) {
      return null
    }
    const variants = getVarietyLevels(model).sort((a, b) => {
      const left = VARIANT_ORDER.indexOf(a)
      const right = VARIANT_ORDER.indexOf(b)
      if (left !== -1 && right !== -1) return left - right
      if (left !== -1) return -1
      if (right !== -1) return 1
      return a.localeCompare(b)
    })
    if (variants.length === 0) {
      return null
    }
    return { model, variants, active: displayedModel.variant || "", busy: isBusy }
  }, [displayedModel, models, isBusy])

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
    void navigator.clipboard?.writeText(text)
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

  if (authState === "loading") {
    return <div className="center-screen"><div className="loader" /><p>{t.connectingToOpencode}</p></div>
  }

  if (authState === "signedOut") {
    return (
      <main className="login-screen">
        <div className="login-card">
          <div className="brand-mark"><img src="/icon.svg" alt="OpenCode" /></div>
          <div className="eyebrow">OpenCode Mobile</div>
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
                    <span className="session-group-count" aria-label={`${sidebarActiveSessions.length} ${t.conversations}`}>{sidebarActiveSessions.length}</span>
                  </div>
                  {sidebarActiveSessions.map((session) => {
                    const needsPermission = permissions.some((permission) => permission.sessionID === session.id)
                    return (
                      <div ref={session.id === activeId ? activeSessionItemRef : undefined} className={`session-item is-working ${session.id === activeId ? "active" : ""}${needsPermission ? " needs-permission" : ""}`} key={session.id}>
                        <button className="session-select" onClick={() => void selectSession(session.id)}>
                          <span className="session-title-row">
                            <span className="session-title">{displayTitle(session.title, t)}</span>
                            {needsPermission ? <span className="permission-badge">{t.needsPermission}</span> : null}
                          </span>
                          <span className="session-meta">
                            <span className="working-spinner" aria-hidden />
                            <span>{statusLabel(statuses[session.id], t)}</span>
                            <span aria-hidden>·</span>
                            <span>{formatDate(session.time.created, lang)} · {formatTime(session.time.created, lang)}</span>
                          </span>
                        </button>
                        <button className="session-delete" onClick={() => void handleDeleteSession(session)} aria-label={t.deleteSession}>⌫</button>
                      </div>
                    )
                  })}
                </section>
              ) : null}
              <section className="session-group" aria-label={t.inactiveConversations}>
                <div className="session-group-header">
                  <span className="session-group-title"><span aria-hidden>💤</span> {t.inactive}</span>
                  <span className="session-group-count" aria-label={`${sidebarInactiveSessions.length} ${t.conversations}`}>{sidebarInactiveSessions.length}</span>
                </div>
                {sidebarInactiveSessions.length === 0 ? (
                  <div className="session-group-empty">{t.noInactiveConversations}</div>
                ) : (
                  sidebarInactiveSessions.map((session) => {
                    const needsPermission = permissions.some((permission) => permission.sessionID === session.id)
                    return (
                      <div ref={session.id === activeId ? activeSessionItemRef : undefined} className={`session-item ${session.id === activeId ? "active" : ""}${needsPermission ? " needs-permission" : ""}`} key={session.id}>
                        <button className="session-select" onClick={() => void selectSession(session.id)}>
                          <span className="session-title-row">
                            <span className="session-title">{displayTitle(session.title, t)}</span>
                            {needsPermission ? <span className="permission-badge">{t.needsPermission}</span> : null}
                          </span>
                          <span className="session-meta"><span className="status-dot" aria-hidden /><span>{statusLabel(statuses[session.id], t)}</span><span aria-hidden>·</span><span>{formatDate(session.time.created, lang)} · {formatTime(session.time.created, lang)}</span></span>
                        </button>
                        <button className="session-delete" onClick={() => void handleDeleteSession(session)} aria-label={t.deleteSession}>⌫</button>
                      </div>
                    )
                  })
                )}
              </section>
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="connection-state"><span className={`status-dot ${eventConnected ? "online" : "offline"}`} />{eventConnected ? t.connectedLive : t.reconnecting}</div>
          <button className="sidebar-action" onClick={() => setShowSettings(true)}><span>⚙</span> {t.settings}</button>
          <button className="sidebar-action" onClick={() => void handleLogout()}><span>↪</span> {t.logout}</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setShowSessions(true)} aria-label={t.openSessions}>☰</button>
          <div className="current-session">
            <div className="topbar-project-row">
              <div className="project-name-badge" title={selectedProject ? projectName(selectedProject) : undefined}>
                <span aria-hidden>📁</span>
                <span className="compact-trigger-name">{switchingProject ? t.opening : selectedProject ? projectName(selectedProject) : "—"}</span>
              </div>
              <button className="new-chat-top" type="button" onClick={() => void handleNewSession()} disabled={!selectedProject} title={t.newConversation} aria-label={t.newConversation}>
                <span aria-hidden>＋</span>
                <span className="new-chat-top-label">{t.newConversation}</span>
              </button>
            </div>
            {editingSessionId !== null && editingSessionId === activeId ? (
              <form className="session-title-form" onSubmit={handleRenameSession}>
                <input aria-label={t.conversationName} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={handleSessionTitleKeyDown} maxLength={120} required autoFocus disabled={renamingTitle} />
                <button className="title-action" type="submit" disabled={!titleDraft.trim() || renamingTitle} aria-label={t.save}>{renamingTitle ? "…" : "✓"}</button>
                <button className="title-action" type="button" onClick={cancelRenamingSession} disabled={renamingTitle} aria-label={t.cancel}>×</button>
              </form>
            ) : (
              <div className="session-title-row"><h1 title={activeTitle}>{activeTitle}</h1>{activeSession ? <button className="title-edit" onClick={startRenamingSession} aria-label={t.renameConversation}>✎</button> : null}</div>
            )}
          </div>
          <div className="topbar-actions">
            <button className="model-pill" onClick={() => setShowModels(true)} title={t.modelInUse}>
              <span aria-hidden>🤖</span>
              <span className="model-pill-name" dir="ltr">{modelLabel(displayedModel, t)}</span>
              <span className="free-badge">FREE</span>
            </button>
            <button className="icon-button activity-button" onClick={() => setShowActivity(true)} aria-label={t.activeFromAllProjects} title={`${t.activeFromAllProjects} ⚡`}>⚡{activity.length > 0 ? <span className="count-badge">{activity.length}</span> : null}</button>
            <button className="icon-button activity-button git-button" onClick={openGitChanges} aria-label={t.gitChangesAria} title={`${t.gitChangesAria} ⑂`}><GitBranchIcon />{gitChangedCount > 0 ? <span className="count-badge">{gitChangedCount}</span> : null}</button>
            <button className="icon-button" onClick={toggleTheme} aria-label={`${t.themeNext}: ${themeLabel(nextTheme(theme), t)}`} title={`${t.themeNext}: ${themeLabel(nextTheme(theme), t)}`}>{THEME_META[theme].icon}</button>
            <button className="icon-button lang-button" onClick={toggleLanguage} aria-label={t.language} title={t.language}>{lang === "ar" ? "EN" : "ع"}</button>
            <button className="icon-button" onClick={() => setShowHistory(true)} aria-label={t.historyAria} title={`${t.historyAria} 🕘`}>🕘</button>
            <button className="icon-button" onClick={() => setShowSettings(true)} aria-label={t.settingsAria}>⚙</button>
          </div>
        </header>

        <div className="workspace">
          <div className="workspace-scroll" ref={workspaceScrollRef}>
            {requests.length > 0 ? (
              <div className="request-stack">
                <RequestCard requests={requests} sessionId={activeId} onCopy={copyText} onToast={addToast} onSkip={(request) => void handleSkip(request)} onRunNow={(request) => void handleRunNow(request)} onRemove={(request) => void handleRemoveQueued(request)} busyAction={queueAction} t={t} lang={lang} />
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
            <button className="composer-model-line" onClick={() => setShowModels(true)} title={t.changeModelTitle}>
              <span aria-hidden>🤖</span>
              <span dir="ltr">{modelLabel(displayedModel, t)}</span>
              <span className="free-badge">FREE 🆓</span>
              <span className="change-link">{t.change}</span>
            </button>
            {composerVariety ? (
              <div className="composer-variety-row">
                <label className="composer-variety-label" htmlFor="composer-variety-select">{t.modelVariety}</label>
                <select
                  id="composer-variety-select"
                  className="composer-variety-select"
                  value={composerVariety.active}
                  disabled={composerVariety.busy}
                  onChange={(event) => void handleSelectModel(composerVariety.model, event.target.value)}
                  aria-label={t.modelVariety}
                >
                  <option value="">{t.varietyDefault}</option>
                  {composerVariety.variants.map((variant) => (
                    <option value={variant} key={variant}>
                      {variantLabel(variant, t)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {showActivity ? (
        <Suspense fallback={<PanelFallback />}>
          <ActiveSessionsPanel
            items={activity}
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
      {showGitChanges ? (
        <Suspense fallback={<PanelFallback />}>
          <GitChangesPanel
            changes={gitChanges}
            loading={gitLoading}
            onRefresh={() => void refreshGitChanges()}
            onCommitPush={() => void handleCommitPush()}
            commitBusy={sending}
            onClose={() => setShowGitChanges(false)}
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
