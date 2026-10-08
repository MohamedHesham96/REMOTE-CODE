import { formatElapsed } from "../../display"
import type { Strings } from "../../i18n"
import type { RequestState, SessionRequest, ToastKind } from "../../types"
import { useNowTick } from "../../hooks/useNowTick"
import { ResultFilesList } from "./ResultFilesList"
import { RequestAttachmentsList } from "./RequestAttachmentsList"
import { TaskStatusPanel } from "./TaskStatusPanel"
import { CopyButton } from "../CopyButton"
import { MarkdownText } from "../MarkdownText"
import { describeRequest } from "../../utils/task-status"
import { parseMarkdownBlocks } from "../../utils/markdown-table"
import { memo, useCallback, useMemo, useState, type ReactNode } from "react"
import { tailPreview } from "../../utils/preview"

const REQUEST_STATE_LABEL: Record<RequestState, keyof Strings> = {
  queued: "inQueue",
  running: "running",
  done: "done",
  stopped: "stopped",
  skipped: "skipped",
}

// كل طلب في المحادثة بيتعرض كسطر واحد جوه كارت واحد، زي قائمة المهام.
const REQUEST_STATE_ROW: Record<RequestState, string> = {
  queued: "request-row-queued",
  running: "request-row-running",
  done: "request-row-done",
  stopped: "request-row-stopped",
  skipped: "request-row-skipped",
}

const REQUEST_STATE_MARK: Record<RequestState, string> = {
  queued: "⋯",
  running: "◐",
  done: "✓",
  stopped: "×",
  skipped: "⏭",
}

// سقف الأحرف اللي بعدها النص أكيد أطول من ٦ أسطر بصرية على الموبايل —
// القصّ بعدد `\n` وحده كان يفشل مع الفقرات الطويلة بلا فواصل أسطر،
// فكانت "النتيجة النهائية" تظهر كاملة بلا زر "عرض كامل".
const COLLAPSED_CHAR_BUDGET = 400

// `trailing` يتلزق آخر النص وقبل زرار "عرض كامل"، عشان مؤشّر الكتابة
// يبان في مكانه الصح بدل ما يقف ورا الزرار.
//
// `fromEnd` بيقلب المطوي: بدل ما يعرض أول النص، بيعرض آخره. مستخدم في
// "النتيجة النهائية" عشان الخلاصة تبان من غير "عرض كامل".
//
// `rich`: يشغّل عرض جداول ماركداون كجداول حقيقية (النتيجة النهائية والنص
// المباشر). بنعرضها "غنية" في الحالة الكاملة بس؛ وهي مطويّة بنرجع للنص الخام
// لأن القصّ البصري line-clamp على حاوية -webkit-box ما بيقصش صفوف جدول، ولأن
// tailPreview بيشتغل على النص الخام أصلًا.
//
// memo: بيتنادى ٣ مرات في كل صف (prompt, liveResult, finalResult). مع
// `useNowTick` اللي بيوقظ الكارت كل ثانية، من غير memo كان بيتعاد حساب
// `text.split("\n")` و`tailPreview` في كل مرة حتى لو النص ما اتغيّرش.
const ExpandableText = memo(function ExpandableText({ text, maxLines = 6, className = "", trailing = null, fromEnd = false, rich = false, t }: { text: string; maxLines?: number; className?: string; trailing?: ReactNode; fromEnd?: boolean; rich?: boolean; t: Strings }) {
  const [isExpanded, setIsExpanded] = useState(false)
  // الكسر (split/طول/سقف) بيتحسب مرة واحدة على أول رندر، وبعدها النصوص
  // المطوية بتتجمد طالما `text` نفسه ما اتغيّرش — ده اللي بيخلّي memo يشتغل.
  const collapse = useMemo(() => {
    const lines = text.split("\n")
    const shouldTruncate = lines.length > maxLines || text.length > COLLAPSED_CHAR_BUDGET
    if (!shouldTruncate) {
      return null
    }
    // الرد اللي فيه جدول ماركداون ما بنقصّوش نصيًا: القصّ بيسيب صفوف الجدول
    // خام ("| a | b |") وده بالظبط اللي عايزين نمنعه. صندوق النتيجة بيسكول
    // لوحده (max-height) في الحالتين، فالجدول بيبان مرتّب من غير "عرض كامل".
    if (rich && parseMarkdownBlocks(text).some((block) => block.kind === "table")) {
      return null
    }
    return {
      shouldTruncate: true as const,
      // من الآخر الجزء المعروض أصلاً هو الآخر، فمفيش line-clamp: لو اتطبّق هيقص
      // من أول الجزء ويعرض عكس المطلوب.
      clamp: !fromEnd,
      collapsed: fromEnd
        ? "…" + tailPreview(text, maxLines, COLLAPSED_CHAR_BUDGET)
        : lines.slice(0, maxLines).join("\n") + "…",
    }
  }, [text, maxLines, fromEnd, rich])
  const toggle = useCallback(() => setIsExpanded((current) => !current), [])

  if (collapse === null) {
    return <span className={className}>{rich ? <MarkdownText text={text} /> : text}{trailing}</span>
  }

  const displayText = isExpanded ? text : collapse.collapsed

  return (
    <span className={className}>
      <span
        className={!isExpanded && collapse.clamp ? "expandable-body is-collapsed" : "expandable-body"}
        style={!isExpanded && collapse.clamp ? { WebkitLineClamp: maxLines, lineClamp: maxLines } : undefined}
      >
        {isExpanded && rich ? <MarkdownText text={text} /> : displayText}
        {trailing}
      </span>
      <button
        type="button"
        className="expand-toggle"
        onClick={(e) => { e.stopPropagation(); toggle() }}
        aria-expanded={isExpanded}
      >
        {isExpanded ? t.showLess : t.showMore}
      </button>
    </span>
  )
})

