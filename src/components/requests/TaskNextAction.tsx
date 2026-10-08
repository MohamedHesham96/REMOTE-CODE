import type { ReactElement } from "react"
import type { Strings } from "../../i18n"
import type { TaskStatusView } from "../../utils/task-status"

interface TaskNextActionProps {
  view: TaskStatusView
  error: string | undefined
  hasChanges: boolean
  retrying: boolean
  onRetry: () => void
  onReviewChanges: () => void
  onContinue: () => void
  t: Strings
}

export function TaskNextAction({ view, error, hasChanges, retrying, onRetry, onReviewChanges, onContinue, t }: TaskNextActionProps): ReactElement | null {
  if (view.phase === "error") {
    return (
      <div className="task-next-action task-next-action-error">
        <div className="task-failure-detail">
          <strong>{t.failureDetails}</strong>
          <p>{error || view.activity}</p>
        </div>
        <div className="task-next-buttons">
          {error ? <button type="button" className="button button-primary" onClick={onRetry} disabled={retrying}>{retrying ? t.retryingTask : t.retryTask}</button> : null}
          <button type="button" className="button button-ghost" onClick={onContinue} disabled={retrying}>{t.continueManually}</button>
        </div>
      </div>
    )
  }
  if (view.phase !== "completed") {
    return null
  }
  return (
    <div className="task-next-action">
      {hasChanges ? <button type="button" className="button button-primary" onClick={onReviewChanges}>{t.reviewChanges}</button> : null}
      <button type="button" className={hasChanges ? "button button-secondary" : "button button-primary"} onClick={onContinue}>{t.continueTask}</button>
    </div>
  )
}
