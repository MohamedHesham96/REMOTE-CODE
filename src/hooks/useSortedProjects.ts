import { useMemo } from "react"
import { projectName, samePath } from "../display"
import { localeOf, type Language } from "../i18n"
import type { Project } from "../types"
import { normalizeProjectPath } from "../utils/paths"

export function useSortedProjects(projects: Project[], query: string, selectedId: string | undefined, recentPaths: string[], lang: Language): Project[] {
  const recentOrder = useMemo(() => {
    const order = new Map<string, number>()
    recentPaths.forEach((path, index) => order.set(normalizeProjectPath(path), index))
    return order
  }, [recentPaths])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? projects.filter((project) => `${projectName(project)} ${project.worktree}`.toLowerCase().includes(q))
      : [...projects]
    return filtered.sort((a, b) => {
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
  }, [projects, query, selectedId, recentOrder, lang])

  return sorted
}
