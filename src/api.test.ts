import { afterEach, describe, expect, it, vi } from "vitest"
import { rejectQuestion, renameSession, replyQuestion } from "./api"
import type { Session } from "./types"

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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(renamed), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(renameSession(renamed.id, renamed.title)).resolves.toEqual(renamed)
    expect(fetchMock).toHaveBeenCalledWith("/api/session/session%2Fid", expect.objectContaining({
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
