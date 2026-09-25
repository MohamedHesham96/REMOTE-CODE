import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
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
  getHistory,
  getModels,
  getProjects,
  getSessionModel,
  getStatuses,
  getSummary,
  listPermissions,
  listSessions,
  login,
  logout,
  renameSession,
  replyPermission,
  replyQuestion,
  rejectQuestion,
  selectProject,
  sendMessage,
  setSessionModel,
  shareResultFile,
  subscribePush,
  unsubscribePush,
} from "./api"
import type { ActiveSession, AppConfig, ClientEvent, ConversationQuestionAnswers, ConversationQuestionRequest, HistoryTurn, ModelInfo, Permission, Project, ResultFile, Session, SessionModelRef, SessionStatus, SessionSummary, Todo } from "./types"
import { isSoundEnabled, playAttentionSound, playCompletionSound, setSoundEnabled, unlockAudio, vibrate } from "./sound"
import { applyTheme, getSavedTheme, nextTheme, saveTheme, THEMES, THEME_META, type AppTheme } from "./theme"

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

function formatTime(value: number | undefined): string {
  if (!value) {
    return ""
  }
  return new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short" }).format(new Date(value))
}

function formatDateTime(value: number | undefined): string {
  if (!value) {
    return ""
  }
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function projectName(project: Project): string {
  const normalized = project.worktree.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).filter(Boolean).pop() || project.worktree
}

function samePath(left: string | undefined | null, right: string | undefined | null): boolean {
  if (!left || !right) {
    return false
  }
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
  return normalize(left) === normalize(right)
}

function statusLabel(status: SessionStatus | undefined): string {
  if (!status) {
    return "جاهز"
  }
  if (status.type === "busy") {
    return "يعمل الآن"
  }
  if (status.type === "retry") {
    return "إعادة المحاولة"
  }
  return "جاهز"
}

function sessionMatches(sessions: Session[], id: string | null): Session | undefined {
  return id ? sessions.find((session) => session.id === id) : undefined
}

function displayTitle(title: string | undefined | null): string {
  const clean = (title || "").replace(/\s*\(mobile\)\s*$/i, "").trim()
  return clean || "محادثة جديدة"
}

function modelLabel(ref: SessionModelRef | null | undefined): string {
  if (!ref) {
    return "الموديل الافتراضي"
  }
  return `${ref.providerID}/${ref.modelID}`
}

function shortModelName(model: ModelInfo): string {
  return model.name && model.name !== model.id ? model.name : model.id
}

