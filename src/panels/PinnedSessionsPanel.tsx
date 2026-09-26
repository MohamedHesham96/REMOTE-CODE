import { useMemo } from "react"
import { displayTitle, formatDate, formatTime, statusLabel } from "../display"
import type { Language, Strings } from "../i18n"
import type { Session, SessionStatus } from "../types"

export function PinnedSessionsPanel({
  sessions,
  activeId,
  statuses,
  onSelect,
  onUnpin,
  onClose,
  t,
  lang,
}: {
  sessions: Session[]
  activeId: string | null
  statuses: Record<string, SessionStatus>
  onSelect: (session: Session) => void
  onUnpin: (session: Session) => void
  onClose: () => void
  t: Strings
  lang: Language
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer pinned-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">{t.pinnedConversations} · {sessions.length > 0 ? `${sessions.length} ${sessions.length === 1 ? t.conversation : t.conversations}` : t.noPinnedConversations}</div>
            <h2>{t.pinnedConversations} 📌</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {sessions.length === 0 ? (
          <div className="empty-state">{t.noPinnedConversations}</div>
        ) : (
          <div className="pinned-list">
            {sessions.map((session) => {
              const isCurrent = session.id === activeId
              return (
                <div className={`pinned-item ${isCurrent ? "active" : ""}`} key={session.id}>
                  <button className="pinned-select" onClick={() => onSelect(session)}>
                    <span className="pinned-title-row">
                      <span className="pinned-title" dir={lang === "ar" ? "rtl" : "ltr"}>{displayTitle(session.title, t)}</span>
                    </span>
                    <span className="pinned-meta">
                      <span className="status-dot" aria-hidden />
                      <span>{statusLabel(statuses[session.id], t)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(session.time.created, lang)} · {formatTime(session.time.created, lang)}</span>
                    </span>
                    {isCurrent && <span className="current-badge">{t.currentBadge} ✓</span>}
                  </button>
                  <button className="pinned-unpin" onClick={(e) => { e.stopPropagation(); onUnpin(session) }} aria-label={t.unpinConversation} title={t.unpinConversation}>📌</button>
                </div>
              )
            })}
          </div>
        )}
      </aside>
    </div>
  )
}