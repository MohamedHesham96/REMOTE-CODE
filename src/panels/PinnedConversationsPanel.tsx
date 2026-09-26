import { useMemo } from "react"
import { displayTitle, formatDate, formatTime, statusLabel } from "../display"
import type { Language, Strings } from "../i18n"
import type { PinnedConversation, SessionStatus } from "../types"

// قائمة جانبية بالمحادثات المثبتة في كل المشاريع (مش المشروع الحالي بس):
// فتح أي مثبّتة — حتى لو في مشروع تاني، والوقت ده الـ App هو اللي بيعمل
// تبديل المشروع — وإلغاء تثبيتها من مكان واحد. التثبيت نفسه بيتم من صف
// المحادثة في القائمة الجانبية.
export function PinnedConversationsPanel({
  pins,
  activeId,
  activeWorktree,
  statuses,
  onSelect,
  onUnpin,
  onClose,
  t,
  lang,
}: {
  pins: PinnedConversation[]
  activeId: string | null
  activeWorktree: string | null
  statuses: Record<string, SessionStatus>
  onSelect: (pin: PinnedConversation) => void
  onUnpin: (pin: PinnedConversation) => void
  onClose: () => void
  t: Strings
  lang: Language
}) {
  // تجميع حسب المشروع: المثبّتات بتفضل مرتّبة "الأحدث تثبيتًا أولًا" جوه كل
  // مشروع، والمشاريع نفسها بأكبر عدد أولًا. المشاريع الفاضية بتتخطى عشان
  // ما نعرضش مجموعة كلها "محادثة بدون مشروع".
  const groups = useMemo(() => {
    const byProject = new Map<string, PinnedConversation[]>()
    for (const pin of pins) {
      const key = pin.worktree || pin.directory || pin.id
      const bucket = byProject.get(key)
      if (bucket) {
        bucket.push(pin)
      } else {
        byProject.set(key, [pin])
      }
    }
    return [...byProject.values()].sort((left, right) => right.length - left.length)
  }, [pins])

  const sameProject = (pin: PinnedConversation): boolean => Boolean(
    activeWorktree
    && (pathKey(pin.worktree) === pathKey(activeWorktree) || pathKey(pin.directory) === pathKey(activeWorktree)),
  )

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer pinned-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">
              📌 {t.pinnedConversations} · {pins.length > 0
                ? `${pins.length} ${pins.length === 1 ? t.conversation : t.conversations}`
                : t.pinnedEmpty} · {t.allProjects}
            </div>
            <h2>{t.pinnedConversations}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {pins.length === 0 ? (
          <div className="empty-state">{t.noPinnedConversations}</div>
        ) : (
          <div className="pinned-groups">
            {groups.map((group) => {
              const projectName = group[0]?.projectName
              const outside = group.filter((pin) => !sameProject(pin)).length
              return (
                <section className="pinned-group" key={group[0]?.worktree || group[0]?.directory || group[0]?.id}>
                  <div className="pinned-group-header">
                    <span className="pinned-group-icon" aria-hidden>📁</span>
                    <strong>{projectName || t.unknownProject}</strong>
                    <span className="pinned-group-count">{group.length}</span>
                    {outside > 0 ? <span className="pinned-group-note">{outside} {t.inOtherProjects}</span> : null}
                  </div>
                  <div className="pinned-list">
                    {group.map((pin) => {
                      const isCurrent = pin.id === activeId
                      return (
                        <div className={`pinned-item${isCurrent ? " active" : ""}`} key={pin.id}>
                          <button
                            className="pinned-select"
                            onClick={() => onSelect(pin)}
                            aria-current={isCurrent ? "true" : undefined}
                          >
                            <span className="pinned-title-row">
                              <span className="pin-badge" aria-hidden>📌</span>
                              <span className="pinned-title">{displayTitle(pin.title, t)}</span>
                              {isCurrent ? <span className="current-badge">{t.currentBadge}</span> : null}
                            </span>
                            <span className="pinned-meta">
                              <span className="status-dot" aria-hidden />
                              <span>{statusLabel(statuses[pin.id], t)}</span>
                              <span aria-hidden>·</span>
                              <span>{formatDate(pin.created, lang)} · {formatTime(pin.created, lang)}</span>
                              {!sameProject(pin) ? (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="pinned-project-tag">{t.switchToProject}</span>
                                </>
                              ) : null}
                            </span>
                          </button>
                          <button
                            className="pinned-unpin"
                            onClick={(event) => { event.stopPropagation(); onUnpin(pin) }}
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
                </section>
              )
            })}
          </div>
        )}
        <div className="model-footnote">{t.pinnedNote}</div>
      </aside>
    </div>
  )
}

// نفس تطبيع المسار في server/opencode/utils.ts directoryKey عشان المقارنة بين
// مسار محفوظ من جهاز/path separator تاني ما تبقاش مختلفة
function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
}