function ModelPicker({
  models,
  loading,
  current,
  busy,
  switching,
  onSelect,
  onRefresh,
  onClose,
}: {
  models: ModelInfo[]
  loading: boolean
  current: SessionModelRef | null
  busy: boolean
  switching: string | null
  onSelect: (model: ModelInfo) => void
  onRefresh: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  // الموجودين في opencode فقط + المتاح (enabled) + free فقط — القائمة حية من السيرفر
  const freeOnly = useMemo(() => models.filter((model) => model.free && model.enabled !== false), [models])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return freeOnly
    }
    return freeOnly.filter((model) =>
      `${model.providerID}/${model.id} ${model.name}`.toLowerCase().includes(q),
    )
  }, [freeOnly, query])

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer model-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div><div className="eyebrow">الموديل الحالي: {modelLabel(current)}</div><h2>اختر موديل مجاني 🆓</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        <div className="model-toolbar">
          <input
            className="model-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في المتاح من opencode…"
            aria-label="بحث عن موديل"
          />
          <button className="icon-button" onClick={onRefresh} aria-label="تحديث القائمة" title="تحديث من opencode" disabled={loading}>↻</button>
        </div>
        <div className="model-count">{loading ? "جارٍ التحديث من opencode…" : `المتاح الآن في opencode: ${freeOnly.length} موديل مجاني`}</div>
        {loading && freeOnly.length === 0 ? (
          <div className="picker-loading"><span className="loader" /> جارٍ تحميل الموديلات من opencode…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">لا توجد موديلات مجانية متاحة حاليًا في opencode.</div>
        ) : (
          <div className="model-list">
            {filtered.map((model) => {
              const key = `${model.providerID}/${model.id}`
              const isCurrent = current?.providerID === model.providerID && current?.modelID === model.id
              const isSwitching = switching === key
              return (
                <button
                  className={`model-card${isCurrent ? " selected" : ""}`}
                  key={key}
                  disabled={busy || Boolean(switching)}
                  onClick={() => onSelect(model)}
                >
                  <span className="model-card-body">
                    <strong>{shortModelName(model)}</strong>
                    <small dir="ltr">{key}</small>
                  </span>
                  <span className="model-card-side">
                    <span className="free-badge">FREE 🆓</span>
                    {isCurrent ? <span className="current-badge">الحالي ✓</span> : null}
                    {isSwitching ? <span className="loader small" /> : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="model-footnote">القائمة حية من opencode — بتتغير حسب الـ providers والموديلات المتاحة عندك. بنعرض المجاني (تكلفة صفر) فقط.</div>
      </aside>
    </div>
  )
}

function isSummaryEmpty(candidate: SessionSummary | null): boolean {
  if (!candidate) {
    return true
  }
  const hasPrompt = Boolean(candidate.prompt?.trim())
  const hasResult = Boolean(candidate.finalResult?.trim())
  const hasTodos = (candidate.todos?.length || 0) > 0 || (candidate.totalTodos || 0) > 0
  const hasQuestions = (candidate.questions?.length || 0) > 0
  const hasFiles = (candidate.resultFiles?.length || 0) > 0
  return !hasPrompt && !hasResult && !hasTodos && !hasQuestions && !hasFiles
}

function ActiveSessionsPanel({ items, activeId, jumpingId, onJump, onClose }: {
  items: ActiveSession[]
  activeId: string | null
  jumpingId: string | null
  onJump: (item: ActiveSession) => void
  onClose: () => void
}) {
  // تجميع المحادثات النشطة حسب المشروع — كل المشاريع في مكان واحد
  const grouped = useMemo(() => {
    const map = new Map<string, ActiveSession[]>()
    for (const item of items) {
      const list = map.get(item.projectName) || []
      list.push(item)
      map.set(item.projectName, list)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [items])

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer activity-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">⚡ شغال الآن · {items.length > 0 ? `${items.length} ${items.length === 1 ? "محادثة" : "محادثات"}` : "لا يوجد"} · كل المشاريع</div>
            <h2>المحادثات النشطة</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">مفيش أي محادثة شغالة حاليًا في أي مشروع.<br />أول ما OpenCode يبدأ شغل هتظهر هنا.</div>
        ) : (
          <div className="activity-groups">
            {grouped.map(([projectName, group]) => (
              <section className="activity-group" key={projectName}>
                <div className="activity-group-header">
                  <span className="activity-group-icon" aria-hidden>📁</span>
                  <strong>{projectName}</strong>
                  <span className="activity-group-count">{group.length}</span>
                </div>
                {group.map((item) => {
                  const isCurrent = item.id === activeId
                  const isJumping = jumpingId === item.id
                  return (
                    <div className="activity-row" key={item.id}>
                      <span className="working-spinner" aria-hidden />
                      <span className="activity-row-body">
                        <strong>{displayTitle(item.title)}</strong>
                        <small>{statusLabel(item.status)} · {formatDateTime(item.updatedAt)}</small>
                      </span>
                      {isCurrent ? (
                        <span className="current-badge">الحالية ✓</span>
                      ) : (
                        <button
                          className="button button-secondary"
                          disabled={jumpingId !== null}
                          onClick={() => onJump(item)}
                        >
                          {isJumping ? "جارٍ الفتح…" : "انتقال ←"}
                        </button>
                      )}
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        )}
        <div className="model-footnote">القائمة حية — بتتحدث كل ٤ ثواني وبتشمل كل المشاريع تحت مجلد العمل.</div>
      </aside>
    </div>
  )
}

function HistoryPanel({
  turns,
  loading,
  error,
  sessionId,
  onClose,
  onCopy,
  onRetry,
}: {
  turns: HistoryTurn[]
  loading: boolean
  error: string
  sessionId: string | null
  onClose: () => void
  onCopy: (text: string) => void
  onRetry: () => void
}) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return turns
    }
    return turns.filter((turn) =>
      `${turn.prompt}\n${turn.finalResult}`.toLowerCase().includes(q),
    )
  }, [turns, query])

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer history-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">سجل المحادثة · {turns.length > 0 ? `${turns.length} ${turns.length === 1 ? "رسالة" : "رسائل"}` : "لا يوجد بعد"}</div>
            <h2>النتائج والكلام القديم 🕘</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        <div className="history-toolbar">
          <input
            className="history-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في الأسئلة أو النتائج القديمة…"
            aria-label="بحث في السجل"
          />
          {query ? <button className="icon-button" onClick={() => setQuery("")} aria-label="مسح البحث">×</button> : null}
        </div>
        {loading ? (
          <div className="picker-loading"><span className="loader" /> جارٍ تحميل السجل المنظم…</div>
        ) : error ? (
          <div className="empty-state">{error}<br /><button className="button button-secondary" onClick={onRetry}>إعادة المحاولة</button></div>
        ) : turns.length === 0 ? (
          <div className="empty-state">لسه مفيش كلام قديم في المحادثة دي.<br />ابعت أول سؤال وهيتحفظ هنا بشكل منظم.</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">لا توجد نتائج مطابقة لـ «{query}».<br />جرّب كلمة تانية.</div>
        ) : (
          <div className="history-list">
            {filtered.map((turn) => {
              const isOpen = expanded.has(turn.id)
              const result = turn.finalResult.trim()
              const isLong = result.length > 400
              const visibleResult = !isLong || isOpen ? result : `${result.slice(0, 400)}…`
              return (
                <article className="history-card" key={turn.id}>
                  <div className="history-card-top">
                    <span className="history-index">#{turn.index}</span>
                    <span className="history-date">{formatDateTime(turn.createdAt)}</span>
                    {turn.steps > 0 ? <span className="history-steps">⚙️ {turn.steps} {turn.steps === 1 ? "خطوة" : "خطوات"}</span> : null}
                  </div>
                  <div className="history-block history-question">
                    <div className="history-label">💬 سؤالك</div>
                    <p>{turn.prompt || "—"}</p>
                    <button className="history-copy" onClick={() => onCopy(turn.prompt)}>نسخ السؤال</button>
                  </div>
                  <div className="history-block history-answer">
                    <div className="history-label">✅ النتيجة النهائية</div>
                    {result ? (
                      <>
                        <div className="history-result-text">{visibleResult}</div>
                        <div className="history-actions">
                          {isLong ? (
                            <button className="history-copy" onClick={() => toggleExpanded(turn.id)}>
                              {isOpen ? "عرض أقل ↑" : "عرض كامل ↓"}
                            </button>
                          ) : null}
                          <button className="history-copy" onClick={() => onCopy(turn.finalResult)}>نسخ النتيجة</button>
                        </div>
                      </>
                    ) : (
                      <div className="result-pending">لسه مفيش نتيجة نهائية للسؤال ده.</div>
                    )}
                    {sessionId && turn.files.length > 0 ? (
                      <div className="history-files">
                        <div className="history-label">📎 ملفات ({turn.files.length})</div>
                        {turn.files.map((file) => (
                          <a
                            key={file.id}
                            className="file-part file-download-link"
                            href={fileDownloadUrl(sessionId, file)}
                            download={file.name}
                            rel="noopener"
                          >
                            ⬇ {file.name}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <div className="model-footnote">السجل مرتب من الأحدث للأقدم — كل سؤال مع نتيجته النهائية وملفاته في كارت واحد واضح.</div>
      </aside>
    </div>
  )
}

function PermissionCard({ permission, onReply }: { permission: Permission; onReply: (value: "once" | "always" | "reject") => void }) {
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
        <strong>طلب إذن من OpenCode</strong>
        <p>{permission.title}</p>
        {permission.pattern ? <code>{Array.isArray(permission.pattern) ? permission.pattern.join("، ") : permission.pattern}</code> : null}
        <div className="permission-actions">
          <button className="button button-primary" disabled={working} onClick={() => void reply("once")}>سمح مرة واحدة</button>
          <button className="button button-secondary" disabled={working} onClick={() => void reply("always")}>سمح دائمًا</button>
          <button className="button button-ghost" disabled={working} onClick={() => void reply("reject")}>رفض</button>
        </div>
      </div>
    </div>
  )
}

const RECENT_PROJECTS_KEY = "opencode.recentProjects"

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

function useSortedProjects(projects: Project[], query: string, selectedId: string | undefined, recentPaths: string[]): Project[] {
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
      return projectName(a).localeCompare(projectName(b), "ar")
    })
  }, [projects, query, selectedId, recentOrder])

  return sorted
}

function ProjectOptionRows({ items, selectedId, switchingKey, onSelect }: {
  items: Project[]
  selectedId?: string
  switchingKey: string | null
  onSelect: (project: Project) => void
}) {
  return (
    <div className="project-listbox" role="listbox" aria-label="المشاريع">
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
              {isCurrent ? <span className="current-badge">الحالي</span> : null}
              {isSwitching ? <span className="loader small" /> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Dropdown سريع لتبديل المشاريع: زر يعرض الحالي + قائمة منسدلة ببحث فوري
function ProjectDropdown({ projects, selectedId, switchingKey, recentPaths, onSelect, variant }: {
  projects: Project[]
  selectedId?: string
  switchingKey: string | null
  recentPaths: string[]
  onSelect: (project: Project) => void
  variant: "sidebar" | "compact"
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const boxRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const sorted = useSortedProjects(projects, query, selectedId, recentPaths)
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

  const label = switchingKey ? "جارٍ الفتح…" : selected ? projectName(selected) : "اختر المشروع"

  if (variant === "compact") {
    return (
      <div className="project-dropdown project-dropdown-compact" ref={boxRef}>
        <button
          className="project-dropdown-trigger compact-trigger"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="دوس للتبديل بين المشاريع"
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
              placeholder="ابحث باسم المشروع…"
              aria-label="بحث عن مشروع"
            />
            {projects.length === 0 ? (
              <div className="empty-state">لم يتم العثور على مشاريع.</div>
            ) : sorted.length === 0 ? (
              <div className="empty-state">لا توجد نتائج لـ «{query}».</div>
            ) : (
              <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={pick} />
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
        title="دوس للتبديل بين المشاريع"
        disabled={switchingKey !== null}
      >
        <span className="project-switch-icon">📁</span>
        <span><small>المشروع الحالي · تبديل</small><strong>{label}</strong></span>
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
              placeholder="ابحث باسم المشروع…"
              aria-label="بحث عن مشروع"
            />
          ) : null}
          {projects.length === 0 ? (
            <div className="empty-state">لم يتم العثور على مشاريع. افتح مشروعًا من OpenCode أولًا.</div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">لا توجد نتائج لـ «{query}».</div>
          ) : (
            <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={pick} />
          )}
        </div>
      ) : null}
    </div>
  )
}

function ProjectPicker({ projects, selectedId, switchingKey, recentPaths, onSelect, onCancel }: {
  projects: Project[]
  selectedId?: string
  switchingKey: string | null
  recentPaths: string[]
  onSelect: (project: Project) => void
  onCancel?: () => void
}) {
  const [query, setQuery] = useState("")
  const sorted = useSortedProjects(projects, query, selectedId, recentPaths)
  return (
    <main className="project-screen">
      <div className="project-picker">
        <div className="project-picker-header">
          <div className="brand-mark"><img src="/icon.svg" alt="OpenCode" /></div>
          <div className="eyebrow">OpenCode Mobile</div>
          <h1>اختر المشروع</h1>
          <p>اختار من القائمة — الأحدث استخدامًا بيظهر الأول.</p>
        </div>
        <div className="project-dropdown-standalone">
          <input
            className="project-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث باسم المشروع…"
            aria-label="بحث عن مشروع"
          />
          {projects.length === 0 ? (
            <div className="empty-state">لم يتم العثور على مشاريع. افتح مشروعًا من OpenCode أولًا.</div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">لا توجد نتائج لـ «{query}».</div>
          ) : (
            <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={onSelect} />
          )}
        </div>
        {switchingKey ? <div className="picker-loading"><span className="loader" /> جارٍ فتح المشروع…</div> : null}
        {onCancel ? <button className="button button-ghost" onClick={onCancel}>رجوع</button> : null}
      </div>
    </main>
  )
}

function ResultFilesList({ files, sessionId, onToast }: { files: ResultFile[]; sessionId: string; onToast: (message: string, kind?: ToastKind) => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const canShare = typeof navigator.share === "function"

  if (files.length === 0) {
    return null
  }

  const handleDownload = async (file: ResultFile) => {
    setBusyId(file.id)
    try {
      await downloadResultFile(sessionId, file)
      onToast(`بدأ تحميل ${file.name} على الموبايل`, "success")
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "تعذر تحميل الملف", "error")
    } finally {
      setBusyId(null)
    }
  }

  const handleShare = async (file: ResultFile) => {
    setBusyId(file.id)
    try {
      const shared = await shareResultFile(sessionId, file)
      if (shared) {
        onToast("تمت مشاركة الملف", "success")
      } else {
        await handleDownload(file)
      }
    } catch (error: unknown) {
      if (error instanceof Error && /abort|cancel/i.test(error.message)) {
        return
      }
      onToast(error instanceof Error ? error.message : "تعذر مشاركة الملف", "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="result-files">
      <div className="final-result-label">ملفات النتيجة النهائية ({files.length})</div>
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
                فتح
              </a>
              <button
                className="button button-primary"
                disabled={busyId === file.id}
                onClick={() => void handleDownload(file)}
              >
                {busyId === file.id ? "…" : "تحميل"}
              </button>
              {canShare ? (
                <button
                  className="button button-ghost"
                  disabled={busyId === file.id}
                  onClick={() => void handleShare(file)}
                  aria-label={`مشاركة ${file.name}`}
                >
                  مشاركة
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div className="result-files-hint">التحميل يعمل مباشرة على الموبايل، والمشاركة ترسل الملف لأي تطبيق (واتساب، تلجرام، Drive).</div>
    </div>
  )
}

function QuestionCard({ request, sessionId, onAnswered, onToast }: { request: ConversationQuestionRequest; sessionId: string; onAnswered: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
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
        throw new Error("تعذر إرسال الرد")
      }
      onToast("تم إرسال اختيارك إلى OpenCode", "success")
      onAnswered()
    } catch (replyError: unknown) {
      setError(replyError instanceof Error ? replyError.message : "تعذر إرسال الرد")
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
        throw new Error("تعذر رفض السؤال")
      }
      onToast("تم رفض السؤال", "info")
      onAnswered()
    } catch (rejectError: unknown) {
      setError(rejectError instanceof Error ? rejectError.message : "تعذر رفض السؤال")
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="question-card">
      <div className="question-card-top">
        <div><div className="eyebrow">سؤال من OpenCode</div><h3>اختر قبل المتابعة</h3></div>
        <span className="question-count">{request.questions.length > 1 ? `${request.questions.length} أسئلة` : "سؤال واحد"}</span>
      </div>
      {request.questions.map((question, questionIndex) => (
        <div className="question-block" key={`${request.id}:${questionIndex}`}>
          <div className="question-header">{question.header}</div>
          <p className="question-text">{question.question}</p>
          {question.multiple ? <div className="question-hint">يمكن اختيار أكثر من خيار</div> : null}
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
            <label className="question-custom"><span>إجابة مخصصة</span><input value={customDrafts[questionIndex] || ""} onChange={(event) => updateCustomDraft(questionIndex, event.target.value)} placeholder="اكتب إجابتك…" disabled={Boolean(working)} /></label>
          ) : null}
          {question.options.length === 0 && !question.custom ? <div className="empty-state">لا توجد خيارات متاحة.</div> : null}
        </div>
      ))}
      {error ? <div className="form-error">{error}</div> : null}
      <div className="question-actions">
        <button className="button button-primary" disabled={!canReply || Boolean(working)} onClick={() => void submitReply()}>{working === "reply" ? "جارٍ الإرسال…" : "إرسال الاختيار"}</button>
        <button className="button button-ghost" disabled={Boolean(working)} onClick={() => void submitReject()}>{working === "reject" ? "جارٍ الرفض…" : "رفض السؤال"}</button>
      </div>
    </div>
  )
}

function todoPresentation(status: string): { className: string; label: string; mark: string } {
  const normalized = status.toLowerCase().replace(/-/g, "_")
  if (normalized === "completed") {
    return { className: "todo-completed", label: "مكتملة", mark: "✓" }
  }
  if (normalized === "in_progress") {
    return { className: "todo-in_progress", label: "قيد التنفيذ", mark: "◐" }
  }
  if (normalized === "cancelled") {
    return { className: "todo-cancelled", label: "ملغاة", mark: "×" }
  }
  return { className: "todo-pending", label: "متبقية", mark: "○" }
}

function TodoList({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) {
    return null
  }
  return (
    <div className="todo-panel">
      <div className="todo-panel-header">
        <div className="section-title">خطة التنفيذ <span>({todos.length})</span></div>
        <span className="todo-updated-label">تتحدث تلقائيًا</span>
      </div>
      <div className="todo-list">
        {todos.map((todo) => {
          const presentation = todoPresentation(todo.status)
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

function formatElapsed(since: number | undefined, now: number = Date.now()): string {
  if (!since) {
    return ""
  }
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) {
    return `${seconds} ث`
  }
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes} د ${rest} ث` : `${minutes} د`
}

// عدّاد محلي كل ثانية عشان وقت المهمة يمشي حتى لو الـ poll اتأخر
// أو التبويب اتخنق (throttle) — قبل كده الوقت كان بيتحدث فقط مع كل refreshSummary.
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

function TaskSummary({ summary, sessionId, busy, onCopy, onToast }: { summary: SessionSummary | null; sessionId: string | null; busy: boolean; onCopy: (text: string) => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const now = useNowTick(busy && Boolean(summary))
  if (!summary) {
    return null
  }
  const hasTodos = summary.totalTodos > 0
  const progress = hasTodos ? Math.round((summary.completedTodos / summary.totalTodos) * 100) : 0
  const steps = summary.stepsCompleted ?? 0
  const elapsed = busy ? formatElapsed(summary.startedAt, now) : ""
  return (
    <section className={`task-summary ${busy ? "task-running" : "task-finished"}`}>
      <div className="task-summary-top">
        <div><div className="eyebrow">حالة المهمة</div><h2>{busy ? "OpenCode يعمل الآن" : "انتهت المهمة"}</h2></div>
        <span className="task-summary-state">{busy ? "قيد التنفيذ" : "جاهزة"}</span>
      </div>
      {summary.prompt ? <div className="task-request"><span>طلبك</span><p>{summary.prompt}</p></div> : null}
      <div className="task-activity"><span className="activity-pulse" />{summary.activity || (busy ? "OpenCode يعمل على المهمة" : "لا يوجد نشاط جديد")}</div>
      {hasTodos ? (
        <>
          <div className="progress-track"><span style={{ width: `${Math.min(progress, 100)}%` }} /></div>
          <div className="task-stats"><span>{summary.completedTodos}/{summary.totalTodos} خطوة مكتملة</span><span>{summary.updatedAt ? formatTime(summary.updatedAt) : ""}</span></div>
        </>
      ) : busy ? (
        <>
          <div className="progress-track indeterminate" aria-label="جارٍ التنفيذ" />
          <div className="live-stats">
            <span className="live-stat">⚙️ {summary.activeTool || "يجهّز الأدوات…"}</span>
            {steps > 0 ? <span className="live-stat">✅ {steps} {steps === 1 ? "خطوة منفذة" : "خطوات منفذة"}</span> : null}
            {elapsed ? <span className="live-stat live-time">⏱️ {elapsed}</span> : null}
          </div>
        </>
      ) : steps > 0 ? (
        <div className="live-stats finished">
          {steps > 0 ? <span className="live-stat">✅ {steps} {steps === 1 ? "خطوة منفذة" : "خطوات منفذة"}</span> : null}
        </div>
      ) : null}
      <TodoList todos={summary.todos} />
      {summary.finalResult ? <div className="final-result"><div className="final-result-label">النتيجة النهائية</div><div className="final-result-text">{summary.finalResult}</div><button className="copy-result" onClick={() => onCopy(summary.finalResult)}>نسخ النتيجة</button></div> : busy ? <div className="result-pending">ستظهر النتيجة النهائية هنا فور انتهاء المهمة.</div> : null}
      {sessionId && summary.resultFiles && summary.resultFiles.length > 0 ? <ResultFilesList files={summary.resultFiles} sessionId={sessionId} onToast={onToast} /> : null}
      {sessionId && !busy && (!summary.resultFiles || summary.resultFiles.length === 0) && summary.finalResult ? <div className="result-files-hint">لو المهمة أنتجت ملفًا سيظهر هنا للتحميل على الموبايل.</div> : null}
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
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({})
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [composer, setComposer] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
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
  const toastId = useRef(0)
  const prevStatusesRef = useRef<Record<string, SessionStatus>>({})
  // الجلسات اللي المستخدم وقفها بنفسه — منطلعش لها toast إتمام لما تبقى idle
  const abortedRef = useRef<Set<string>>(new Set())
  // لما تبعت سؤال جديد: نخفي خطة السؤال اللي قبله لحد ما المهمة الجديدة تعمل خطتها
  const planClearedRef = useRef<Record<string, boolean>>({})
  // عدّاد الأدوات المنفذة للسؤال الحالي فقط (بنطرح قيمة لحظة الإرسال من الرقم التراكمي بتاع السيرفر)
  const stepsBaselineRef = useRef<Record<string, number>>({})
  const serverStepsRef = useRef<Record<string, number>>({})
  // النتيجة النهائية القديمة مستخبية لحد ما السيرفر يرجع نتيجة مختلفة (بتاعة السؤال الجديد)
  const resultHiddenRef = useRef<Record<string, string>>({})
  const sessionsRef = useRef<Session[]>([])
  sessionsRef.current = sessions
  // Throttle للتحديثات اللحظية عالية التكرار (message.part.updated بييجي مع كل توكن)
  const liveSummaryTimer = useRef<number | null>(null)
  const liveSessionsTimer = useRef<number | null>(null)
  const showHistoryRef = useRef(false)
  showHistoryRef.current = showHistory

  const activeSession = useMemo(() => sessionMatches(sessions, activeId), [sessions, activeId])
  const activeTitle = displayTitle(activeSession?.title)
  const activeStatus = activeId ? statuses[activeId] : undefined
  const isBusy = activeStatus?.type === "busy" || activeStatus?.type === "retry"

  const addToast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++toastId.current
    setToasts((current) => [...current, { id, message, kind }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000)
  }, [])

  const notifyCompletion = useCallback((sessionId: string) => {
    playCompletionSound()
    vibrate([180, 100, 180, 100, 320])
    const match = sessionsRef.current.find((session) => session.id === sessionId)
    const name = match ? displayTitle(match.title) : "المهمة"
    addToast(`خلصت ✅ ${name} — افتح وشوف النتيجة`, "success")
  }, [addToast])

  const notifyAttention = useCallback((message: string) => {
    playAttentionSound()
    vibrate([120, 80, 120])
    addToast(message, "info")
  }, [addToast])

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

  const toggleTheme = () => {
    setTheme((current) => nextTheme(current))
  }

  // لما أي جلسة تتحول من شغالة → خلصت: صوت مميز + اهتزاز + تنبيه
  useEffect(() => {
    const prev = prevStatusesRef.current
    const hadPrev = Object.keys(prev).length > 0
    if (hadPrev) {
      for (const [id, status] of Object.entries(statuses)) {
        const wasBusy = prev[id]?.type === "busy" || prev[id]?.type === "retry"
        if (wasBusy && status.type === "idle") {
          if (abortedRef.current.has(id)) {
            abortedRef.current.delete(id)
            continue
          }
          notifyCompletion(id)
        }
      }
    }
    prevStatusesRef.current = statuses
  }, [statuses, notifyCompletion])

  const refreshSummary = useCallback(async (id = activeIdRef.current) => {
    if (!id) {
      setSummary(null)
      return
    }
    const [nextSummary, nextPermissions] = await Promise.all([getSummary(id), listPermissions()])
    if (activeIdRef.current !== id) {
      return
    }
    serverStepsRef.current[id] = nextSummary.stepsCompleted ?? 0
    const clearedPlan = planClearedRef.current[id] === true
    const stepsBaseline = stepsBaselineRef.current[id] ?? 0
    // النتيجة النهائية للسؤال اللي قبله مستخبية — اظهرها بس لما توصل نتيجة جديدة مختلفة
    let finalResult = nextSummary.finalResult
    if (id in resultHiddenRef.current) {
      if (finalResult === resultHiddenRef.current[id]) {
        finalResult = ""
      } else {
        delete resultHiddenRef.current[id]
      }
    }
    setSummary({
      ...nextSummary,
      finalResult,
      // الخطة القديمة اتمسحت عند إرسال سؤال جديد — متظهرهاش لحد ما تيجي خطة جديدة
      todos: clearedPlan ? [] : nextSummary.todos,
      completedTodos: clearedPlan ? 0 : nextSummary.completedTodos,
      totalTodos: clearedPlan ? 0 : nextSummary.totalTodos,
      // عدّاد الأدوات للسؤال الحالي بس (السيرفر بيرجع تراكمي لكل الجلسة)
      stepsCompleted: Math.max(0, (nextSummary.stepsCompleted ?? 0) - stepsBaseline),
    })
    setStatuses((current) => ({ ...current, [id]: nextSummary.status }))
    setPermissions(nextPermissions)
  }, [])

  const refreshStatuses = useCallback(async () => {
    try {
      const nextStatuses = await getStatuses()
      setStatuses(nextStatuses)
    } catch {
      // Keep last known statuses when the poll fails (offline / reconnecting).
    }
  }, [])

  // المحادثات الشغالة في كل المشاريع — بتتحدث مع نفس poll الحالات
  const refreshActivity = useCallback(async () => {
    try {
      const items = await getActivity()
      setActivity(items)
    } catch {
      // Keep last known activity when the poll fails (offline / reconnecting).
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    const [nextSessions, nextStatuses] = await Promise.all([
      listSessions(),
      getStatuses().catch(() => null),
    ])
    const sorted = [...nextSessions].sort((a, b) => b.time.updated - a.time.updated)
    setSessions(sorted)
    if (nextStatuses) {
      setStatuses(nextStatuses)
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
  }, [])

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
      const sorted = [...nextSessions].sort((a, b) => b.time.updated - a.time.updated)
      // لو جاي من "شغال الآن" روح للمحادثة المطلوبة بدل أول جلسة
      const nextActive = targetSessionId && sorted.some((session) => session.id === targetSessionId)
        ? targetSessionId
        : sorted[0]?.id || null
      setSessions(sorted)
      setStatuses(nextStatuses)
      setActiveId(nextActive)
      activeIdRef.current = nextActive
      setSummary(null)
      setComposer("")
      setShowSessions(false)
      addToast(`اتنقلت لـ ${projectName(result.project)} ✅`, "success")
      await refreshSummary(nextActive)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : "تعذر فتح المشروع", "error")
    } finally {
      setSwitchingProject(null)
    }
  }, [addToast, refreshSummary, selectedProject])

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
          setLoginError(error instanceof Error ? error.message : "تعذر الاتصال بالخادم")
          setAuthState("signedOut")
        }
      })
    return () => {
      mounted = false
    }
  }, [enterApp])

  useEffect(() => {
    activeIdRef.current = activeId
    if (authState === "signedIn" && activeId) {
      void refreshSummary(activeId).catch((error: unknown) => addToast(error instanceof Error ? error.message : "تعذر تحميل المهمة", "error"))
    }
  }, [activeId, authState, addToast, refreshSummary])

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
        addToast(error instanceof Error ? error.message : "تعذر تحميل الموديلات", "error")
      }
    } finally {
      if (!silent) {
        setModelsLoading(false)
      }
    }
  }, [addToast])

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
      const turns = await getHistory(id)
      if (activeIdRef.current !== id) {
        return
      }
      setHistoryTurns(turns)
    } catch (error: unknown) {
      if (activeIdRef.current !== id) {
        return
      }
      setHistoryError(error instanceof Error ? error.message : "تعذر تحميل السجل")
    } finally {
      if (activeIdRef.current === id) {
        setHistoryLoading(false)
      }
    }
  }, [])

  // تحميل سجل المحادثة المنظم كل ما تفتح الدرج أو تتبدل الجلسة
  useEffect(() => {
    if (showHistory && authState === "signedIn" && activeId) {
      void loadHistory()
    }
  }, [showHistory, activeId, authState, loadHistory])

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
    document.title = authState === "signedIn" && selectedProject ? activeTitle : "OpenCode Mobile"
  }, [activeTitle, authState, selectedProject])

  useEffect(() => {
    if (authState !== "signedIn" || !activeId || !isBusy) {
      return
    }
    const timer = window.setInterval(() => {
      void refreshSummary(activeId)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [authState, activeId, isBusy, refreshSummary])

  useEffect(() => {
    if (authState !== "signedIn" || !selectedProject) {
      return
    }
    // Poll all sessions' statuses so the conversation list always shows
    // which chats OpenCode is actively working in, even in background.
    void refreshStatuses()
    void refreshActivity()
    const timer = window.setInterval(() => {
      void refreshStatuses()
      void refreshActivity()
    }, 4000)
    // لما ترجع لتاب اللاب بعد ما كان في الخلفية: حدّث فورًا بدل ما تستنى الـ poll
    // (المتصفح بيخنق الـ timers في التبويبات الخلفية فالوقت كان بيبان واقف).
    // ومعاه حدّث الموديلات بصمت عشان القائمة تعكس المتاح في opencode لحظيًا.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshStatuses()
        void refreshActivity()
        void loadModels(true)
        const id = activeIdRef.current
        if (id) {
          void refreshSummary(id).catch(() => undefined)
        }
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [authState, selectedProject, refreshStatuses, refreshSummary, loadModels, refreshActivity])

  const handleOpenCodeEvent = useCallback((event: ClientEvent) => {
    if (event.type === "session.status") {
      setStatuses((current) => ({ ...current, [event.properties.sessionID]: event.properties.status }))
      // حالة شغل اتغيرت في أي مشروع — حدّث شريط "شغال الآن" فورًا
      void refreshActivity()
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshSummary(event.properties.sessionID)
      }
    }
    if (event.type === "session.idle") {
      setStatuses((current) => ({ ...current, [event.properties.sessionID]: { type: "idle" } }))
      void refreshActivity()
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshSummary(event.properties.sessionID)
      }
    }
    if (event.type === "todo.updated") {
      // وصلت خطة من المهمة — الخطة القديمة الممسوحة اتبدلت بالجديدة
      delete planClearedRef.current[event.properties.sessionID]
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshSummary(event.properties.sessionID)
      }
    }
    if (
      (event.type === "question.asked" || event.type === "question.v2.asked")
    ) {
      notifyAttention("OpenCode بيسألك سؤال — محتاج اختيارك عشان يكمل")
      if (event.properties.sessionID === activeIdRef.current) {
        void refreshSummary(event.properties.sessionID)
      }
    } else if (
      (event.type === "question.replied" || event.type === "question.rejected" || event.type === "question.v2.replied" || event.type === "question.v2.rejected")
      && event.properties.sessionID === activeIdRef.current
    ) {
      void refreshSummary(event.properties.sessionID)
    }
    if (event.type === "permission.updated") {
      setPermissions((current) => [...current.filter((permission) => permission.id !== event.properties.id), event.properties])
      notifyAttention("OpenCode طالب إذن — دوس سماح عشان يكمل شغل")
    }
    if (event.type === "permission.replied") {
      setPermissions((current) => current.filter((permission) => permission.id !== event.properties.permissionID))
    }
    if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
      void refreshSessions()
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
      notifyAttention("المهمة وقفت بخطأ — افتح التطبيق للتفاصيل")
    }
  }, [notifyAttention, refreshSessions, refreshSummary, refreshActivity])

  useEffect(() => {
    if (authState !== "signedIn") {
      return
    }
    const source = new EventSource("/api/events", { withCredentials: true })
    source.addEventListener("ready", () => setEventConnected(true))
    source.addEventListener("opencode", (rawEvent) => {
      try {
        handleOpenCodeEvent(JSON.parse((rawEvent as MessageEvent<string>).data) as ClientEvent)
      } catch {
        addToast("وصل حدث غير معروف من OpenCode", "error")
      }
    })
    source.onerror = () => setEventConnected(false)
    return () => {
      source.close()
      setEventConnected(false)
    }
  }, [authState, addToast, handleOpenCodeEvent])

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
      setLoginError(error instanceof Error ? error.message : "تعذر تسجيل الدخول")
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
    setSummary(null)
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
      setSummary(null)
      setComposer("")
      setShowSessions(false)
      return
    }
    // لو الجلسة الحالية فاضية ومفيهاش أي رسالة: امسحها الأول عشان متتراكمش
    const currentId = activeId
    const currentWasEmpty = isSummaryEmpty(summary)
    if (currentWasEmpty) {
      try {
        await deleteSession(currentId)
      } catch {
        // لو الحذف فشل نكمل للمسودة عادي
      }
      setSessions((current) => current.filter((session) => session.id !== currentId))
      setStatuses((current) => {
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
    setSummary(null)
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
    const prevWasEmpty = prevId && prevId === activeId && isSummaryEmpty(summary)
    if (prevId && prevWasEmpty && prevId !== nextId) {
      try {
        await deleteSession(prevId)
      } catch {
        // تجاهل خطأ الحذف
      }
      setSessions((current) => current.filter((session) => session.id !== prevId))
      setStatuses((current) => {
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
      addToast("المشروع غير موجود في القائمة", "error")
      return
    }
    setJumpingId(item.id)
    try {
      await openProject(project, item.id)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : "تعذر فتح المحادثة", "error")
    } finally {
      setJumpingId(null)
    }
  }

  const startRenamingSession = () => {
    if (!activeSession) {
      return
    }
    setTitleDraft(displayTitle(activeSession.title))
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
      const updated = await renameSession(sessionId, title)
      setSessions((current) => current.map((session) => session.id === updated.id ? updated : session))
      setEditingSessionId(null)
      setTitleDraft("")
      addToast("تم تغيير اسم المحادثة", "success")
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : "تعذر تغيير اسم المحادثة", "error")
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
    if (!window.confirm(`حذف «${displayTitle(session.title)}» وكل رسائلها؟`)) {
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
          setSummary(null)
          setComposer("")
        } else {
          await refreshSummary(next)
        }
      }
      addToast("تم حذف الجلسة", "success")
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : "تعذر حذف الجلسة", "error")
    }
  }

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = composer.trim()
    if (!text || sending || isBusy) {
      return
    }
    setSending(true)
    setComposer("")
    try {
      // لو مسودة جديدة: أنشئ الجلسة مع أول رسالة فقط
      let sessionId = activeIdRef.current
      const isNewSession = !sessionId
      const modelForNewSession = isNewSession ? (pendingModel || currentModel || defaultModel || undefined) : undefined
      if (!sessionId) {
        const created = await createSession(undefined, true)
        sessionId = created.id
        setSessions((current) => [created, ...current])
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
      await sendMessage(sessionId, text, undefined, isNewSession && modelForNewSession ? modelForNewSession : undefined)
      if (isNewSession && modelForNewSession) {
        setCurrentModel(modelForNewSession)
        setPendingModel(null)
      }
      // Optimistic update so a new conversation shows the current request
      // immediately without a manual refresh. The backend flips to busy
      // asynchronously, so the first refreshSummary may still see idle.
      setStatuses((current) => ({ ...current, [sessionId]: { type: "busy" } }))
      // امسح خطوات السؤال اللي قبله (الخطة والعداد) وابدأ العد من جديد للسؤال ده
      planClearedRef.current[sessionId] = true
      stepsBaselineRef.current[sessionId] = serverStepsRef.current[sessionId] ?? 0
      // اخفي النتيجة النهائية القديمة لحد ما توصل نتيجة السؤال الجديد
      resultHiddenRef.current[sessionId] = summary?.finalResult ?? ""
      setSummary((current) => ({
        status: { type: "busy" },
        activity: "OpenCode يعمل على المهمة",
        finalResult: "",
        prompt: text,
        completedTodos: 0,
        totalTodos: 0,
        todos: [],
        questions: current?.questions ?? [],
        updatedAt: Date.now(),
        resultFiles: current?.resultFiles ?? [],
        stepsCompleted: 0,
        activeTool: null,
        startedAt: Date.now(),
      }))
      await refreshSummary(sessionId).catch(() => undefined)
      // Re-assert busy if the backend hasn't flipped yet; delayed refreshes
      // below plus SSE plus polling will correct to the real status.
      setStatuses((current) => {
        const currentStatus = current[sessionId]
        if (!currentStatus || currentStatus.type === "idle") {
          return { ...current, [sessionId]: { type: "busy" } }
        }
        return current
      })
      // The backend names the session based on the first question (like
      // desktop) — refresh the list so the new name appears immediately.
      await refreshSessions().catch(() => undefined)
      // Follow-up refreshes catch the busy transition without manual refresh.
      for (const delay of [1500, 4000, 8000]) {
        window.setTimeout(() => {
          if (activeIdRef.current === sessionId) {
            void refreshSummary(sessionId).catch(() => undefined)
          }
        }, delay)
      }
    } catch (error: unknown) {
      setComposer(text)
      addToast(error instanceof Error ? error.message : "تعذر إرسال الرسالة", "error")
    } finally {
      setSending(false)
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const handleAbort = async () => {
    if (!activeId) {
      return
    }
    const id = activeId
    abortedRef.current.add(id)
    try {
      await abortSession(id)
      // متعمد: مفيش toast عند الإيقاف اليدوي
    } catch (error: unknown) {
      abortedRef.current.delete(id)
      addToast(error instanceof Error ? error.message : "تعذر إيقاف المهمة", "error")
    }
  }

  const handlePermission = async (permission: Permission, response: "once" | "always" | "reject") => {
    try {
      await replyPermission(permission.sessionID, permission.id, response)
      setPermissions((current) => current.filter((item) => item.id !== permission.id))
      addToast(response === "reject" ? "تم رفض الطلب" : "تم السماح بالطلب", "success")
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : "تعذر إرسال رد الإذن", "error")
    }
  }

  const displayedModel: SessionModelRef | null = activeId ? currentModel : (pendingModel || currentModel || defaultModel)

  const handleSelectModel = async (model: ModelInfo) => {
    const ref: SessionModelRef = { providerID: model.providerID, modelID: model.id }
    const sessionId = activeIdRef.current
    // مسودة جديدة: احفظ الاختيار وهيتطبق مع أول رسالة
    if (!sessionId) {
      setPendingModel(ref)
      setCurrentModel(ref)
      setShowModels(false)
      addToast(`هيستخدم ${ref.providerID}/${ref.modelID} (مجاني 🆓) في المحادثة الجديدة`, "success")
      return
    }
    if (isBusy) {
      addToast("استنى المهمة تخلص قبل تغيير الموديل", "info")
      return
    }
    const key = `${ref.providerID}/${ref.modelID}`
    setSwitchingKey(key)
    try {
      const result = await setSessionModel(sessionId, ref)
      setCurrentModel(result.model)
      setShowModels(false)
      addToast(`تم التحويل إلى ${result.model.providerID}/${result.model.modelID} 🆓`, "success")
      await refreshSummary(sessionId).catch(() => undefined)
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : "تعذر تغيير الموديل", "error")
    } finally {
      setSwitchingKey(null)
    }
  }

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text)
    addToast("تم نسخ النتيجة", "success")
  }

  const enablePush = async () => {
    if (!config.push.enabled || !config.push.publicKey) {
      addToast("Web Push غير مُعد على الخادم", "info")
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
      await subscribePush(subscription.toJSON() as Parameters<typeof subscribePush>[0])
      setPushState("enabled")
      addToast("تم تفعيل إشعارات الهاتف", "success")
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : "تعذر تفعيل الإشعارات", "error")
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
      addToast("تم إيقاف إشعارات الهاتف", "info")
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : "تعذر إيقاف الإشعارات", "error")
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
      addToast("تم تفعيل صوت انتهاء المهمة 🔊", "success")
    } else {
      addToast("تم كتم صوت التنبيه", "info")
    }
  }

  const testSound = () => {
    unlockAudio()
    playCompletionSound()
    vibrate([180, 100, 180, 100, 320])
  }

  if (authState === "loading") {
    return <div className="center-screen"><div className="loader" /><p>جارٍ الاتصال بـOpenCode…</p></div>
  }

  if (authState === "signedOut") {
    return (
      <main className="login-screen">
        <div className="login-card">
          <div className="brand-mark"><img src="/icon.svg" alt="OpenCode" /></div>
          <div className="eyebrow">OpenCode Mobile</div>
          <h1>تحكم في مهامك من أي مكان</h1>
          <p className="login-copy">أدخل رمز الوصول الموجود في ملف <code>pwa/.env</code> للاتصال بجهازك.</p>
          <form onSubmit={handleLogin}>
            <label htmlFor="access-token">رمز الوصول</label>
            <input id="access-token" type="password" autoComplete="current-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="••••••••••••••••" required />
            {loginError ? <div className="form-error">{loginError}</div> : null}
            <button className="button button-primary button-wide" disabled={loading}>{loading ? "جارٍ التحقق…" : "دخول آمن"}</button>
          </form>
          <div className="login-footnote"><span className="status-dot offline" /> الاتصال محلي ومشفّر عبر جلسة HttpOnly</div>
          <button className="button button-ghost button-wide" onClick={toggleTheme}>تبديل المظهر — التالي: {THEME_META[nextTheme(theme)].icon} {THEME_META[nextTheme(theme)].label}</button>
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
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showSessions ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand"><span className="brand-mark small"><img src="/icon.svg" alt="OpenCode" /></span><span>OpenCode</span></div>
          <button className="icon-button mobile-only" onClick={() => setShowSessions(false)} aria-label="إغلاق القائمة">×</button>
        </div>
        <ProjectDropdown
          variant="sidebar"
          projects={projects}
          selectedId={selectedProject?.worktree}
          switchingKey={switchingProject}
          recentPaths={recentProjects}
          onSelect={(project) => void openProject(project)}
        />
        <button className="new-session" onClick={() => void handleNewSession()}><span>＋</span> محادثة جديدة</button>
        <div className="session-list">
          {sessions.map((session) => {
            const status = statuses[session.id]
            const working = status?.type === "busy" || status?.type === "retry"
            const needsPermission = !working && permissions.some((permission) => permission.sessionID === session.id)
            return (
              <div className={`session-item ${session.id === activeId ? "active" : ""}${needsPermission ? " needs-permission" : ""}`} key={session.id}>
                <button className="session-select" onClick={() => void selectSession(session.id)}>
                  <span className="session-title-row">
                    <span className="session-title">{displayTitle(session.title)}</span>
                    {needsPermission ? <span className="permission-badge">يحتاج إذن</span> : null}
                  </span>
                  <span className="session-meta"><span className="status-dot" />{formatDate(session.time.updated)} · {formatTime(session.time.updated)}</span>
                </button>
                <button className="session-delete" onClick={() => void handleDeleteSession(session)} aria-label="حذف الجلسة">⌫</button>
              </div>
            )
          })}
        </div>
        <div className="sidebar-bottom">
          <div className="connection-state"><span className={`status-dot ${eventConnected ? "online" : "offline"}`} />{eventConnected ? "متصل مباشرة" : "إعادة الاتصال…"}</div>
          <button className="sidebar-action" onClick={() => setShowSettings(true)}><span>⚙</span> الإعدادات</button>
          <button className="sidebar-action" onClick={() => void handleLogout()}><span>↪</span> تسجيل الخروج</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setShowSessions(true)} aria-label="فتح الجلسات">☰</button>
          <div className="current-session">
            <div className="project-name-badge" title={selectedProject ? projectName(selectedProject) : undefined}>
              <span aria-hidden>📁</span>
              <span className="compact-trigger-name">{switchingProject ? "جارٍ الفتح…" : selectedProject ? projectName(selectedProject) : "—"}</span>
            </div>
            {editingSessionId !== null && editingSessionId === activeId ? (
              <form className="session-title-form" onSubmit={handleRenameSession}>
                <input aria-label="اسم المحادثة" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={handleSessionTitleKeyDown} maxLength={120} required autoFocus disabled={renamingTitle} />
                <button className="title-action" type="submit" disabled={!titleDraft.trim() || renamingTitle} aria-label="حفظ اسم المحادثة">{renamingTitle ? "…" : "✓"}</button>
                <button className="title-action" type="button" onClick={cancelRenamingSession} disabled={renamingTitle} aria-label="إلغاء تغيير الاسم">×</button>
              </form>
            ) : (
              <div className="session-title-row"><h1 title={activeTitle}>{activeTitle}</h1>{activeSession ? <button className="title-edit" onClick={startRenamingSession} aria-label="تغيير اسم المحادثة">✎</button> : null}</div>
            )}
          </div>
          <div className="topbar-actions">
            <button className="model-pill" onClick={() => setShowModels(true)} title="الموديل المستخدم حاليًا — دوس للتغيير (مجاني فقط)">
              <span aria-hidden>🤖</span>
              <span className="model-pill-name" dir="ltr">{modelLabel(displayedModel)}</span>
              <span className="free-badge">FREE</span>
            </button>
            <button className="icon-button activity-button" onClick={() => setShowActivity(true)} aria-label="المحادثات النشطة من كل المشاريع" title="المحادثات النشطة من كل المشاريع ⚡">⚡{activity.length > 0 ? <span className="count-badge">{activity.length}</span> : null}</button>
            <button className="icon-button" onClick={toggleTheme} aria-label={`تبديل المظهر — التالي: ${THEME_META[nextTheme(theme)].label}`} title={`تبديل المظهر — التالي: ${THEME_META[nextTheme(theme)].label}`}>{THEME_META[theme].icon}</button>
            <button className="icon-button" onClick={() => setShowHistory(true)} aria-label="سجل المحادثة والنتائج القديمة" title="سجل المحادثة والنتائج القديمة 🕘">🕘</button>
            <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="الإعدادات">⚙</button>
          </div>
        </header>

        <div className="workspace">
          <div className="workspace-scroll">
            {summary ? <TaskSummary summary={summary} sessionId={activeId} busy={Boolean(isBusy)} onCopy={copyText} onToast={addToast} /> : (
              <div className="welcome-state">
                <div className="welcome-orb"><img src="/icon.svg" alt="OpenCode" /></div>
                <h2>ابدأ مهمة جديدة</h2>
                <p>اكتب طلبك، وسنعرض لك ما يحدث الآن والنتيجة النهائية فقط.</p>
                <div className="suggestions">
                  {["راجع المشروع واذكر أهم المشاكل", "اشرح بنية المشروع ببساطة", "اقترح تحسينات عملية"].map((suggestion) => <button key={suggestion} onClick={() => setComposer(suggestion)}>{suggestion}<span>↗</span></button>)}
                </div>
              </div>
            )}
            {summary && activeId ? summary.questions.filter((question) => question.sessionID === activeId).map((question) => (
              <QuestionCard key={question.id} request={question} sessionId={activeId} onAnswered={() => void refreshSummary(activeId).catch(() => undefined)} onToast={addToast} />
            )) : null}
          </div>

          {permissions.filter((permission) => permission.sessionID === activeId).length > 0 ? (
            <div className="permissions-stack">
              {permissions.filter((permission) => permission.sessionID === activeId).map((permission) => <PermissionCard key={permission.id} permission={permission} onReply={(response) => void handlePermission(permission, response)} />)}
            </div>
          ) : null}

          <div className="composer-wrap">
            <form className="composer" onSubmit={handleSend}>
              <textarea value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="اكتب طلبك…" rows={1} disabled={sending || isBusy} />
              <div className="composer-actions">
                <span className="composer-hint">Enter للإرسال · Shift+Enter لسطر جديد</span>
                {isBusy ? <button type="button" className="stop-button" onClick={() => void handleAbort()}>■ إيقاف</button> : (
                  <button
                    className={`send-button${composer.trim() ? " is-ready" : ""}${sending ? " is-sending" : ""}`}
                    disabled={!composer.trim() || sending}
                    aria-label="إطلاق"
                    title="إطلاق 🚀"
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
                )}
              </div>
            </form>
            <button className="composer-model-line" onClick={() => setShowModels(true)} title="تغيير الموديل">
              <span aria-hidden>🤖</span>
              <span dir="ltr">{modelLabel(displayedModel)}</span>
              <span className="free-badge">FREE 🆓</span>
              <span className="change-link">تغيير</span>
            </button>
          </div>
        </div>
      </main>

      {showActivity ? (
        <ActiveSessionsPanel
          items={activity}
          activeId={activeId}
          jumpingId={jumpingId}
          onJump={(item) => { setShowActivity(false); void jumpToActivitySession(item) }}
          onClose={() => setShowActivity(false)}
        />
      ) : null}
      {showHistory ? (
        <HistoryPanel
          turns={historyTurns}
          loading={historyLoading}
          error={historyError}
          sessionId={activeId}
          onClose={() => setShowHistory(false)}
          onCopy={copyText}
          onRetry={() => void loadHistory()}
        />
      ) : null}
      {showModels ? (
        <ModelPicker
          models={models}
          loading={modelsLoading}
          current={displayedModel}
          busy={isBusy}
          switching={switchingKey}
          onSelect={(model) => void handleSelectModel(model)}
          onRefresh={() => void loadModels()}
          onClose={() => setShowModels(false)}
        />
      ) : null}
      {showSettings ? (
        <div className="drawer-backdrop" onClick={() => setShowSettings(false)}>
          <aside className="drawer settings-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><div className="eyebrow">الإعدادات</div><h2>تفاصيل الاتصال</h2></div><button className="icon-button" onClick={() => setShowSettings(false)} aria-label="إغلاق">×</button></div>
            <div className="settings-list">
              <div className="setting-row"><div><strong>المشروع</strong><small>📁 {projectName(selectedProject)} · بدّله من القائمة المنسدلة فوق</small></div><button className="button button-secondary" onClick={() => setShowSettings(false)}>تمام ✓</button></div>
              <div className="setting-row"><div><strong>OpenCode</strong><small>{config.openCode.version === "connected" ? "متصل" : config.openCode.version}</small></div><span className="status-pill success">متصل</span></div>
              <div className="setting-row"><div><strong>بث الحالة</strong><small>{eventConnected ? "يعمل في الوقت الحقيقي" : "غير متصل"}</small></div><span className={`status-pill ${eventConnected ? "success" : "warning"}`}>{eventConnected ? "نشط" : "غير نشط"}</span></div>
              <div className="setting-row"><div><strong>إشعارات الهاتف</strong><small>{config.secureContext ? "Web Push عبر HTTPS" : "يتطلب HTTPS خارج localhost"}</small></div>{pushState === "enabled" ? <button className="button button-ghost" onClick={() => void disablePush()}>إيقاف</button> : <button className="button button-secondary" onClick={() => void enablePush()}>تفعيل</button>}</div>
              <div className="setting-row setting-row-theme"><div><strong>🌓 المظهر</strong><small>{THEME_META[theme].description}</small></div><div className="theme-picker" role="radiogroup" aria-label="المظهر">{THEMES.map((value) => <button key={value} type="button" role="radio" aria-checked={theme === value} className={`theme-option${theme === value ? " active" : ""}`} onClick={() => setTheme(value)}><span className="theme-option-icon" aria-hidden>{THEME_META[value].icon}</span><span>{THEME_META[value].label}</span></button>)}</div></div>
              <div className="setting-row"><div><strong>🔔 صوت انتهاء المهمة</strong><small>{soundOn ? "صوت لطيف ومميز أول ما يخلص + اهتزاز" : "صامت — مش هتسمع حاجة لما يخلص"}</small></div><div style={{ display: "flex", gap: 6 }}><button className="button button-secondary" onClick={testSound}>جرّب 🔊</button><button className={`button ${soundOn ? "button-ghost" : "button-primary"}`} onClick={toggleSound}>{soundOn ? "كتم" : "تفعيل"}</button></div></div>
              {installPrompt ? <button className="button button-secondary button-wide" onClick={() => void installApp()}>تثبيت التطبيق على الهاتف</button> : null}
              {pushState === "unsupported" ? <div className="info-box">المتصفح لا يدعم Web Push.</div> : null}
              {pushState === "blocked" ? <div className="info-box">الإشعارات محظورة من إعدادات المتصفح.</div> : null}
              {!config.secureContext ? <div className="warning-box">لتثبيت PWA وتفعيل Web Push على الموبايل، شغّل التطبيق عبر HTTPS أو استخدمه من localhost.</div> : null}
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
