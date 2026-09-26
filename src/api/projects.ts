import { request } from "./http"
import type { Project, ProjectResponse } from "../types"

export function getProjects(): Promise<ProjectResponse> {
  return request<ProjectResponse>("/api/project")
}

export function selectProject(project: Pick<Project, "id" | "worktree">): Promise<{ project: Project }> {
  return request<{ project: Project }>("/api/project/select", {
    method: "POST",
    body: JSON.stringify({ id: project.id, worktree: project.worktree }),
  })
}
