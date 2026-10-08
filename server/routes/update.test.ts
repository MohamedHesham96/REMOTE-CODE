import express from "express"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateInfo } from "../update.js"
import { registerUpdateRoutes } from "./update.js"
import type { RouteContext } from "./context.js"

// اختبار HTTP حقيقي على بورت 0: عقد الراوت ثابت للواجهة، والفشل غير المتوقع
// لازم يمر من معالج الأخطاء الموحّد بدل ما يسقط الطلب بصمت.
let server: Server
let base = ""
let checkImpl: () => Promise<UpdateInfo>

const payload: UpdateInfo = {
  currentVersion: "1.8.1",
  latestVersion: "1.9.0",
  updateAvailable: true,
  releaseUrl: "https://github.com/owner/repo/releases",
  releaseNotes: null,
  checkedAt: 1_000,
}

beforeEach(async () => {
  checkImpl = () => Promise.resolve(payload)
  const handleError = vi.fn((_error: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => {
    response.status(500).json({ error: "SERVER_ERROR" })
  })
  const app = express()
  const ctx = {
    update: { check: () => checkImpl() },
    connection: { handleError },
  } as unknown as RouteContext
  registerUpdateRoutes(app, ctx)
  server = createServer(app)
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()) })
})

describe("GET /api/update", () => {
  it("returns the cached check result as JSON", async () => {
    const response = await fetch(`${base}/api/update`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(payload)
  })

  it("routes unexpected failures through the shared error handler", async () => {
    checkImpl = () => Promise.reject(new Error("boom"))
    const response = await fetch(`${base}/api/update`)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "SERVER_ERROR" })
  })
})
