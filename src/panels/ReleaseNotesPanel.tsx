import { groupReleaseChanges, type LocalizedText, type Release, type ReleaseChangeCategory } from "../releases"
import { localeOf, type Language, type Strings } from "../i18n"

// اختيار النص حسب اللغة الحالية — نفس نمط i18n.ts لكن للنصوص المخزّنة في
// بيانات الإصدارات بدل قاموس الترجمة.
function pick(text: LocalizedText, lang: Language): string {
  return lang === "ar" ? text.ar : text.en
}

// أيقونات الأقسام — إيموجي بسيط يتماشى مع بقية أدراج التطبيق بدل مكتبة أيقونات.
const CATEGORY_ICONS: Record<ReleaseChangeCategory, string> = {
  features: "✨",
  improvements: "⚡",
  fixes: "🐛",
  performance: "🚀",
  uiux: "🎨",
  technical: "🛠️",
}

function categoryLabel(category: ReleaseChangeCategory, t: Strings): string {
  switch (category) {
    case "features":
      return t.releaseCategoryFeatures
    case "improvements":
      return t.releaseCategoryImprovements
    case "fixes":
      return t.releaseCategoryFixes
    case "performance":
      return t.releaseCategoryPerformance
    case "uiux":
      return t.releaseCategoryUiux
    case "technical":
      return t.releaseCategoryTechnical
  }
}

// تنسيق تاريخ الإصدار بالشكل الطويل، وتاريخ غير صالح يرجع لنفس نص القسم.
function releaseDateLabel(date: string, lang: Language, t: Strings): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    return t.releaseNotes
  }
  return new Intl.DateTimeFormat(localeOf(lang), { year: "numeric", month: "long", timeZone: "UTC" }).format(parsed)
}

interface ReleaseNotesPanelProps {
  releases: Release[]
  onClose: () => void
  t: Strings
  lang: Language
}

// ملاحظات الإصدار: تُبنى من البيانات المولّدة في `releases-data.ts`، وكل إصدار
// يُعرض كبطاقة تحتوي ملخّصًا وأقسامًا مصنّفة. مراجع Git ثانوية لكن قابلة
// للفتح — لا تزاحم المحتوى الموجّه للمستخدم في العرض الافتراضي.
export function ReleaseNotesPanel({ releases, onClose, t, lang }: ReleaseNotesPanelProps) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer release-notes-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">
              🚀 {t.releaseNotes} · {releases.length} {t.releases}
            </div>
            <h2>{t.releaseNotes}</h2>
            <p className="release-notes-intro">{t.releaseNotesIntro}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>

        <nav className="release-toc" aria-label={t.releaseNotes}>
          {releases.map((release) => (
            <a
              className="release-toc-item"
              key={release.version}
              href={`#release-${release.version}`}
              onClick={(event) => {
                event.preventDefault()
                document.getElementById(`release-${release.version}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }}
            >
              <span className="release-toc-version">{release.version}</span>
              <span className="release-toc-date">{releaseDateLabel(release.date, lang, t)}</span>
            </a>
          ))}
        </nav>

        {releases.length === 0 ? (
          <div className="empty-state">{t.releaseNotesEmpty}</div>
        ) : (
          <div className="release-timeline">
            {releases.map((release, index) => {
              const groups = groupReleaseChanges(release)
              const isLatest = index === 0
              return (
                <article className={`release-card${isLatest ? " is-latest" : ""}`} key={release.version} id={`release-${release.version}`}>
                  <header className="release-card-top">
                    <div className="release-version-row">
                      <span className="release-version">{release.version}</span>
                      {isLatest ? <span className="release-latest-badge">{t.releaseLatest}</span> : null}
                    </div>
                    <time className="release-date" dateTime={release.date}>{releaseDateLabel(release.date, lang, t)}</time>
                  </header>

                  <div className="release-card-body">
                    <strong className="release-title">{pick(release.title, lang)}</strong>
                    <p className="release-summary">{pick(release.summary, lang)}</p>

                    {groups.map((group) => (
                      <section className="release-group" key={group.category}>
                        <div className="release-group-header">
                          <span aria-hidden>{CATEGORY_ICONS[group.category]}</span>
                          <span>{categoryLabel(group.category, t)}</span>
                        </div>
                        <ul className="release-change-list">
                          {group.changes.map((change) => (
                            <li className="release-change" key={pick(change.title, "ar")}>
                              <div className="release-change-title">{pick(change.title, lang)}</div>
                              {pick(change.description, lang) ? <div className="release-change-desc">{pick(change.description, lang)}</div> : null}
                              {change.commits && change.commits.length > 0 ? (
                                <ul className="release-commits" aria-label={t.releaseCommitsLabel}>
                                  {change.commits.map((commit) => <li key={commit}>{commit}</li>)}
                                </ul>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>

                  <footer className="release-card-foot">
                    <span className="release-stat">{release.changes.length} {t.releaseChangesLabel}</span>
                    <span className="release-stat">{release.commits?.length ?? 0} {t.releaseCommitsLabel}</span>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </aside>
    </div>
  )
}
