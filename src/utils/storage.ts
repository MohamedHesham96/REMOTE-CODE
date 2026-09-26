import { LAST_SESSION_KEY, PINNED_SESSIONS_KEY, RECENT_PROJECTS_KEY } from "../constants"
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

export function loadPinnedSessions(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

export function savePinnedSessions(sessionIds: string[]): void {
  try {
    localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(sessionIds))
  } catch {
    // ignore
  }
}

export function togglePinSession(sessionId: string): void {
  const pinned = loadPinnedSessions()
  const index = pinned.indexOf(sessionId)
  if (index >= 0) {
    pinned.splice(index, 1)
  } else {
    pinned.unshift(sessionId)
  }
  savePinnedSessions(pinned)
}

export function isSessionPinned(sessionId: string): boolean {
  return loadPinnedSessions().includes(sessionId)
}

export function getPinnedSessionsInOrder(sessions: Session[]): Session[] {
  const pinnedIds = loadPinnedSessions()
  const sessionMap = new Map(sessions.map((s) => [s.id, s]))
  return pinnedIds.map((id) => sessionMap.get(id)).filter((s): s is Session => s !== undefined)
}
