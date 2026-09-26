import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PINNED_SESSIONS_KEY, PINNED_SESSIONS_LIMIT } from "../constants"
import type { PinnedConversation } from "../types"
import {
  forgetPinnedConversations,
  hasLegacyPinnedFormat,
  loadPinnedConversations,
  pinBelongsToProject,
  pinConversation,
  pinProjectKey,
  pinsForProject,
  savePinnedConversations,
  stampPinnedProject,
  unpinConversation,
} from "./storage"

function pin(id: string, overrides: Partial<PinnedConversation> = {}): PinnedConversation {
  const merged = {
    id,
    title: `title ${id}`,
    created: 1000,
    directory: `/srv/${id}`,
    worktree: `/srv`,
    projectName: "srv",
    ...overrides,
  }
  return { ...merged, projectKey: pinProjectKey(merged.worktree, merged.directory) }
}

function write(value: string): void {
  ;(globalThis as unknown as { localStorage: Storage }).localStorage.setItem(PINNED_SESSIONS_KEY, value)
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

describe("pinned conversations cache", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadPinnedConversations()).toEqual([])
  })

  it("round-trips the full entries through localStorage", () => {
    savePinnedConversations([pin("ses_b"), pin("ses_a")])
    expect(loadPinnedConversations().map((item) => item.id)).toEqual(["ses_b", "ses_a"])
    expect(loadPinnedConversations()[0]?.title).toBe("title ses_b")
  })

  it("survives a full reload because the entries come back from localStorage", () => {
    savePinnedConversations([pin("ses_a"), pin("ses_b")])
    expect(loadPinnedConversations().map((item) => item.id)).toEqual(["ses_a", "ses_b"])
  })

  it("keeps pins from every project — the cache is not scoped to one", () => {
    savePinnedConversations([
      pin("ses_a", { worktree: "/srv/one", directory: "/srv/one", projectName: "one" }),
      pin("ses_b", { worktree: "/srv/two", directory: "/srv/two", projectName: "two" }),
    ])
    const loaded = loadPinnedConversations()
    expect(loaded.map((item) => item.projectName)).toEqual(["one", "two"])
  })

  it("migrates the legacy id-only format without losing the ids", () => {
    write(JSON.stringify(["ses_a", "ses_b"]))
    expect(loadPinnedConversations().map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(loadPinnedConversations()[0]).toEqual({
      id: "ses_a",
      title: "",
      created: 0,
      directory: "",
      worktree: "",
      projectKey: "",
      projectName: "",
    })
  })

  it("derives the project key from the stored paths, not from the cache", () => {
    // كاش باين أو متعدّل من الـ devtools: الـ projectKey بيتحسب من المسارات
    // عشان مثبّتة ما تقدرش تنسب نفسها لمشروع تاني
    write(JSON.stringify([{ ...pin("ses_a"), projectKey: "/srv/evil" }]))
    expect(loadPinnedConversations()[0]?.projectKey).toBe("/srv")
  })

  it("keeps an entry with no known project unattributed instead of guessing one", () => {
    write(JSON.stringify([{ id: "ses_legacy", title: "", created: 0, directory: "", worktree: "", projectName: "" }]))
    expect(loadPinnedConversations()[0]).toMatchObject({ id: "ses_legacy", projectKey: "" })
    expect(pinsForProject(loadPinnedConversations(), "/srv")).toEqual([])
  })

  it("flags the legacy format only while it is still there", () => {
    expect(hasLegacyPinnedFormat()).toBe(false)
    write(JSON.stringify(["ses_a"]))
    expect(hasLegacyPinnedFormat()).toBe(true)
    savePinnedConversations([pin("ses_a")])
    expect(hasLegacyPinnedFormat()).toBe(false)
  })

  it("drops duplicates, blanks and entries without an id", () => {
    write(JSON.stringify([{ id: "ses_a" }, { id: "ses_a" }, { id: "" }, { id: 42 }, null, pin("ses_b")]))
    expect(loadPinnedConversations().map((item) => item.id)).toEqual(["ses_a", "ses_b"])
  })

  it("caps the stored list so it cannot grow forever", () => {
    const many = Array.from({ length: PINNED_SESSIONS_LIMIT + 25 }, (_, index) => pin(`ses_${index}`))
    savePinnedConversations(many)
    expect(loadPinnedConversations()).toHaveLength(PINNED_SESSIONS_LIMIT)
    // الأحدث تثبيتًا (أول القائمة) هو اللي يفضل محفوظ
    expect(loadPinnedConversations()[0]?.id).toBe("ses_0")
  })

  it("ignores corrupt or non-array payloads", () => {
    write("{not json")
    expect(loadPinnedConversations()).toEqual([])
    write('{"ses_a":true}')
    expect(loadPinnedConversations()).toEqual([])
  })

  it("does not rewrite the same value", () => {
    savePinnedConversations([pin("ses_a")])
    const setItem = vi.spyOn(globalThis.localStorage, "setItem")
    savePinnedConversations([pin("ses_a")])
    expect(setItem).not.toHaveBeenCalled()
  })

  it("keeps working when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied") },
      setItem: () => { throw new Error("denied") },
      removeItem: () => { throw new Error("denied") },
      clear: () => { throw new Error("denied") },
    })
    expect(loadPinnedConversations()).toEqual([])
    expect(() => savePinnedConversations([pin("ses_a")])).not.toThrow()
  })
})

