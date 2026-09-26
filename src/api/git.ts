import { request } from "./http"
import type { GitChanges } from "../types"

export function getGitChanges(): Promise<GitChanges> {
  return request<GitChanges>("/api/git/changes")
}
