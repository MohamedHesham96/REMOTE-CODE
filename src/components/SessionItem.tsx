import { memo, useCallback, useMemo, type RefObject } from "react"
import { displayTitle, formatDateTime, formatRelative, statusLabel } from "../display"
import type { Language, Strings } from "../i18n"
import type { Session, SessionStatus } from "../types"

interface SessionItemProps {
  session: Session
  working: boolean
  selected: boolean
  pinned: boolean
  needsPermission: boolean
  status: SessionStatus | undefined
  // ref للعنصر المختار بس (scrollIntoView لما يتغير الاختيار). الـ ref
  // الواحد بيتشارك بين كل العناصر: العنصر المختار يحط العنصر في الـ ref،
  // العنصر غير المختار يمسحه (null). ده بيخلّي الـ ref props مجرد object
  // ref ثابت عبر الرندرات ومش بيمنع الـ memo من الـ bail-out.
  activeItemRef: RefObject<HTMLDivElement | null>
  onSelect: (id: string) => void
  onTogglePin: (session: Session) => void
  onDelete: (session: Session) => void
  t: Strings
  lang: Language
}

// صف محادثة واحد في القائمة الجانبية. مفصول عن App كومبوننت memoized
// عشان أي تغيير في حالة شقيقة (toasts, models, lang, إلخ) ما يعيدش رسم
// كل صف في السايدبار — كان كل صف بيتعاد رسمه مع كل setState في App
// (الـ parent عنده 50+ state slot)، فمع عشرات الجلسات تكلفة الـ DOM
// reconciliation كانت مرتفعة جدًا على الموبايل.
//
// لافتة: `formatRelative` بتبني `Intl.RelativeTimeFormat` جديد لو النسخة
// فوق الساعة مش ↔ دقيقة (المسارين التانيين كاش). القائمة بتعرض عشرات الصفوف
// في كل رسم، فبنحسب النص مرة واحدة لكل صف عبر memo مفتاحه الوقت واللغة —
// نفس القيمة اللي كانت بتتحسب في الـ render، من غير بناء Intl متكرر للصفوف
// اللي وقتها ما اتغيّرش.
function SessionItemInner({
  session,
  working,
  selected,
  pinned,
  needsPermission,
  status,
  activeItemRef,
  onSelect,
  onTogglePin,
  onDelete,
  t,
  lang,
}: SessionItemProps) {
  const handleSelect = useCallback(() => onSelect(session.id), [onSelect, session.id])
  const handleDelete = useCallback(() => onDelete(session), [onDelete, session])
  const handleTogglePin = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onTogglePin(session)
  }, [onTogglePin, session])
  const pinLabel = pinned ? t.unpinConversation : t.pinConversation
  const className = `session-item${working ? " is-working" : ""}${pinned ? " is-pinned" : ""}${selected ? " active" : ""}${needsPermission ? " needs-permission" : ""}`
  const created = session.time.created
  const relative = useMemo(() => formatRelative(created, lang), [created, lang])
  return (
    <div
      ref={selected ? activeItemRef : undefined}
      className={className}
    >
      <button className="session-select" onClick={handleSelect} aria-current={selected ? "true" : undefined}>
        <span className="session-title-row">
          <span className="session-title">{displayTitle(session.title, t)}</span>
          {needsPermission ? <span className="permission-badge">{t.needsPermission}</span> : null}
        </span>
        <span className="session-meta">
          {working ? <span className="working-spinner" aria-hidden /> : <span className="status-dot" aria-hidden />}
          <span className="session-status">{statusLabel(status, t)}</span>
          <span className="session-meta-dot" aria-hidden />
          <span className="session-time" title={formatDateTime(session.time.created, lang)}>{relative}</span>
        </span>
      </button>
      <button
        className={`session-pin${pinned ? " is-on" : ""}`}
        onClick={handleTogglePin}
        aria-pressed={pinned}
        aria-label={pinLabel}
        title={pinLabel}
      >
        <span className={pinned ? "pin-on" : "pin-off"} aria-hidden>📌</span>
      </button>
      <button className="session-delete" onClick={handleDelete} aria-label={t.deleteSession}>⌫</button>
    </div>
  )
}

export const SessionItem = memo(SessionItemInner)
