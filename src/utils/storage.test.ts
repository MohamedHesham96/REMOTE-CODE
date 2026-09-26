import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PINNED_SESSIONS_KEY, PINNED_SESSIONS_LIMIT } from "../constants"
import type { Session } from "../types"
import { forgetSessionIds, loadPinnedSessions, orderPinnedSessions, pinSessionId, savePinnedSessions, unpinSessionId } from "./storage"

function session(id: string): Session {
  return { id, title: id, time: { created: 1, updated: 1 } } as Session
}

function stored(): string | null {
  return (globalThis as unknown as { localStorage: Storage }).localStorage.getItem(PINNED_SESSIONS_KEY)
}

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    clear: () => data.clear(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("pinned sessions storage", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadPinnedSessions()).toEqual([])
  })

  it("round-trips ids through localStorage", () => {
    savePinnedSessions(["ses_b", "ses_a"])
    expect(stored()).toBe('["ses_b","ses_a"]')
    expect(loadPinnedSessions()).toEqual(["ses_b", "ses_a"])
  })

  it("survives a full reload because ids come back from localStorage", () => {
    savePinnedSessions(["ses_a", "ses_b"])
    // "إعادة تحميل الصفحة": حالة جديدة بتقرا من التخزين بس
    expect(loadPinnedSessions()).toEqual(["ses_a", "ses_b"])
  })

  it("drops duplicates, blanks and non-strings", () => {
    const data = JSON.stringify(["ses_a", "ses_a", "", 42, null, "ses_b"])
    ;(globalThis as unknown as { localStorage: Storage }).localStorage.setItem(PINNED_SESSIONS_KEY, data)
    expect(loadPinnedSessions()).toEqual(["ses_a", "ses_b"])
  })

  it("caps the stored list so it cannot grow forever", () => {
    const many = Array.from({ length: PINNED_SESSIONS_LIMIT + 25 }, (_, index) => `ses_${index}`)
    savePinnedSessions(many)
    expect(loadPinnedSessions()).toHaveLength(PINNED_SESSIONS_LIMIT)
    // الأحدث تثبيتًا (أول القائمة) هو اللي يفضل محفوظ
    expect(loadPinnedSessions()[0]).toBe("ses_0")
  })

  it("ignores corrupt or non-array payloads", () => {
    const storage = (globalThis as unknown as { localStorage: Storage }).localStorage
    storage.setItem(PINNED_SESSIONS_KEY, "{not json")
    expect(loadPinnedSessions()).toEqual([])
    storage.setItem(PINNED_SESSIONS_KEY, '{"ses_a":true}')
    expect(loadPinnedSessions()).toEqual([])
  })

  it("does not rewrite the same value", () => {
    savePinnedSessions(["ses_a"])
    const setItem = vi.spyOn(globalThis.localStorage, "setItem")
    savePinnedSessions(["ses_a"])
    expect(setItem).not.toHaveBeenCalled()
  })

  it("keeps working when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied") },
      setItem: () => { throw new Error("denied") },
      removeItem: () => { throw new Error("denied") },
      clear: () => { throw new Error("denied") },
    })
    expect(loadPinnedSessions()).toEqual([])
    expect(() => savePinnedSessions(["ses_a"])).not.toThrow()
  })
})

describe("orderPinnedSessions", () => {
  const sessions = [session("ses_a"), session("ses_b"), session("ses_c")]

  it("keeps the stored pin order instead of the session list order", () => {
    expect(orderPinnedSessions(sessions, ["ses_c", "ses_a"]).map((item) => item.id)).toEqual(["ses_c", "ses_a"])
  })

  it("is stable regardless of how the session list is sorted", () => {
    const ids = ["ses_b", "ses_a", "ses_c"]
    const forwards = orderPinnedSessions(sessions, ids).map((item) => item.id)
    const backwards = orderPinnedSessions([...sessions].reverse(), ids).map((item) => item.id)
    expect(forwards).toEqual(["ses_b", "ses_a", "ses_c"])
    expect(backwards).toEqual(forwards)
  })

  it("skips ids that are not in the current project", () => {
    expect(orderPinnedSessions(sessions, ["missing", "ses_b", "gone"]).map((item) => item.id)).toEqual(["ses_b"])
  })

  it("returns nothing when there are no pins", () => {
    expect(orderPinnedSessions(sessions, [])).toEqual([])
  })
})

describe("pin list transitions", () => {
  it("puts the newest pin first", () => {
    expect(pinSessionId(["ses_a"], "ses_b")).toEqual(["ses_b", "ses_a"])
  })

  it("never touches other conversations when pinning", () => {
    expect(pinSessionId(["ses_a", "ses_c"], "ses_b")).toEqual(["ses_b", "ses_a", "ses_c"])
  })

  it("keeps the same reference when the conversation is already pinned", () => {
    const current = ["ses_a", "ses_b"]
    expect(pinSessionId(current, "ses_a")).toBe(current)
  })

  it("ignores an empty id", () => {
    const current = ["ses_a"]
    expect(pinSessionId(current, "")).toBe(current)
  })

  it("caps the list at the limit, dropping the oldest pin", () => {
    const full = Array.from({ length: PINNED_SESSIONS_LIMIT }, (_, index) => `ses_${index}`)
    const next = pinSessionId(full, "ses_new")
    expect(next).toHaveLength(PINNED_SESSIONS_LIMIT)
    expect(next[0]).toBe("ses_new")
    // آخر القائمة هو الأقدم في التثبيت — ده اللي بيقع
    expect(next).not.toContain(`ses_${PINNED_SESSIONS_LIMIT - 1}`)
  })

  it("removes only the unpinned conversation", () => {
    expect(unpinSessionId(["ses_a", "ses_b", "ses_c"], "ses_b")).toEqual(["ses_a", "ses_c"])
  })

  it("keeps the same reference when the conversation was not pinned", () => {
    const current = ["ses_a"]
    expect(unpinSessionId(current, "ses_b")).toBe(current)
  })

  it("drops deleted conversations from the pins", () => {
    expect(forgetSessionIds(["ses_a", "ses_b", "ses_c"], ["ses_b"])).toEqual(["ses_a", "ses_c"])
    expect(forgetSessionIds(["ses_a"], ["ses_a"])).toEqual([])
  })

  it("keeps the same reference when nothing was pinned", () => {
    const current = ["ses_a"]
    expect(forgetSessionIds(current, ["ses_z"])).toBe(current)
    expect(forgetSessionIds(current, [])).toBe(current)
  })

  it("keeps the order stable across a pin/unpin round trip", () => {
    const start = ["ses_a", "ses_b", "ses_c"]
    expect(unpinSessionId(pinSessionId(start, "ses_d"), "ses_d")).toEqual(start)
  })

  it("does not reorder the other conversations when re-pinning", () => {
    expect(pinSessionId(["ses_a", "ses_b"], "ses_a")).toEqual(["ses_a", "ses_b"])
  })
})