describe("pinned conversations per project", () => {
  const one = pin("ses_a", { worktree: "/srv/one", directory: "/srv/one", projectName: "one" })
  const two = pin("ses_b", { worktree: "/srv/two", directory: "/srv/two", projectName: "two" })
  const list = [one, two]

  it("uses the normalized project path as the stable key", () => {
    expect(pinProjectKey("/srv/one/", "")).toBe("/srv/one")
    expect(pinProjectKey("/srv/one", "/srv/one/nested")).toBe("/srv/one")
    expect(pinProjectKey("", "/srv/two")).toBe("/srv/two")
    expect(pinProjectKey("", "")).toBe("")
    // نفس المسار بكتابة مختلفة (Windows) = نفس المشروع
    expect(pinProjectKey("C:\\Work\\App", "")).toBe(pinProjectKey("c:/work/app/", ""))
  })

  it("shows only the pins of the selected project", () => {
    expect(pinsForProject(list, "/srv/one").map((item) => item.id)).toEqual(["ses_a"])
    expect(pinsForProject(list, "/srv/two").map((item) => item.id)).toEqual(["ses_b"])
    expect(pinsForProject(list, "/srv/three")).toEqual([])
  })

  it("matches the project no matter how the path was written", () => {
    expect(pinsForProject(list, "/srv/one/").map((item) => item.id)).toEqual(["ses_a"])
  })

  it("shows nothing without a selected project, so pins never leak sideways", () => {
    expect(pinsForProject(list, null)).toEqual([])
    expect(pinsForProject(list, "")).toEqual([])
    expect(pinBelongsToProject(one, null)).toBe(false)
  })

  it("keeps the same array reference when the project owns every pin", () => {
    const only = [one]
    expect(pinsForProject(only, "/srv/one")).toBe(only)
  })

  it("stamps a pin with the open project so it can never land in another one", () => {
    const stamped = stampPinnedProject(
      { ...one, worktree: "/srv/evil", directory: "/srv/evil", projectKey: "/srv/evil", projectName: "evil" },
      "/srv/one",
      "one",
    )
    expect(stamped).toMatchObject({ worktree: "/srv/one", directory: "/srv/one", projectKey: "/srv/one", projectName: "one" })
    expect(pinsForProject([stamped], "/srv/one")).toHaveLength(1)
    expect(pinsForProject([stamped], "/srv/evil")).toEqual([])
  })

  it("keeps the session directory when the project path is unknown", () => {
    const stamped = stampPinnedProject(pin("ses_a"), "", "")
    expect(stamped.projectKey).toBe("/srv")
    expect(stamped.directory).toBe("/srv/ses_a")
  })
})

describe("pin list transitions", () => {
  it("puts the newest pin first", () => {
    expect(pinConversation([pin("ses_a")], pin("ses_b")).map((item) => item.id)).toEqual(["ses_b", "ses_a"])
  })

  it("never touches other conversations when pinning", () => {
    const next = pinConversation([pin("ses_a"), pin("ses_c")], pin("ses_b"))
    expect(next.map((item) => item.id)).toEqual(["ses_b", "ses_a", "ses_c"])
  })

  it("moves an already pinned conversation back to the top and refreshes its data", () => {
    const current = [pin("ses_a", { title: "old" }), pin("ses_b")]
    const next = pinConversation(current, pin("ses_a", { title: "new" }))
    expect(next.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(next[0]?.title).toBe("new")
  })

  it("ignores an empty id", () => {
    const current = [pin("ses_a")]
    expect(pinConversation(current, pin(""))).toBe(current)
  })

  it("caps the list at the limit, dropping the oldest pin", () => {
    const full = Array.from({ length: PINNED_SESSIONS_LIMIT }, (_, index) => pin(`ses_${index}`))
    const next = pinConversation(full, pin("ses_new"))
    expect(next).toHaveLength(PINNED_SESSIONS_LIMIT)
    expect(next[0]?.id).toBe("ses_new")
    // آخر القائمة هو الأقدم في التثبيت — ده اللي بيقع
    expect(next.map((item) => item.id)).not.toContain(`ses_${PINNED_SESSIONS_LIMIT - 1}`)
  })

  it("removes only the unpinned conversation", () => {
    const current = [pin("ses_a"), pin("ses_b"), pin("ses_c")]
    expect(unpinConversation(current, "ses_b").map((item) => item.id)).toEqual(["ses_a", "ses_c"])
  })

  it("keeps the same reference when the conversation was not pinned", () => {
    const current = [pin("ses_a")]
    expect(unpinConversation(current, "ses_b")).toBe(current)
  })

  it("drops deleted conversations from the pins", () => {
    const current = [pin("ses_a"), pin("ses_b"), pin("ses_c")]
    expect(forgetPinnedConversations(current, ["ses_b"]).map((item) => item.id)).toEqual(["ses_a", "ses_c"])
    expect(forgetPinnedConversations(current, ["ses_a", "ses_b", "ses_c"])).toEqual([])
  })

  it("keeps the same reference when nothing was pinned", () => {
    const current = [pin("ses_a")]
    expect(forgetPinnedConversations(current, ["ses_z"])).toBe(current)
    expect(forgetPinnedConversations(current, [])).toBe(current)
  })

  it("keeps the order stable across a pin/unpin round trip", () => {
    const start = [pin("ses_a"), pin("ses_b"), pin("ses_c")]
    const round = unpinConversation(pinConversation(start, pin("ses_d")), "ses_d")
    expect(round.map((item) => item.id)).toEqual(["ses_a", "ses_b", "ses_c"])
  })
})
