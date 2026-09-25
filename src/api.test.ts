import { afterEach, describe, expect, it, vi } from "vitest"
import { getRequests, rejectQuestion, renameSession, replyQuestion, sendMessage } from "./api"
import type { Session, SessionRequest, SessionRequests } from "./types"

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
    const payload: SessionRequests = { status: { type: "busy" }, requests: [queued], questions: [], queued: 1 }
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
})
