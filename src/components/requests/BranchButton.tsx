import { memo } from "react"
import type { Strings } from "../../i18n"

interface BranchButtonProps {
  // جارٍ إنشاء الفرع دلوقتي — الزرار بيقفل ويبان سبينر بدل ما يتكرر الضغط
  branching: boolean
  // مفيش محادثة مفتوحة = مفيش فرع
  disabled: boolean
  onBranch: () => void
  t: Strings
}

// زرار "تفرّع من المحادثة" في ترويسة كارت المهمة: ظاهر طول ما فيه محادثة
// مفتوحة — الفرع ينفع من محادثة شغّالة أو مكتملة أو فاشلة، والأصل ما
// بيتغيّرش خالص. الفرع الجديد بيتبدّل له تلقائيًا ويكمل مستقبلًا زي أي
// محادثة مستقلة. الحالة (جارٍ الإنشاء) + الحارس المتزامن في App بيمنعوا
// إنشاء فروع مكررة من ضغط مزدوج.
export const BranchButton = memo(function BranchButton({ branching, disabled, onBranch, t }: BranchButtonProps) {
  return (
    <button
      type="button"
      className={`branch-session${branching ? " is-branching" : ""}`}
      onClick={onBranch}
      disabled={disabled || branching}
      aria-label={t.branchSession}
      title={`${t.branchSession} ↗`}
    >
      <span className="branch-session-icon" aria-hidden>↗</span>
      <span className="branch-session-label">{branching ? t.branching : t.branchSession}</span>
    </button>
  )
})
