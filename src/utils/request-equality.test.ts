import { describe, expect, it } from "vitest"
import type { ConversationQuestionRequest, SessionRequest } from "../types"
import { sameConversationQuestionRequest, sameSessionRequest } from "./request-equality"

function request(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    id: "request-1",
    index: 1,
    prompt: "prompt",
    state: "done",
    activity: "ready",
    finalResult: "result",
    liveText: "",
    stepsCompleted: 1,
    activeTool: null,
    usedTools: ["read"],
    resultFiles: [{ id: "file-1", name: "file.txt", mime: "text/plain", path: "file.txt", downloadUrl: "/file" }],
    usage: { tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0.02 },
    attachments: [{ name: "input.txt", mime: "text/plain", uri: "data:text/plain;base64,AA==" }],
    startedAt: 1,
    completedAt: 2,
    updatedAt: 2,
    ...overrides,
  }
}

describe("sameSessionRequest", () => {
  it("treats equivalent parsed responses as equal", () => {
    expect(sameSessionRequest(request(), request())).toBe(true)
  })

  it("detects changes to request values and nested list entries", () => {
    expect(sameSessionRequest(request(), request({ liveText: "new text" }))).toBe(false)
    expect(sameSessionRequest(request(), request({ usedTools: ["write"] }))).toBe(false)
    expect(sameSessionRequest(request(), request({ resultFiles: [] }))).toBe(false)
    expect(sameSessionRequest(request(), request({ attachments: [] }))).toBe(false)
    expect(sameSessionRequest(request(), request({ error: "provider failed" }))).toBe(false)
    expect(sameSessionRequest(request(), request({ usage: { tokens: null, cost: null } }))).toBe(false)
    expect(sameSessionRequest(request(), request({ usage: { tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0.03 } }))).toBe(false)
    expect(sameSessionRequest(
      request({ usage: { tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0.02 } }),
      request({ usage: { tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0.02 } }),
    )).toBe(true)
  })
})

describe("sameConversationQuestionRequest", () => {
  const question: ConversationQuestionRequest = {
    id: "form-1",
    sessionID: "session-1",
    questions: [{ question: "Choose", header: "choice", options: [{ label: "yes", description: "" }], multiple: false, custom: false }],
  }

  it("treats equivalent parsed forms as equal", () => {
    expect(sameConversationQuestionRequest(question, structuredClone(question))).toBe(true)
  })

  it("detects changed options", () => {
    const changed = structuredClone(question)
    changed.questions[0]!.options[0]!.label = "no"
    expect(sameConversationQuestionRequest(question, changed)).toBe(false)
  })
})
