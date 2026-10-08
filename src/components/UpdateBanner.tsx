import type { Strings } from "../i18n"
import type { UpdateInfo } from "../types"

// شريط تحديث هادئ أعلى مساحة العمل: لا يحجب أي شيء ولا يوقف مهمة جارية،
// وفيه زران فقط — عرض الإصدار أو تأجيله. الرقم المقارن هو نسخة المحرك
// الفعلية من السيرفر، ولا يظهر الشريط بغير تحديث حقيقي.
export function UpdateBanner({ info, onView, onDismiss, t }: { info: UpdateInfo; onView: () => void; onDismiss: () => void; t: Strings }) {
  return (
    <div className="update-banner" role="status">
      <span className="update-banner-mark" aria-hidden>⚡</span>
      <div className="update-banner-body">
        <strong className="update-banner-title">{t.updateAvailableTitle}</strong>
        <span className="update-banner-versions" dir="ltr">
          {info.currentVersion || "—"} <span className="update-banner-arrow" aria-hidden>→</span> {info.latestVersion}
        </span>
        <span className="update-banner-copy">{t.updateAvailableCopy}</span>
      </div>
      <div className="update-banner-actions">
        <button type="button" className="button button-primary" onClick={onView}>{t.updateViewRelease}</button>
        <button type="button" className="button button-ghost" onClick={onDismiss}>{t.updateLater}</button>
      </div>
    </div>
  )
}
