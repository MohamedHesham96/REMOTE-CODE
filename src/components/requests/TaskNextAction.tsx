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
  // بعد اكتمال المهمة يبقى إجراء واحد فقط عند وجود تغييرات: مراجعتها.
  // زر "متابعة العمل" اتشال لأن الـ composer مفتوح تحت وفي متناول اليد، فالزر
  // كان تكرارًا بصريًا بلا وظيفة جديدة.
  if (view.phase !== "completed" || !hasChanges) {
    return null
  }
  return (
    <div className="task-next-action">
      <button type="button" className="button button-primary" onClick={onReviewChanges}>{t.reviewChanges}</button>
    </div>
  )
}
