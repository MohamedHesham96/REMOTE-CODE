import type { Strings } from "../../i18n"
import type { TaskStatusView } from "../../utils/task-status"

// لوحة الحالة: أشهر جزء في الكارت، فوق الطلبات مباشرة.
//
// سطرين بس: شارة الحالة على مستوى المحادثة، وتحتها سطر بيقول OpenCode بيعمل
// إيه دلوقتي. الشارة متلوّنة حسب الحالة والنقطة بتتحرك بس في "قيد التنفيذ"
// — فالحالة الواقفة أو المجمّدة بتفضح حالتها من غير أي نص. ده المقصود:
// المستخدم يفهم من نظرة، من غير ما يفتح صف.
//
// `live` بيأثر على النقطة بس (class)، والسبب إن لون النقطة بييجي من
// `.task-panel[data-phase]` نفسه.
export function TaskStatusPanel({ view, t }: { view: TaskStatusView; t: Strings }) {
  return (
    <div className={`task-panel task-panel-${view.phase}`} data-phase={view.phase}>
      <div className="task-panel-head">
        <span className={`task-panel-dot${view.live ? " is-live" : ""}`} aria-hidden />
        <span className="task-panel-label">{view.label}</span>
        <span className="task-panel-eyebrow">{t.taskCurrentActivity}</span>
      </div>
      <p className="task-panel-activity">{view.activity}</p>
    </div>
  )
}
