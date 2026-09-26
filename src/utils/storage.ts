import { LAST_SESSION_KEY, PINNED_SESSIONS_KEY, PINNED_SESSIONS_LIMIT, RECENT_PROJECTS_KEY } from "../constants"
import type { PinnedConversation, Session, SessionRequest } from "../types"
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

// ── المثبّتات ──
// المصدر الحقيقي على السيرفر (يتشارك بين كل الأجهزة)؛ الـ localStorage هنا كاش
// للعرض الأول بس. النسخة القديمة كانت array من ids مجرّدة، والبعدي entries
// كاملة — التطبيع بيزرع الـ format القديم تلقائيًا.

export function loadPinnedConversations(): PinnedConversation[] {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (!raw) {
      return []
    }
    return normalizePinnedConversations(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

export function savePinnedConversations(pins: PinnedConversation[]): void {
  const next = normalizePinnedConversations(pins)
  try {
    // ما نكتبش نفس القيمة: التقاط غير ضروري في كل render
    const current = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (current === JSON.stringify(next)) {
      return
    }
    localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

// هل النسخة المحفوظة بالشكل القديم (array من ids مجرّدة)؟ بنستخدمها مرة واحدة
// عشان نعرف إننا لازم نرفعها للسيرفر — بعد أول مزامنة بتتخزّن بالشكل الجديد.
export function hasLegacyPinnedFormat(): boolean {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (!raw) {
      return false
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) && parsed.some((item) => typeof item === "string")
  } catch {
    return false
  }
}

function pinnedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

// بتتحمل بيانات قديمة/تالفة أو تعديل يدوي من الـ devtools، وبتعيد ترتيب
// "الأحدث تثبيتًا الأول" مع شيل المكرر والسفلي الفاضي.
export function normalizePinnedConversations(values: unknown): PinnedConversation[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set<string>()
  const result: PinnedConversation[] = []
  for (const value of values) {
    // الشكل القديم: string مجرد — من غير بيانات العرض، بنحتفظ بالـ id بس
    const legacyId = typeof value === "string" ? value : ""
    const candidate = (typeof value === "object" && value !== null ? value : {}) as Partial<PinnedConversation>
    const id = pinnedText(candidate.id, 200) || legacyId.trim()
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    const created = typeof candidate.created === "number" && Number.isFinite(candidate.created)
      ? Math.trunc(candidate.created)
      : 0
    result.push({
      id,
      title: pinnedText(candidate.title, 200),
      created,
      directory: pinnedText(candidate.directory, 1024),
      worktree: pinnedText(candidate.worktree, 1024),
      projectName: pinnedText(candidate.projectName, 200),
    })
    if (result.length >= PINNED_SESSIONS_LIMIT) {
      break
    }
  }
  return result
}

// كل انتقال بيرجّع نفس المرجع لو مفيش تغيير — عشان React ما يعيدش الرندر
// لما المحادثة مثبّتة بالفعل أو مش مثبّتة أصلًا
export function pinConversation(pins: PinnedConversation[], pin: PinnedConversation): PinnedConversation[] {
  if (!pin.id) {
    return pins
  }
  return normalizePinnedConversations([pin, ...pins.filter((item) => item.id !== pin.id)])
}

export function unpinConversation(pins: PinnedConversation[], sessionId: string): PinnedConversation[] {
  if (!pins.some((pin) => pin.id === sessionId)) {
    return pins
  }
  return pins.filter((pin) => pin.id !== sessionId)
}

// ينضّف المحادثات اللي اتمسحت من التثبيت (مسح يدوي أو مسودة فاضية اتشالت)
export function forgetPinnedConversations(pins: PinnedConversation[], removedIds: string[]): PinnedConversation[] {
  if (removedIds.length === 0) {
    return pins
  }
  const removed = new Set(removedIds)
  const next = pins.filter((pin) => !removed.has(pin.id))
  return next.length === pins.length ? pins : next
}
