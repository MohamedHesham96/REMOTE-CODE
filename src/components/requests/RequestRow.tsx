import { formatElapsed, formatTime } from "../../display"
import type { Language, Strings } from "../../i18n"
import type { RequestState, SessionRequest, ToastKind } from "../../types"
import { useNowTick } from "../../hooks/useNowTick"
import { TodoList } from "./TodoList"
import { ResultFilesList } from "./ResultFilesList"
import { CopyButton } from "../CopyButton"
import { memo, useCallback, useMemo, useState, type ReactNode } from "react"
import { tailPreview } from "../../utils/preview"

const REQUEST_STATE_LABEL: Record<RequestState, keyof Strings> = {
  queued: "inQueue",
  running: "running",
  done: "done",
  stopped: "stopped",
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
// memo: بيتنادى ٣ مرات في كل صف (prompt, liveResult, finalResult). مع
// `useNowTick` اللي بيوقظ الكارت كل ثانية، من غير memo كان بيتعاد حساب
// `text.split("\n")` و`tailPreview` في كل مرة حتى لو النص ما اتغيّرش.
const ExpandableText = memo(function ExpandableText({ text, maxLines = 6, className = "", trailing = null, fromEnd = false, t }: { text: string; maxLines?: number; className?: string; trailing?: ReactNode; fromEnd?: boolean; t: Strings }) {
  const [isExpanded, setIsExpanded] = useState(false)
  // الكسر (split/طول/سقف) بيتحسب مرة واحدة على أول رندر، وبعدها النصوص
  // المطوية بتتجمد طالما `text` نفسه ما اتغيّرش — ده اللي بيخلّي memo يشتغل.
  const collapse = useMemo(() => {
    const lines = text.split("\n")
    const shouldTruncate = lines.length > maxLines || text.length > COLLAPSED_CHAR_BUDGET
    if (!shouldTruncate) {
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
  }, [text, maxLines, fromEnd])
  const toggle = useCallback(() => setIsExpanded((current) => !current), [])

  if (collapse === null) {
    return <span className={className}>{text}{trailing}</span>
  }

  const displayText = isExpanded ? text : collapse.collapsed

  return (
    <span className={className}>
      <span
        className={!isExpanded && collapse.clamp ? "expandable-body is-collapsed" : "expandable-body"}
        style={!isExpanded && collapse.clamp ? { WebkitLineClamp: maxLines, lineClamp: maxLines } : undefined}
      >
        {displayText}
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
  onToggle: () => void
  sessionId: string | null
  onCopy: (text: string) => void
  onToast: (message: string, kind?: ToastKind) => void
  onSkip: () => void
  onRunNow: () => void
  onRemove: () => void
  busyAction: string | null
  t: Strings
  lang: Language
}

function RequestRowInner({ request, expanded, onToggle, sessionId, onCopy, onToast, onSkip, onRunNow, onRemove, busyAction, t, lang }: RequestRowProps) {
  const running = request.state === "running"
  const queued = request.state === "queued"
  // الكارت المتفائل لسه ما وصلش السيرفر، فمعندناش id نبعته له
  const notSentYet = request.id.startsWith("local-")
  const now = useNowTick(running && expanded)
  // Execution Plan is bound to the current task only: it renders while the
  // request is running and resets the moment it completes, stops or ends.
  // Gating here (in addition to the server sending todos only for the running
  // request) guarantees no stale plan from a previous task ever stays visible.
  const hasTodos = running && request.totalTodos > 0
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
          <span className="request-row-prompt"><ExpandableText text={request.prompt || t.yourRequest} t={t} /></span>
          <span className="request-row-state">{t[REQUEST_STATE_LABEL[request.state]]}</span>
          <span className="request-row-caret" aria-hidden>{expanded ? "▾" : "▸"}</span>
        </button>
        <CopyButton className="request-row-copy" text={request.prompt} onCopy={onCopy} label={t.copyQuestion} t={t} />
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
          {running ? <TodoList todos={request.todos} t={t} /> : null}
          {/* زرار النسخ في ترويسة الكارت: على الموبايل القاعدة بتخلّي .copy-result
              ثابتة فتيجي تحت النص الطويل — المستخدم بيشوفه بعد ما ينزل لآخر الرد.
              جوّه ترويسة فيها العنوان والزرار مع بعض يفضل فوق دايمًا. */}
          {running && request.liveText ? <div className="final-result live-result"><div className="final-result-head"><div className="final-result-label">{t.liveResponse}</div><CopyButton className="copy-result" text={request.liveText} onCopy={onCopy} label={t.copyResult} t={t} /></div><div className="final-result-text"><ExpandableText text={request.liveText} t={t} trailing={<span className="live-cursor" aria-hidden>▍</span>} /></div></div> : null}
          {request.finalResult && !running ? <div className="final-result"><div className="final-result-head"><div className="final-result-label">{t.finalResult}</div><CopyButton className="copy-result" text={request.finalResult} onCopy={onCopy} label={t.copyResult} t={t} /></div><div className="final-result-text"><ExpandableText text={request.finalResult} fromEnd t={t} /></div></div> : null}
          {sessionId && request.resultFiles.length > 0 ? <ResultFilesList files={request.resultFiles} sessionId={sessionId} onToast={onToast} t={t} /> : null}
          {sessionId && !running && request.resultFiles.length === 0 && request.finalResult ? <div className="result-files-hint">{t.noResultFileHint}</div> : null}
        </div>
      ) : null}
    </li>
  )
}

export const RequestRow = memo(RequestRowInner)
