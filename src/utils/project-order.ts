import { projectName, samePath } from "../display"
import { localeOf, type Language } from "../i18n"
import type { Project } from "../types"
import { normalizeProjectPath } from "./paths"

// ترتيب عرض المشاريع: المشروع الحالي أولًا، ثم الأحدث استخدامًا، ثم أبجديًا.
// مستخرج من useSortedProjects عشان يبقى مصدر واحد للترتيب — الواجهة تعرضه
// والتحكم الصوتي يحلّ بيه أوامر زي «افتح المشروع التاني» على نفس اللي شايفه
// المستخدم، من غير ما نكرر المنطق.
export function sortProjectsForDisplay(
  projects: readonly Project[],
  selectedId: string | undefined,
  recentPaths: readonly string[],
  lang: Language,
): Project[] {
  const recentOrder = new Map<string, number>()
  recentPaths.forEach((path, index) => recentOrder.set(normalizeProjectPath(path), index))
  return [...projects].sort((a, b) => {
    const aCurrent = samePath(a.worktree, selectedId) ? 0 : 1
    const bCurrent = samePath(b.worktree, selectedId) ? 0 : 1
    if (aCurrent !== bCurrent) {
      return aCurrent - bCurrent
    }
    const aRecent = recentOrder.get(normalizeProjectPath(a.worktree)) ?? 999
    const bRecent = recentOrder.get(normalizeProjectPath(b.worktree)) ?? 999
    if (aRecent !== bRecent) {
      return aRecent - bRecent
    }
    return projectName(a).localeCompare(projectName(b), localeOf(lang))
  })
}
