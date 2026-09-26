import { LAST_SESSION_KEY, PINNED_SESSIONS_KEY, PINNED_SESSIONS_LIMIT, RECENT_PROJECTS_KEY } from "../constants"
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

// ids مثبّتة بترتيب "الأحدث تثبيتًا الأول" — الترتيب ده هو مصدر الحقيقة الوحيد
// للعرض، وبيتخزّن كـ array عشان يفضل ثابت عبر التحديث والتبديل بين المشاريع.
export function loadPinnedSessions(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? normalizePinnedIds(parsed) : []
  } catch {
    return []
  }
}

export function savePinnedSessions(sessionIds: string[]): void {
  const next = normalizePinnedIds(sessionIds)
  try {
    // ما نكتبش لوحدنا نفس القيمة: التقاط غير ضروري في كل render/commit
    const current = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (current === JSON.stringify(next)) {
      return
    }
    localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

// بتتحمل بيانات قديمة/تالفة أو تعديل يدوي من الـ devtools
function normalizePinnedIds(values: unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== "string" || !value || seen.has(value)) {
      continue
    }
    seen.add(value)
    result.push(value)
    if (result.length >= PINNED_SESSIONS_LIMIT) {
      break
    }
  }
  return result
}

// تطبيع ترتيب المثبّت حسب ترتيب الـ ids المحفوظ، وتجاهل أي id مش موجود
// في قائمة الجلسات الحالية (محادثة من مشروع تاني، أو اتمسحت)
export function orderPinnedSessions(sessions: Session[], pinnedIds: string[]): Session[] {
  if (pinnedIds.length === 0) {
    return []
  }
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const result: Session[] = []
  for (const id of pinnedIds) {
    const session = byId.get(id)
    if (session) {
      result.push(session)
    }
  }
  return result
}

// كل انتقال بيرجّع نفس المرجع لو مفيش تغيير — عشان React ما يعيدش الرندر
// لما تكون المحادثة مثبّتة بالفعل أو مش مثبّتة أصلًا
export function pinSessionId(pinnedIds: string[], sessionId: string): string[] {
  if (!sessionId || pinnedIds.includes(sessionId)) {
    return pinnedIds
  }
  return [sessionId, ...pinnedIds].slice(0, PINNED_SESSIONS_LIMIT)
}

export function unpinSessionId(pinnedIds: string[], sessionId: string): string[] {
  if (!pinnedIds.includes(sessionId)) {
    return pinnedIds
  }
  return pinnedIds.filter((id) => id !== sessionId)
}

// ينضّف المحادثات اللي اتمسحت من التثبيت (مسح يدوي أو مسودة فاضية اتشالت)
export function forgetSessionIds(pinnedIds: string[], removedIds: string[]): string[] {
  if (removedIds.length === 0) {
    return pinnedIds
  }
  const removed = new Set(removedIds)
  const next = pinnedIds.filter((id) => !removed.has(id))
  return next.length === pinnedIds.length ? pinnedIds : next
}
