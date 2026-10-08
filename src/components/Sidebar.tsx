import { memo, useCallback, type RefObject } from "react"
import { ProjectDropdown } from "./projects/ProjectPicker"
import { SessionItem } from "./SessionItem"
import type { Language } from "../i18n"
import type { Strings } from "../i18n"
import type { Project, Session as SessionModel } from "../types"
import type { ProjectSummary } from "../utils/project-summary"

interface SidebarProps {
  showSessions: boolean
  onClose: () => void
  eventConnected: boolean
  projects: Project[]
  // ملخصات المشاريع (شغّال/محتاج انتباه/عدد المحادثات) — بتتحسب في App من
  // الحالات الحية الموجودة أصلًا وبتظهر جنب اسم كل مشروع في القائمة
  summaries: ReadonlyMap<string, ProjectSummary>
  selectedProject: Project | null
  switchingProject: string | null
  recentProjects: string[]
  onSelectProject: (project: Project) => void
  onNewSession: () => void
  // آخر إصدار ظاهر تحت اسم المشروع مباشرة في السايدبار.
  latestVersion: string
  onShowReleases: () => void
  sessionsCount: number
  activeSessionsCount: number
  inactiveSessionsCount: number
  // العناصر بنمرّرها كـ props (مش بنحسبها هنا) عشان الـ memo يشتغل صح على
  // الـ App: بنخلي حساب القوائم في الـ parent (اللي عنده الـ sources الأصلية).
  activeSessions: SessionModel[]
  inactiveSessions: SessionModel[]
  activeId: string | null
  isPinned: (id: string) => boolean
  permissionSessionIds: ReadonlySet<string>
  statuses: Record<string, import("../types").SessionStatus>
  activeSessionItemRef: RefObject<HTMLDivElement | null>
  onSelectSession: (id: string) => void
  onTogglePin: (session: SessionModel) => void
  onDeleteSession: (session: SessionModel) => void
  t: Strings
  lang: Language
}

// السايدبار مفصول كومبوننت memoized عشان أي تغيير في حالة شقيقة (toasts,
// models, الـ composer، الـ active SSE connections، إلخ) ما يعيدش رسم
// الـ sidebar وشجرته كلها (dropdown + قائمة مثبّتات + scopes طويلة من
// الـ SessionItem). الـ parent عنده 50+ state slot، فبدون ده السايدبار
// كان بيعيد الرسم في كل setState — وكمان الـ SessionItem الداخلية
// بتبطل تعمل bail-out لأن الـ parent هو اللي بيرسمها.
function SidebarInner({
  showSessions,
  onClose,
  eventConnected,
  projects,
  summaries,
  selectedProject,
  switchingProject,
  recentProjects,
  onSelectProject,
  onNewSession,
  latestVersion,
  onShowReleases,
  sessionsCount,
  activeSessionsCount,
  inactiveSessionsCount,
  activeSessions,
  inactiveSessions,
  activeId,
  isPinned,
  permissionSessionIds,
  statuses,
  activeSessionItemRef,
  onSelectSession,
  onTogglePin,
  onDeleteSession,
  t,
  lang,
}: SidebarProps) {
  const handleClose = useCallback(() => onClose(), [onClose])
  const handleSelectProject = useCallback((project: Project) => onSelectProject(project), [onSelectProject])
  const handleNewSession = useCallback(() => onNewSession(), [onNewSession])
  const handleSelectSession = useCallback((id: string) => onSelectSession(id), [onSelectSession])
  const handleTogglePin = useCallback((session: SessionModel) => onTogglePin(session), [onTogglePin])
  const handleDeleteSession = useCallback((session: SessionModel) => onDeleteSession(session), [onDeleteSession])
  return (
    <aside className={`sidebar ${showSessions ? "sidebar-open" : ""}`}>
      <div className="sidebar-top">
        {/* اللوجو جنب الاسم، والإصدار تحت الاسم على طول: كلهم محاذيين لعمود
            اللوجو. النقر على الإصدار بيفتح ملاحظات الإصدار. */}
        <div className="brand">
          <span className="brand-mark small"><img src="/icon.svg" alt="RemoteCode" /></span>
          <div className="brand-text">
            <span className="brand-name">RemoteCode</span>
            {latestVersion ? (
              <button type="button" className="sidebar-version" onClick={() => onShowReleases()} title={`${t.releaseNotesAria} 🚀`} aria-label={`${t.appVersionLabel} ${latestVersion} — ${t.releaseNotesAria}`}>
                <span className="sidebar-version-label">{t.appVersionLabel}</span>
                <span className="sidebar-version-value" dir="ltr">{latestVersion}</span>
              </button>
            ) : null}
          </div>
        </div>
        <button className="icon-button mobile-only" onClick={handleClose} aria-label={t.closeMenu}>×</button>
      </div>
      <div className="connection-state" role="status">
        <span className={`status-dot ${eventConnected ? "online" : "offline"}`} />
        <span className="connection-label">{eventConnected ? t.connectedLive : t.reconnecting}</span>
      </div>
      <ProjectDropdown
        projects={projects}
        selectedId={selectedProject?.worktree}
        switchingKey={switchingProject}
        recentPaths={recentProjects}
        summaries={summaries}
        onSelect={handleSelectProject}
        t={t}
        lang={lang}
      />
      <button className="new-session" onClick={handleNewSession}><span>＋</span> {t.newConversation}</button>
      <div className="session-list">
        {sessionsCount === 0 ? (
          <div className="empty-state">{t.noSessionsYet}</div>
        ) : (
          <>
            {activeSessionsCount > 0 ? (
              <section className="session-group" aria-label={t.activeConversations}>
                <div className="session-group-header">
                  <span className="session-group-title"><span aria-hidden>⚡</span> {t.active}</span>
                  <span className="session-group-count" aria-label={`${activeSessionsCount} ${activeSessionsCount === 1 ? t.conversation : t.conversations}`}>{activeSessionsCount}</span>
                </div>
                {activeSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    working
                    selected={session.id === activeId}
                    pinned={isPinned(session.id)}
                    needsPermission={permissionSessionIds.has(session.id)}
                    status={statuses[session.id]}
                    activeItemRef={activeSessionItemRef}
                    onSelect={handleSelectSession}
                    onTogglePin={handleTogglePin}
                    onDelete={handleDeleteSession}
                    t={t}
                    lang={lang}
                  />
                ))}
              </section>
            ) : null}
            <section className="session-group" aria-label={t.inactiveConversations}>
              <div className="session-group-header">
                <span className="session-group-title"><span aria-hidden>💤</span> {t.inactive}</span>
                <span className="session-group-count" aria-label={`${inactiveSessionsCount} ${inactiveSessionsCount === 1 ? t.conversation : t.conversations}`}>{inactiveSessionsCount}</span>
              </div>
              {inactiveSessionsCount === 0 ? (
                <div className="session-group-empty">{t.noInactiveConversations}</div>
              ) : (
                inactiveSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    working={false}
                    selected={session.id === activeId}
                    pinned={isPinned(session.id)}
                    needsPermission={permissionSessionIds.has(session.id)}
                    status={statuses[session.id]}
                    activeItemRef={activeSessionItemRef}
                    onSelect={handleSelectSession}
                    onTogglePin={handleTogglePin}
                    onDelete={handleDeleteSession}
                    t={t}
                    lang={lang}
                  />
                ))
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

export const Sidebar = memo(SidebarInner)