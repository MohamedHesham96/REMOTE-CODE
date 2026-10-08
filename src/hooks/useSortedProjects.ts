import { useMemo } from "react"
import { projectName } from "../display"
import type { Language } from "../i18n"
import type { Project } from "../types"
import { sortProjectsForDisplay } from "../utils/project-order"

// الفرز الفعلي في sortProjectsForDisplay — هنا بس الفلترة بالبحث والذاكرة.
// نفس الترتيب بيستخدمه التحكم الصوتي عشان "المشروع التاني" يشاور على نفس
// الصف اللي المستخدم شايفه (طالع من utils/project-order.ts).
export function useSortedProjects(projects: Project[], query: string, selectedId: string | undefined, recentPaths: string[], lang: Language): Project[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? projects.filter((project) => `${projectName(project)} ${project.worktree}`.toLowerCase().includes(q))
      : projects
    return sortProjectsForDisplay(filtered, selectedId, recentPaths, lang)
  }, [projects, query, selectedId, recentPaths, lang])
}
