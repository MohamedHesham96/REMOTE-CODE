import { displayTitle, formatDate, formatTime, statusLabel } from "../display"
import type { Language, Strings } from "../i18n"
import type { Session, SessionStatus } from "../types"

// قائمة جانبية بالمحادثات المثبتة: فتح أي مثبّتة وإلغاء تثبيتها من مكان واحد.
// بتاخد الجلسات مرتّبة بالفعل (الأحدث تثبيتًا أولًا) من App فبتعرض نفس ترتيب
// القائمة الجانبية بالظبط. التثبيت نفسه بيتم من صف المحادثة في القائمة الجانبية.
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
            <div className="eyebrow">
              {t.pinnedConversations} · {sessions.length > 0
                ? `${sessions.length} ${sessions.length === 1 ? t.conversation : t.conversations}`
                : t.pinnedEmpty}
            </div>
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
                <div className={`pinned-item${isCurrent ? " active" : ""}`} key={session.id}>
                  <button
                    className="pinned-select"
                    onClick={() => onSelect(session)}
                    aria-current={isCurrent ? "true" : undefined}
                  >
                    <span className="pinned-title-row">
                      <span className="pin-badge" aria-hidden>📌</span>
                      <span className="pinned-title">{displayTitle(session.title, t)}</span>
                      {isCurrent ? <span className="current-badge">{t.currentBadge}</span> : null}
                    </span>
                    <span className="pinned-meta">
                      <span className="status-dot" aria-hidden />
                      <span>{statusLabel(statuses[session.id], t)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(session.time.created, lang)} · {formatTime(session.time.created, lang)}</span>
                    </span>
                  </button>
                  <button
                    className="pinned-unpin"
                    onClick={(event) => { event.stopPropagation(); onUnpin(session) }}
                    aria-pressed="true"
                    aria-label={t.unpinConversation}
                    title={t.unpinConversation}
                  >
                    <span aria-hidden>📌</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="model-footnote">{t.pinnedNote}</div>
      </aside>
    </div>
  )
}
