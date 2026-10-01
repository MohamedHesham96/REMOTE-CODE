import { afterEach, describe, expect, it, vi } from "vitest"
import { addPin, forgetPins, getPins, mergePins, removePin } from "./api"
import { getRequests, getStatuses, rejectQuestion, removeQueuedRequest, renameSession, replyQuestion, runQueuedRequest, sendMessage, skipRunningRequest } from "./api"
import type { PinnedConversation, Session, SessionRequest, SessionRequests, SessionStatus } from "./types"

function pin(id: string, overrides: Partial<PinnedConversation> = {}): PinnedConversation {
  return {
    id,
    title: `title ${id}`,
    created: 1000,
    directory: "/srv/one",
    worktree: "/srv/one",
    projectKey: "/srv/one",
    projectName: "one",
    ...overrides,
  }
}

function decodeBase64(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  return Uint8Array.from(globalThis.atob(base64), (character) => character.charCodeAt(0))
}

describe("push key decoding", () => {
  it("decodes a VAPID public key", () => {
    expect([...decodeBase64("AQAB")]).toEqual([1, 0, 1])
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("renameSession", () => {
  it("updates a session and returns the renamed value", async () => {
    const renamed = { id: "session/id", title: "المحادثة الجديدة" } as Session
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(renamed), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })))
    vi.stubGlobal("fetch", fetchMock)

    await expect(renameSession(renamed.id, renamed.title)).resolves.toEqual(renamed)
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid?lang=ar", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ title: renamed.title }),
      credentials: "include",
    }))

    await expect(renameSession(renamed.id, renamed.title, "en")).resolves.toEqual(renamed)
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid?lang=en", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ title: renamed.title }),
      credentials: "include",
    }))
  })
})

describe("question answers", () => {
  it("sends selected options to the matching question request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(replyQuestion("session/id", "request/id", [["الخيار الأول"]])).resolves.toEqual({ accepted: true })
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid/question/request%2Fid/reply", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ answers: [["الخيار الأول"]] }),
      credentials: "include",
    }))
  })

  it("rejects the matching question request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(rejectQuestion("session/id", "request/id")).resolves.toEqual({ accepted: true })
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid/question/request%2Fid/reject", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }))
  })
})

describe("parallel requests", () => {
  const queued: SessionRequest = {
    id: "queued:q2",
    index: 2,
    prompt: "الطلب التاني",
    state: "queued",
    activity: "في الانتظار",
    finalResult: "",
    liveText: "",
    stepsCompleted: 0,
    activeTool: null,
    todos: [],
    completedTodos: 0,
    totalTodos: 0,
    resultFiles: [],
    startedAt: 2,
    completedAt: 0,
    updatedAt: 2,
  }

  it("reports whether the sent request had to wait in the queue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true, queued: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(sendMessage("session/id", "الطلب التاني")).resolves.toEqual({ accepted: true, queued: true })
  })

  it("returns the stacked request cards oldest first", async () => {
    const payload: SessionRequests = { status: { type: "busy" }, requests: [queued], questions: [], queued: 1, stalled: false, version: "busy|live|1||q|..." }
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getRequests("session/id")).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid/requests?lang=ar", expect.objectContaining({
      credentials: "include",
    }))

    await expect(getRequests("session/id", "en")).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid/requests?lang=en", expect.objectContaining({
      credentials: "include",
    }))
  })

  it("removes one queued request by its card id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ removed: true, remaining: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(removeQueuedRequest("session/id", queued.id)).resolves.toEqual({ removed: true, remaining: 0 })
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid/request/queued%3Aq2", expect.objectContaining({
      method: "DELETE",
      credentials: "include",
    }))
  })

  it("skips the running request and reports what is left in the queue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ skipped: true, remaining: 2 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(skipRunningRequest("session/id")).resolves.toEqual({ skipped: true, remaining: 2 })
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid/skip", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }))
  })

  it("runs a queued request now through its card id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ started: true, remaining: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(runQueuedRequest("session/id", queued.id)).resolves.toEqual({ started: true, remaining: 1 })
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid/request/queued%3Aq2/run", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }))
  })
})

describe("pinned conversations", () => {
  function respondWith(pins: PinnedConversation[]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ pins }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("reads the whole list from the server", async () => {
    const fetchMock = respondWith([pin("ses_a")])
    await expect(getPins()).resolves.toEqual([pin("ses_a")])
    expect(fetchMock).toHaveBeenCalledWith("/api/pin", expect.objectContaining({ credentials: "include" }))
  })

  it("pins a conversation with its project and takes the server list back", async () => {
    const fetchMock = respondWith([pin("ses_a")])
    await expect(addPin(pin("ses_a"))).resolves.toEqual([pin("ses_a")])
    expect(fetchMock).toHaveBeenCalledWith("/api/pin", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ pin: pin("ses_a") }),
    }))
  })

  it("unpins a conversation by its id", async () => {
    const fetchMock = respondWith([])
    await expect(removePin("ses/a")).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith("/api/pin/ses%2Fa", expect.objectContaining({ method: "DELETE" }))
  })

  it("forgets deleted conversations in one call", async () => {
    const fetchMock = respondWith([])
    await forgetPins(["ses_a", "ses_b"])
    expect(fetchMock).toHaveBeenCalledWith("/api/pin/forget", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ ids: ["ses_a", "ses_b"] }),
    }))
  })

  it("merges a device cache instead of replacing the server list", async () => {
    const fetchMock = respondWith([pin("ses_a")])
    await mergePins([pin("ses_a"), pin("ses_b")])
    expect(fetchMock).toHaveBeenCalledWith("/api/pin/merge", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ pins: [pin("ses_a"), pin("ses_b")] }),
    }))
  })
})

describe("request efficiency", () => {
  it("dedups concurrent identical GETs into a single fetch", async () => {
    const statuses = { "session/id": { type: "idle" } as SessionStatus }
    let calls = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      calls += 1
      return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(statuses), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })), 10))
    })
    vi.stubGlobal("fetch", fetchMock)

    const [first, second] = await Promise.all([getStatuses(), getStatuses()])
    expect(first).toEqual(statuses)
    expect(second).toEqual(statuses)
    expect(calls).toBe(1)
  })

  it("sends If-None-Match and reuses the cached payload on 304", async () => {
    const payload: SessionRequests = { status: { type: "busy" }, requests: [], questions: [], queued: 0, stalled: false, version: "busy|live|0|||" }
    const seen: Array<Record<string, string>> = []
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) })
      if (seen.length === 1) {
        return Promise.resolve(new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: 'W/"abc-9"' },
        }))
      }
      return Promise.resolve(new Response(null, { status: 304 }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const first = await getRequests("session/etag")
    expect(first).toEqual(payload)
    expect(seen[0]).not.toHaveProperty("If-None-Match")

    // 304 = نفس المرجع المخزّن (React يعمل bail-out ولا يعيد الـ render)
    const second = await getRequests("session/etag")
    expect(second).toBe(first)
    expect(seen[1]?.["If-None-Match"]).toBe('W/"abc-9"')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
