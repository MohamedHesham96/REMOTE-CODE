import type { Strings } from "../i18n"
import type { SessionUsage } from "../types"
import { formatCost, formatDuration, formatTokenCount } from "../utils/usage"

// ملخص استهلاك الجلسة: يعرض فقط ما يرجعه المحرك فعلًا. غياب أرقام الرموز
// يعني "غير متاح" لا صفرًا، وغياب التكلفة يعني "غير متاح" لا "$0.00".
// المكان المقصود درج السجل (تفاصيل الجلسة) بعيدًا عن واجهة المحادثة.
export function SessionUsageSummary({ usage, t }: { usage: SessionUsage | null; t: Strings }) {
  const tokens = usage?.tokens ?? null
  const cost = usage?.cost ?? null
  return (
    <section className="session-usage" aria-label={t.usageTitle}>
      <div className="session-usage-head">
        <span className="session-usage-icon" aria-hidden>📊</span>
        <strong>{t.usageTitle}</strong>
        {tokens ? <span className="session-usage-total" dir="ltr">{formatTokenCount(tokens.total)} {t.usageTokensUnit}</span> : null}
      </div>
      {tokens ? (
        <div className="session-usage-grid">
          <span className="session-usage-label">{t.usageInput}</span>
          <span className="session-usage-value" dir="ltr">{formatTokenCount(tokens.input)}</span>
          <span className="session-usage-label">{t.usageOutput}</span>
          <span className="session-usage-value" dir="ltr">{formatTokenCount(tokens.output)}</span>
          <span className="session-usage-label session-usage-emphasis">{t.usageTotal}</span>
          <span className="session-usage-value session-usage-emphasis" dir="ltr">{formatTokenCount(tokens.total)}</span>
        </div>
      ) : (
        <div className="session-usage-grid">
          <span className="session-usage-label">{t.usageTokens}</span>
          <span className="session-usage-value">{t.usageUnavailable}</span>
        </div>
      )}
      <div className="session-usage-grid">
        <span className="session-usage-label">{t.usageRequests}</span>
        <span className="session-usage-value" dir="ltr">{usage ? usage.requests : "—"}</span>
        <span className="session-usage-label">{t.usageDuration}</span>
        <span className="session-usage-value">{usage ? formatDuration(usage.durationMs, t) : t.usageUnavailable}</span>
      </div>
      <div className="session-usage-grid">
        <span className="session-usage-label">{t.usageCost}</span>
        <span className="session-usage-value" dir="ltr">{cost !== null ? formatCost(cost) : t.usageUnavailable}</span>
      </div>
    </section>
  )
}
