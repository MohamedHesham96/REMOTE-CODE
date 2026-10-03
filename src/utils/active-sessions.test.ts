import { describe, expect, it } from "vitest"
import type { ActiveSession, Session } from "../types"
import { mergeActiveSessions, type ActiveProjectRef } from "./active-sessions"

const project: ActiveProjectRef = { worktree: "D:/work/pwa", name: "pwa" }

function session(id: string, updated: number): Session {
  return {
    id,
    projectID: "proj",
    directory: "D:/work/pwa",
    title: `session ${id}`,
    version: "1.18.32",
    time: { created: updated, updated },
  } as unknown as Session
}

function active(id: string, updated: number, worktree = "D:/work/other"): ActiveSession {
  return {
    id,
    title: `active ${id}`,
    directory: worktree,
    worktree,
    projectName: "other",
    status: { type: "busy" },
    updatedAt: updated,
  }
}

const none = new Set<string>()

describe("mergeActiveSessions", () => {
  // العطل الأصلي: /api/activity رجّعت [] والشريط الجانبي بيقول إن الجلسة شغالة
  // من statuses. العدّاد كان بيختفي والمحادثة شغالة قدام المستخدم.
  it("counts a working sidebar session the server activity list missed", () => {
    const merged = mergeActiveSessions([], [session("ses_a", 100)], new Set(["ses_a"]), none, { ses_a: { type: "busy" } }, project)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe("ses_a")
    expect(merged[0]?.worktree).toBe("D:/work/pwa")
    expect(merged[0]?.projectName).toBe("pwa")
    expect(merged[0]?.status).toEqual({ type: "busy" })
    expect(merged[0]?.updatedAt).toBe(100)
  })

  it("keeps sessions the server already reported without duplicating them", () => {
    const merged = mergeActiveSessions([active("ses_a", 100)], [session("ses_a", 100)], new Set(["ses_a"]), none, { ses_a: { type: "busy" } }, project)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.title).toBe("active ses_a")
    expect(merged[0]?.projectName).toBe("other")
  })

  // العطل الثاني: القائمة المدمجة كانت بتتغذى من نفسها، فكل جلسة ظهرت في
  // استجابة نشاط مرة واحدة كانت بتتنضم لنفسها كـ busy بعد ما السيرفر يشيلها —
  // واللوحة بتفضل بتعدّ محادثات خالصة للأبد.
  it("drops a session the server retired even though the sidebar still listed it as working", () => {
    // الـ statuses قالت idle، والـ activityIds القديمة لسه فيها الـ id — ده
    // بالظبط الشكل اللي بيخلّي العدّاد يقفز من واحد لأربعة وما بينزلش.
    const merged = mergeActiveSessions([], [session("ses_a", 100)], none, none, { ses_a: { type: "idle" } }, project)
    expect(merged).toHaveLength(0)
  })

  it("adds nothing when no session has any independent evidence of work", () => {
    const items = [active("ses_a", 100)]
    expect(mergeActiveSessions(items, [session("ses_b", 200)], none, none, {}, project)).toBe(items)
  })

  it("counts a queued request as work even when the stored status is idle", () => {
    const merged = mergeActiveSessions([], [session("ses_a", 100)], none, new Set(["ses_a"]), { ses_a: { type: "idle" } }, project)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.status).toEqual({ type: "busy" })
  })

  it("defaults to busy when a pending request has no stored status at all", () => {
    const merged = mergeActiveSessions([], [session("ses_a", 100)], none, new Set(["ses_a"]), {}, project)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.status).toEqual({ type: "busy" })
  })

  it("preserves the retry status as-is", () => {
    const retry = { type: "retry", attempt: 1, message: "rate limited", next: 5000 } as const
    const merged = mergeActiveSessions([], [session("ses_a", 100)], new Set(["ses_a"]), none, { ses_a: retry }, project)
    expect(merged[0]?.status).toEqual(retry)
  })

  it("ignores sessions neither the server nor the client says are working", () => {
    const merged = mergeActiveSessions([], [session("ses_a", 100)], new Set(["ses_b"]), new Set(["ses_b"]), { ses_a: { type: "busy" } }, project)
    expect(merged).toHaveLength(0)
  })

  it("returns the server list untouched when no project is open", () => {
    const items = [active("ses_a", 100)]
    expect(mergeActiveSessions(items, [session("ses_b", 200)], new Set(["ses_b"]), none, {}, null)).toBe(items)
  })

  it("returns the server list untouched when nothing is working locally", () => {
    const items = [active("ses_a", 100)]
    expect(mergeActiveSessions(items, [session("ses_b", 200)], none, none, {}, project)).toBe(items)
  })

  it("sorts the merged list by recency across both sources", () => {
    const merged = mergeActiveSessions(
      [active("ses_a", 100)],
      [session("ses_b", 300), session("ses_c", 200)],
      new Set(["ses_b", "ses_c"]),
      none,
      { ses_b: { type: "busy" }, ses_c: { type: "busy" } },
      project,
    )
    expect(merged.map((item) => item.id)).toEqual(["ses_b", "ses_c", "ses_a"])
  })

  it("does not mutate the server list it was given", () => {
    const items = [active("ses_a", 100)]
    mergeActiveSessions(items, [session("ses_b", 300)], new Set(["ses_b"]), none, { ses_b: { type: "busy" } }, project)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe("ses_a")
  })
})
