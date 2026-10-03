// نموذج بيانات ملاحظات الإصدار (Release Notes). الشكل مقصود ليكون بسيطًا:
// إصدار واحد يحتوي على ملخّص وسجل تغييرات مصنّف، وكل تغيير قد يحمل مرجع
// commits في Git كمعلومة ثانوية (لا تُعرض في الواجهة الرئيسية).
//
// البيانات الثابتة نفسها معزولة في `releases-data.ts` لأنها مولّدة من تاريخ
// المستودع، وهذا الملف يضمّ فقط الأنواع والدوال التي تستهلكها الواجهة.

/** تصنيفات التغيير داخل الإصدار — تطابق أقسام الواجهة مباشرة. */
export type ReleaseChangeCategory =
  | "features"
  | "improvements"
  | "fixes"
  | "performance"
  | "uiux"
  | "technical"

/** نص مترجم بالعربية والإنجليزية — نفس منطق تطبيق الترجمة المزدوج في i18n.ts. */
export interface LocalizedText {
  ar: string
  en: string
}

/** تغيير واحد قابل للعرض للمستخدم، مع مراجع commits في Git إن وُجدت. */
export interface ReleaseChange {
  category: ReleaseChangeCategory
  title: LocalizedText
  description: LocalizedText
  /** بادئات الـ commit القصيرة — معلومة ثانوية تُعرض بـ <details> فقط. */
  commits?: string[]
}

export interface Release {
  version: string
  /** تاريخ الإصدار بصيغة ISO (YYYY-MM-DD) — يُنسّق حسب اللغة عند العرض. */
  date: string
  title: LocalizedText
  summary: LocalizedText
  changes: ReleaseChange[]
  /** كل البادئات القصيرة للـ commits المشمولة في الإصدار. */
  commits?: string[]
}

/** ترتيب أقسام العرض: الأهم للمستخدم أولًا. */
export const RELEASE_CATEGORY_ORDER: ReleaseChangeCategory[] = [
  "features",
  "improvements",
  "fixes",
  "performance",
  "uiux",
  "technical",
]

/** تغييرات إصدار واحد مجمّعة حسب التصنيف مع الحفاظ على ترتيب الأقسام. */
export function groupReleaseChanges(release: Release): Array<{ category: ReleaseChangeCategory; changes: ReleaseChange[] }> {
  const groups: Array<{ category: ReleaseChangeCategory; changes: ReleaseChange[] }> = []
  for (const category of RELEASE_CATEGORY_ORDER) {
    const changes = release.changes.filter((change) => change.category === category)
    if (changes.length > 0) {
      groups.push({ category, changes })
    }
  }
  return groups
}
