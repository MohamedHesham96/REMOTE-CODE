import express from "express"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerInteractionRoutes } from "./interaction.js"
import type { RouteContext } from "./context.js"

let server: Server
let base = ""
let attentionCalls: ReturnType<typeof vi.fn>

beforeEach(async () => {
  attentionCalls = vi.fn(() => Promise.resolve([{
    kind: "question",
    sessionID: "ses_one",
    sessionTitle: "Review parser",
    projectName: "Workspace",
    directory: "C:/workspace",
    request: { id: "form_one", sessionID: "ses_one", questions: [] },
  }]))
  const app = express()
  const ctx = {
    openCode: {
      attention: attentionCalls,
      permissionsVersionValue: () => "0",
      permissions: () => [],
    },
    pollLimiter: (_request: unknown, _response: unknown, next: () => void) => next(),
    connection: {
      handleError: vi.fn((_error: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => response.status(500).json({ error: "SERVER_ERROR" })),
    },
  } as unknown as RouteContext
  registerInteractionRoutes(app, ctx)
  server = createServer(app)
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()) })
})

describe("needs-attention snapshot", () => {
  it("returns cross-session context and supports conditional refresh", async () => {
    const first = await fetch(`${base}/api/attention`)
    const etag = first.headers.get("ETag")

    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject([{ sessionID: "ses_one", sessionTitle: "Review parser", projectName: "Workspace" }])
    expect(etag).toBeTruthy()

    const second = await fetch(`${base}/api/attention`, { headers: { "If-None-Match": etag || "" } })
    expect(second.status).toBe(304)
    expect(attentionCalls).toHaveBeenCalledTimes(2)
  })
})
