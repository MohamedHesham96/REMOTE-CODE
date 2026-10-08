import { memo } from "react"
import type { Strings } from "../../i18n"

interface BranchButtonProps {
  // جارٍ إنشاء الفرع دلوقتي — الزرار بيقفل ويبان "…" بدل ما يتكرر الضغط
  branching: boolean
  // مفيش محادثة مفتوحة = مفيش فرع
  disabled: boolean
  onBranch: () => void
  t: Strings
}

// زر "تفرّع من المحادثة" كأيقونة مضغوطة جنب لوحة حالة المهمة: الأيقونة وحدها
// بدون نص عشان ما تزحمش سطر الحالة، والمعنى موضّح في aria-label و title (ومفيش
// نص مترجم ظاهر أصلًا لأنه أيقونة). الفرع ينفع من محادثة شغّالة أو مكتملة أو
// فاشلة، والأصل ما بيتغيّرش خالص. الفرع الجديد بيتبدّل له تلقائيًا ويكمل
// مستقبلًا زي أي محادثة مستقلة. الحالة (جارٍ الإنشاء) + الحارس المتزامن في App
// بيمنعوا إنشاء فروع مكررة من ضغط مزدوج.
export const BranchButton = memo(function BranchButton({ branching, disabled, onBranch, t }: BranchButtonProps) {
  const label = branching ? t.branching : t.branchSession
  return (
    <button
      type="button"
      className={`branch-session${branching ? " is-branching" : ""}`}
      onClick={onBranch}
      disabled={disabled || branching}
      aria-label={label}
      title={label}
    >
      <span className="branch-session-icon" aria-hidden>{branching ? "…" : "↗"}</span>
    </button>
  )
})
