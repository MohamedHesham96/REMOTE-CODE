import { LAST_SESSION_KEY, RECENT_PROJECTS_KEY } from "../constants"
import type { Session, SessionRequest } from "../types"
import { normalizeProjectPath } from "./paths"

export function sortSessionsByCreated(list: Session[]): Session[] {
  return [...list].sort((a, b) => (b.time.created - a.time.created) || (b.time.updated - a.time.updated))
}

export function sessionMatches(sessions: Session[], id: string | null): Session | undefined {
  return id ? sessions.find((session) => session.id === id) : undefined
}

export function isRequestsEmpty(candidate: SessionRequest[] | null): boolean {
  return !candidate || candidate.length === 0
}

export function loadLastSessions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const result: Record<string, string> = {}
    for (const [worktree, sessionId] of Object.entries(parsed)) {
      if (typeof sessionId === "string" && sessionId) {
        result[normalizeProjectPath(worktree)] = sessionId
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveLastSession(worktree: string, sessionId: string): void {
  const key = normalizeProjectPath(worktree)
  try {
    const all = loadLastSessions()
    if (all[key] === sessionId) {
      return
    }
    all[key] = sessionId
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

export function forgetLastSession(worktree: string): void {
  const key = normalizeProjectPath(worktree)
  try {
    const all = loadLastSessions()
    if (all[key] === undefined) {
      return
    }
    delete all[key]
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

export function loadRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}
