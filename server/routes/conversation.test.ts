import express from "express"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelInfo, PromptAttachment } from "../opencode/types.js"
import { registerConversationRoutes } from "./conversation.js"
import type { RouteContext } from "./context.js"

// اختبار على مستوى الـ HTTP الحقيقي لمسار الرسائل: المرفقات بتتحقق، النص
// مش مطلوب لو معاه مرفق، والقدرات بتمنع صورة/PDF لموديل نصي على السيرفر
// حتى لو عميل قديم حاول يبعتها.
const VISION: ModelInfo = { id: "vision", providerID: "p", name: "Vision", free: false, enabled: true, capabilities: { input: ["text", "image", "pdf"] } }
const TEXT_ONLY: ModelInfo = { id: "plain", providerID: "p", name: "Plain", free: false, enabled: true, capabilities: { input: ["text"] } }

const IMAGE = "data:image/png;base64,iVBORw0KGgo="
const PDF = "data:application/pdf;base64,JVBERi0="
const TEXT = "data:text/plain;base64,SGVsbG8="

let server: Server
let base = ""
let promptCalls: Array<{ id: string; text: string; attachments?: PromptAttachment[] }>
let models = [VISION, TEXT_ONLY]
let sessionModelValue: string | null = "vision"
let retryCalls: Array<{ id: string; requestId: string }>

beforeEach(async () => {
  promptCalls = []
  models = [VISION, TEXT_ONLY]
  sessionModelValue = "vision"
  retryCalls = []
  const app = express()
  app.use(express.json())
  const ctx = {
    openCode: {
      prompt: (id: string, text: string, _agent?: string, _model?: unknown, attachments?: PromptAttachment[]) => {
        promptCalls.push({ id, text, attachments })
        return Promise.resolve({ queued: false })
      },
      sessionModel: () => Promise.resolve({
        model: sessionModelValue ? { providerID: "p", modelID: sessionModelValue } : null,
        defaultModel: null,
      }),
      models: () => Promise.resolve(models),
      retryFailedRequest: (id: string, requestId: string) => {
        retryCalls.push({ id, requestId })
        return Promise.resolve({ retried: true, queued: false })
      },
    },
    pollLimiter: (_request: unknown, _response: unknown, next: () => void) => next(),
    connection: { handleError: vi.fn((_error: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => response.status(500).json({ error: "SERVER_ERROR" })) },
  } as unknown as RouteContext
  registerConversationRoutes(app, ctx)

  server = createServer(app)
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()) })
})

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/api/session/ses_test/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

async function retry(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/api/session/ses_test/request/msg_failed/retry`, { method: "POST" })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

describe("message attachments", () => {
  it("يمرّر صورة لموديل يدعم الصور", async () => {
    const result = await post({ text: "شوف الصورة", attachments: [{ uri: IMAGE, name: "photo.png" }] })

    expect(result.status).toBe(202)
    expect(promptCalls).toEqual([
      {
        id: "ses_test",
        text: "شوف الصورة",
        attachments: [{ uri: IMAGE, name: "photo.png", modality: "image" }],
      },
    ])
  })

  it("يرفض صورة لموديل نصي", async () => {
    sessionModelValue = "plain"
    const result = await post({ text: "شوف", attachments: [{ uri: IMAGE, name: "photo.png" }] })

    expect(result.status).toBe(400)
    expect(result.body.error).toBe("ATTACHMENT_UNSUPPORTED")
    expect(promptCalls).toEqual([])
  })

  it("يقبل ملف نصي مع موديل نصي", async () => {
    sessionModelValue = "plain"
    const result = await post({ attachments: [{ uri: TEXT, name: "notes.txt" }] })

    expect(result.status).toBe(202)
    expect(promptCalls[0]?.attachments).toEqual([{ uri: TEXT, name: "notes.txt", modality: "text" }])
  })

  it("يرفض PDF لموديل مايدعمش PDF", async () => {
    models = [{ ...VISION, capabilities: { input: ["text", "image"] } }]
    const result = await post({ text: "شوف", attachments: [{ uri: PDF, name: "doc.pdf" }] })

    expect(result.status).toBe(400)
    expect(result.body.error).toBe("ATTACHMENT_UNSUPPORTED")
  })

  it("يرفض مرفقًا برابط HTTP بدل data:", async () => {
    const result = await post({ text: "شوف", attachments: [{ uri: "https://example.com/a.png", name: "a.png" }] })

    expect(result.status).toBe(400)
    expect(result.body.error).toBe("ATTACHMENT_INVALID")
  })

  it("يرفض رسالة فاضية بلا مرفقات", async () => {
    const result = await post({ text: "" })

    expect(result.status).toBe(400)
    expect(result.body.error).toBe("EMPTY_MESSAGE")
  })

  it("يقبل مرفق بلا نص", async () => {
    const result = await post({ attachments: [{ uri: IMAGE, name: "photo.png" }] })

    expect(result.status).toBe(202)
    expect(promptCalls[0]?.text).toBe("")
  })
})

describe("failed request retry", () => {
  it("retries the failed request in its existing session", async () => {
    const result = await retry()

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ retried: true, queued: false })
    expect(retryCalls).toEqual([{ id: "ses_test", requestId: "msg_failed" }])
  })
})
