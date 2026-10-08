import { afterEach, describe, expect, it, vi } from "vitest"
import { addFavorite, addPin, branchSession, forgetPins, getFavorites, getPins, mergePins, removeFavorite, removePin, updateFavorite } from "./api"
import { getAttention, getRequests, getStatuses, listPermissions, rejectQuestion, removeQueuedRequest, renameSession, replyQuestion, retryFailedRequest, runQueuedRequest, sendMessage, skipRunningRequest } from "./api"
import { clearEtagCache } from "./api/http"
import type { FavoritePrompt, PinnedConversation, Session, SessionRequest, SessionRequests, SessionStatus } from "./types"

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
    usedTools: [],
    resultFiles: [],
    attachments: [],
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

  it("steers a queued request into the running task through its card id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ started: false, steered: true, queued: false, remaining: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(runQueuedRequest("session/id", queued.id)).resolves.toEqual({ started: false, steered: true, queued: false, remaining: 1 })
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

describe("favorite prompts", () => {
  const favorite: FavoritePrompt = { id: "fav_1", text: "Fix authentication", label: "Fix authentication", createdAt: 1 }

  function respondWith(favorites: FavoritePrompt[]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ favorites }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("reads the whole list from the server", async () => {
    const fetchMock = respondWith([favorite])
    await expect(getFavorites()).resolves.toEqual([favorite])
    expect(fetchMock).toHaveBeenCalledWith("/api/favorites", expect.objectContaining({ credentials: "include" }))
  })

  it("saves a prompt with the request language and takes the server list back", async () => {
    const fetchMock = respondWith([favorite])
    await expect(addFavorite("Fix authentication", "fav_1", "en")).resolves.toEqual([favorite])
    expect(fetchMock).toHaveBeenCalledWith("/api/favorites?lang=en", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ favorite: { text: "Fix authentication", id: "fav_1" } }),
      credentials: "include",
    }))
  })

  it("updates the text or the label of a favorite", async () => {
    const fetchMock = respondWith([favorite])
    await expect(updateFavorite("fav/1", { text: "New text", label: "New name" })).resolves.toEqual([favorite])
    expect(fetchMock).toHaveBeenCalledWith("/api/favorites/fav%2F1?lang=ar", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ favorite: { text: "New text", label: "New name" } }),
    }))
  })

  it("removes a favorite by its encoded id", async () => {
    const fetchMock = respondWith([])
    await expect(removeFavorite("fav/1", "ar")).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith("/api/favorites/fav%2F1?lang=ar", expect.objectContaining({ method: "DELETE" }))
  })
})

describe("branch session", () => {
  it("posts to the branch endpoint with the request language and returns the new session", async () => {
    const branch = { id: "ses_branch", title: "Implement authentication — Branch", directory: "/srv", time: { created: 3, updated: 3 } } as Session
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(branch), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(branchSession("ses/original", "en")).resolves.toEqual(branch)
    expect(fetchMock).toHaveBeenCalledWith("/api/session/ses%2Foriginal/branch?lang=en", expect.objectContaining({
      method: "POST",
      credentials: "include",
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

  it("reuses unchanged request objects when a refreshed response changes another turn", async () => {
    const baseline: SessionRequest = {
      id: "request-1",
      index: 1,
      prompt: "prompt",
      state: "done",
      activity: "ready",
      finalResult: "finished",
      liveText: "",
      stepsCompleted: 1,
      activeTool: null,
      usedTools: [],
      resultFiles: [],
      attachments: [],
      startedAt: 1,
      completedAt: 2,
      updatedAt: 2,
    }
    const unchanged = { ...baseline, id: "done-1" }
    const running = { ...baseline, id: "running-1", state: "running" as const, completedAt: 0 }
    const question = {
      id: "form-1",
      sessionID: "session/structural-sharing",
      questions: [{ question: "Choose", header: "choice", options: [{ label: "yes", description: "" }], multiple: false, custom: false }],
    }
    const responses = [
      { status: { type: "busy" as const }, requests: [unchanged, running], questions: [question], queued: 1, stalled: false, version: "one" },
      { status: { type: "busy" as const }, requests: [unchanged, { ...running, liveText: "new text" }], questions: [question], queued: 1, stalled: false, version: "two" },
    ]
    let index = 0
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(responses[index++]), {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: `W/"version-${index}"` },
    })))
    vi.stubGlobal("fetch", fetchMock)

    const first = await getRequests("session/structural-sharing")
    const second = await getRequests("session/structural-sharing")

    expect(second.requests[0]).toBe(first.requests[0])
    expect(second.requests).not.toBe(first.requests)
    expect(second.requests[1]).not.toBe(first.requests[1])
    expect(second.requests[1]?.liveText).toBe("new text")
    expect(second.questions).toBe(first.questions)
  })
})

describe("workflow requests", () => {
  it("loads server-owned attention and retries a failed turn by its existing session id", async () => {
    const payload = [{ kind: "permission", sessionID: "ses_one", sessionTitle: "Build", projectName: "app", directory: "/app", permission: { id: "perm_1", sessionID: "ses_one", title: "Run tests" } }]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ retried: true, queued: false }), { status: 200, headers: { "Content-Type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getAttention()).resolves.toEqual(payload)
    await expect(retryFailedRequest("ses/one", "msg_failed")).resolves.toEqual({ retried: true, queued: false })
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/session/ses%2Fone/request/msg_failed/retry", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }))
  })
})

describe("generic ETag handling in request()", () => {
  it("sends If-None-Match after the first successful response and reuses the cached payload on 304", async () => {
    clearEtagCache()
    const payload = [{ id: "perm_1", sessionID: "s1", title: "Allow read?" }]
    const seen: Array<Record<string, string>> = []
    let callNumber = 0
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const recorded: Record<string, string> = {}
      headers.forEach((value, key) => {
        recorded[key.toLowerCase()] = value
      })
      seen.push(recorded)
      callNumber += 1
      if (callNumber === 1) {
        return Promise.resolve(new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: 'W/"perm-v1"' },
        }))
      }
      return Promise.resolve(new Response(null, { status: 304 }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const first = await listPermissions()
    expect(first).toEqual(payload)
    expect(seen[0]).not.toHaveProperty("if-none-match")

    const second = await listPermissions()
    expect(second).toBe(first)
    expect(seen[1]?.["if-none-match"]).toBe('W/"perm-v1"')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
