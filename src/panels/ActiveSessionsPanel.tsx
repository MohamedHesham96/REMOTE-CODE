import { useCallback, useMemo } from "react"
import { displayTitle, formatCountdown, formatDateTime, statusLabel } from "../display"
import type { Language, Strings } from "../i18n"
import type { ActiveSession } from "../types"

export function ActiveSessionsPanel({ items, recent, graceLeft, activeId, jumpingId, onJump, onClose, t, lang }: {
  items: ActiveSession[]
  recent: ActiveSession[]
  graceLeft: (id: string) => number
  activeId: string | null
  jumpingId: string | null
  onJump: (item: ActiveSession) => void
  onClose: () => void
  t: Strings
  lang: Language
}) {
  const groupByProject = useCallback((list: ActiveSession[]) => {
    const map = new Map<string, ActiveSession[]>()
    for (const item of list) {
      const bucket = map.get(item.projectName) || []
      bucket.push(item)
      map.set(item.projectName, bucket)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [])

  const grouped = useMemo(() => groupByProject(items), [groupByProject, items])
  const recentGrouped = useMemo(() => groupByProject(recent), [groupByProject, recent])

  const renderRow = (item: ActiveSession, working: boolean) => {
    const isCurrent = item.id === activeId
    const left = graceLeft(item.id)
    const body = (
      <>
        {working ? <span className="working-spinner" aria-hidden /> : <span className="status-dot" aria-hidden />}
        <span className="activity-row-body">
          <strong>{displayTitle(item.title, t)}</strong>
          <small>
            {working ? statusLabel(item.status, t) : t.activeRecently}
            {' · '}
            {formatDateTime(item.updatedAt, lang)}
            {!working && left > 0 ? <> · <span className="session-grace-timer">{formatCountdown(left)}</span></> : null}
          </small>
        </span>
        {isCurrent ? <span className="current-badge">{t.currentBadge} ✓</span> : null}
      </>
    )
    if (isCurrent) {
      return <div className={`activity-row ${working ? "" : "activity-row-recent"}`} key={item.id}>{body}</div>
    }
    return (
      <button
        type="button"
        className={`activity-row activity-row-tap ${working ? "" : "activity-row-recent"}`}
        key={item.id}
        disabled={jumpingId !== null}
        onClick={() => onJump(item)}
      >
        {body}
      </button>
    )
  }

  const renderProjectGroups = (entries: [string, ActiveSession[]][], working: boolean) => entries.map(([projectName, group]) => (
    <section className="activity-group" key={projectName}>
      <div className="activity-group-header">
        <span className="activity-group-icon" aria-hidden>📁</span>
        <strong>{projectName}</strong>
        <span className="activity-group-count">{group.length}</span>
      </div>
      {group.map((item) => renderRow(item, working))}
    </section>
  ))

  const empty = items.length === 0 && recent.length === 0

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer activity-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">⚡ {t.activeNow} · {items.length > 0 ? `${items.length} ${items.length === 1 ? t.conversation : t.conversations}` : t.none} · {t.allProjects}</div>
            <h2>{t.activeConversations}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {empty ? (
          <div className="empty-state">{t.noActiveConversations}</div>
        ) : (
          <div className="activity-groups">
            {grouped.length > 0 ? (
              <div className="activity-section" aria-label={t.activeNow}>
                <div className="activity-section-header">
                  <strong><span aria-hidden>⚡</span> {t.activeNow}</strong>
                  <span className="activity-section-count" aria-label={`${items.length} ${t.conversations}`}>{items.length}</span>
                </div>
                {renderProjectGroups(grouped, true)}
              </div>
            ) : null}
            {recentGrouped.length > 0 ? (
              <div className="activity-section" aria-label={t.recentlyActiveConversations}>
                <div className="activity-section-header">
                  <strong><span aria-hidden>⏳</span> {t.activeRecently}</strong>
                  <span className="activity-section-count" aria-label={`${recent.length} ${t.conversations}`}>{recent.length}</span>
                </div>
                {renderProjectGroups(recentGrouped, false)}
              </div>
            ) : null}
          </div>
        )}
        <div className="model-footnote">{t.activityLiveNote}</div>
      </aside>
    </div>
  )
}
