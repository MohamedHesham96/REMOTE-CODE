import type { TaskStatusView } from "../../utils/task-status"
import { useRotatingIndex } from "../../hooks/useRotatingIndex"

// كل قد إيه بنبدّل الأداة المعروضة. ٣ ثوانٍ كفاية للقراءة ومن غير ما تلفت
// النظر أكتر من اللازم على شاشة الموبايل.
const ROTATE_MS = 3000

// لوحة الحالة: أشهر جزء في الكارت، فوق الطلبات مباشرة.
//
// سطر واحد يجمع حالة المحادثة ووصف النشاط الحالي؛ دمج الوصفين يزيل التكرار
// ويُبقي أهم معلومة ظاهرة داخل الترويسة الثابتة.
//
// في "قيد التنفيذ" بنعرض الأدوات اللي المهمة استخدمتها واحدة واحدة بالتبادل
// (زي قسم "Used" في واجهة الديسكتوب) بدل سطر نشاط واحد؛ وأول ما تظهر أداة
// جديدة بنقفز لها. بعد الاكتمال بنثبّت آخر أداة مستخدمة على الشاشة من غير
// تقليب. باقي المراحل (انتظار/جمود/خطأ) رسالتها أهم من سرد الأدوات فبتفضل
// زي ما هي.
export function TaskStatusPanel({ view }: { view: TaskStatusView }) {
  const running = view.phase === "running"
  const tools = running || view.phase === "completed" ? view.usedTools : []
  const index = useRotatingIndex(running ? tools.length : 0, ROTATE_MS)
  const shown = running ? tools[index] : tools[tools.length - 1]
  const activity = shown ?? view.activity
  return (
    <div className={`task-panel task-panel-${view.phase}`} data-phase={view.phase} aria-live="polite">
      <span className={`task-panel-dot${view.live ? " is-live" : ""}`} aria-hidden />
      <span className="task-panel-label">{view.label}</span>
      <span className="task-panel-activity">
        {activity}
        {running && tools.length > 1 ? <span className="task-panel-used-count">{index + 1}/{tools.length}</span> : null}
      </span>
    </div>
  )
}
