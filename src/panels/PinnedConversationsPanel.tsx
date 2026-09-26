import { displayTitle, formatDate, formatTime, statusLabel } from "../display"
import type { Language, Strings } from "../i18n"
import type { PinnedConversation, SessionStatus } from "../types"

// قائمة جانبية بمحادثات المشروع المفتوح المثبّتة: التثبيت بيتم من صف
// المحادثة في القائمة الجانبية، والمخزّن على السيرفر (فبيبان في كل الأجهزة
// وكل الجلسات). Pins تبع كل مشروع مستقلّة تمامًا — فلو مشروع تاني عنده مثبّتات
// مش بتبان هنا، وبتبان أول ما تبدّل المشروع. فتح أي مثبّتة والضغط على الدبوس
// جنبها للترفض.
export function PinnedConversationsPanel({
  pins,
  activeId,
  projectName,
  statuses,
  onSelect,
  onUnpin,
  onClose,
  t,
  lang,
}: {
  // مثبّتات المشروع الحالي بس — الفلترة بيحصلها hook المثبّتات بمعرّف
  // المشروع الثابت (المسار المطبّع)، مش بالـ id.
  pins: PinnedConversation[]
  activeId: string | null
  projectName: string
  statuses: Record<string, SessionStatus>
  onSelect: (pin: PinnedConversation) => void
  onUnpin: (pin: PinnedConversation) => void
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
              📌 {t.pinnedConversations} · {pins.length > 0
                ? `${pins.length} ${pins.length === 1 ? t.conversation : t.conversations}`
                : t.pinnedEmpty} · {projectName || t.unknownProject}
            </div>
            <h2>{t.pinnedConversations}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {pins.length === 0 ? (
          <div className="empty-state">{t.noPinnedConversations}</div>
        ) : (
          <div className="pinned-groups">
            <section className="pinned-group">
              <div className="pinned-group-header">
                <span className="pinned-group-icon" aria-hidden>📁</span>
                <strong>{projectName || t.unknownProject}</strong>
                <span className="pinned-group-count">{pins.length}</span>
              </div>
              <div className="pinned-list">
                {pins.map((pin) => {
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
          </div>
        )}
        <div className="model-footnote">{t.pinnedNote}</div>
      </aside>
    </div>
  )
}
