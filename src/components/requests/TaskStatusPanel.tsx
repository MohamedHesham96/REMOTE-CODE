import type { TaskStatusView } from "../../utils/task-status"

// لوحة الحالة: أشهر جزء في الكارت، فوق الطلبات مباشرة.
//
// سطر واحد يجمع حالة المحادثة ووصف النشاط الحالي؛ دمج الوصفين يزيل التكرار
// ويُبقي أهم معلومة ظاهرة داخل الترويسة الثابتة.
export function TaskStatusPanel({ view }: { view: TaskStatusView }) {
  return (
    <div className={`task-panel task-panel-${view.phase}`} data-phase={view.phase} aria-live="polite">
      <span className={`task-panel-dot${view.live ? " is-live" : ""}`} aria-hidden />
      <span className="task-panel-label">{view.label}</span>
      <span className="task-panel-activity">{view.activity}</span>
    </div>
  )
}