// memo: كل صف في كارت المحادثة. `RequestCard` بيمرر callbacks مخزّنة
// في خريطة (مستقرة عبر الـ rerenders)، فمع memo الصفوف اللي ما اتغيرتش
// بياناتها ما بتتعرض لإعادة الرسم حتى لو الـ parent اتنبّه.
interface RequestRowProps {
  request: SessionRequest
  expanded: boolean
  onToggle: (id: string) => void
  sessionId: string | null
  onCopy: (text: string) => void
  onToast: (message: string, kind?: ToastKind) => void
  onSkip: (request: SessionRequest) => void
  onRunNow: (request: SessionRequest) => void
  onRemove: (request: SessionRequest) => void
  // النص ده محفوظ في المفضّلة؟ النجمة بتتعبّى والزرار بيتقفل (منع تكرار)
  favorited: boolean
  onSaveFavorite: (text: string) => void
  busyAction: string | null
  t: Strings
}

function RequestRowInner({ request, expanded, onToggle, sessionId, onCopy, onToast, onSkip, onRunNow, onRemove, favorited, onSaveFavorite, busyAction, t }: RequestRowProps) {
  const running = request.state === "running"
  const queued = request.state === "queued"
  // الكارت المتفائل لسه ما وصلش السيرفر، فمعندناش id نبعته له
  const notSentYet = request.id.startsWith("local-")
  const now = useNowTick(running && expanded)
  const steps = request.stepsCompleted ?? 0
  const elapsed = running ? formatElapsed(request.startedAt, t, now) : ""
  // "حفظ في المفضّلة" بيظهر للطلبات المنتهية اللي ليها نص فعلًا — النسخ
  // والتخطّي والانتظار مالهمش معنى هنا. المحفوظ بيتقفل بنجمة ممتلئة بدل ما
  // يتكرر، والحذف من لوحة المفضّلة نفسها.
  const canFavorite = !running && !queued && Boolean(request.prompt.trim())
  // تخطّي للطلب الشغّال، وتنفيذ حالًا وحذف من الطابور لكل طلب مستني بس
  const actions = running || queued ? (
    <span className="request-row-actions">
      {running ? (
        <button type="button" className="request-action request-action-skip" onClick={() => onSkip(request)} disabled={busyAction === request.id} title={t.skipCurrent}>
          <svg className="request-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4.5v15l10.5-7.5L6 4.5z" fill="currentColor" stroke="none" />
            <path d="M19 5v14" />
          </svg>
          <span className="request-action-label">{t.skipCurrent}</span>
        </button>
      ) : null}
      {queued ? (
        <>
          <button type="button" className="request-action request-action-run" onClick={() => onRunNow(request)} disabled={busyAction === request.id || notSentYet} title={t.runNow}>
            <svg className="request-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4.5v15l12-7.5-12-7.5z" fill="currentColor" stroke="none" />
            </svg>
            <span className="request-action-label">{t.runNow}</span>
          </button>
          <button type="button" className="request-action request-action-remove" onClick={() => onRemove(request)} disabled={busyAction === request.id} title={t.removeFromQueue}>
            <svg className="request-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
            <span className="request-action-label">{t.removeFromQueue}</span>
          </button>
        </>
      ) : null}
    </span>
  ) : canFavorite ? (
    <span className="request-row-actions">
      <button
        type="button"
        className={`request-action request-action-favorite${favorited ? " is-on" : ""}`}
        onClick={() => onSaveFavorite(request.prompt)}
        disabled={favorited}
        title={favorited ? t.favoriteSaved : t.saveAsFavorite}
        aria-label={favorited ? t.favoriteSaved : t.saveAsFavorite}
      >
        <span className="request-action-icon" aria-hidden>{favorited ? "★" : "☆"}</span>
        <span className="request-action-label">{t.saveAsFavorite}</span>
      </button>
    </span>
  ) : null
  return (
    <li className={`request-row ${REQUEST_STATE_ROW[request.state]}${expanded ? " is-open" : ""}`}>
      <div className="request-row-head">
        <button type="button" className="request-row-toggle" onClick={() => onToggle(request.id)} aria-expanded={expanded}>
          <span className="request-row-mark" aria-hidden>{REQUEST_STATE_MARK[request.state]}</span>
          <span className="request-row-index">{t.requestNumber} {request.index}</span>
          <span className="request-row-prompt"><ExpandableText text={request.prompt || t.yourRequest} t={t} /></span>
          <span className="request-row-state">{t[REQUEST_STATE_LABEL[request.state]]}</span>
          <span className="request-row-caret" aria-hidden>{expanded ? "▾" : "▸"}</span>
        </button>
        <CopyButton className="request-row-copy" text={request.prompt} onCopy={onCopy} label={t.copyQuestion} t={t} />
        {actions}
      </div>
      {expanded ? (
        <div className="request-row-body">
          {/* نفس اللوحة اللي فوق بالظبط: النص والأدوات المدوّرة من نفس
              المكوّن، فالصف والترويسة ما يختلفوش أبدًا. */}
          <TaskStatusPanel view={describeRequest(request, t)} />
          <RequestAttachmentsList attachments={request.attachments ?? []} t={t} />
          {running ? (
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
          {/* زرار النسخ في ترويسة الكارت: على الموبايل القاعدة بتخلّي .copy-result
              ثابتة فتيجي تحت النص الطويل — المستخدم بيشوفه بعد ما ينزل لآخر الرد.
              جوّه ترويسة فيها العنوان والزرار مع بعض يفضل فوق دايمًا. */}
          {running && request.liveText ? <div className="final-result live-result"><div className="final-result-head"><div className="final-result-label">{t.liveResponse}</div><CopyButton className="copy-result" text={request.liveText} onCopy={onCopy} label={t.copyResult} t={t} /></div><div className="final-result-text"><ExpandableText text={request.liveText} rich fromEnd t={t} trailing={<span className="live-cursor" aria-hidden>▍</span>} /></div></div> : null}
          {request.finalResult && !running ? <div className="final-result"><div className="final-result-head"><div className="final-result-label">{t.finalResult}</div><CopyButton className="copy-result" text={request.finalResult} onCopy={onCopy} label={t.copyResult} t={t} /></div><div className="final-result-text"><ExpandableText text={request.finalResult} rich fromEnd t={t} /></div></div> : null}
          {sessionId && request.resultFiles.length > 0 ? <ResultFilesList files={request.resultFiles} sessionId={sessionId} onToast={onToast} t={t} /> : null}
          {sessionId && !running && request.resultFiles.length === 0 && request.finalResult ? <div className="result-files-hint">{t.noResultFileHint}</div> : null}
        </div>
      ) : null}
    </li>
  )
}

export const RequestRow = memo(RequestRowInner)
