import express from "express"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_PINNED_MODELS, ModelPinService } from "../model-pins.js"
import { EventHub, modelPinsEvent } from "../sse/hub.js"
import { registerEventRoutes } from "./events.js"
import { registerModelPinRoutes } from "./model-pins.js"
import type { RouteContext } from "./context.js"

// اختبار على مستوى الـ HTTP الحقيقي: التثبيت والإزالة والدمج والبثّ الحي على
// قناة الأحداث — ده بالظبط اللي بيخلّي التثبيت من الموبايل يوصل للويب.
let dir = ""
let server: Server
let base = ""
let modelPins: ModelPinService
const broadcasts: string[][] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "model-pin-routes-"))
  modelPins = new ModelPinService(join(dir, "model-pins.json"))
  broadcasts.length = 0
  const hub = new EventHub()
  // نفس التوصيل في server/index.ts: أي تعديل → بثّ لكل الـ clients
  modelPins.subscribe((models) => broadcasts.push(models))
  modelPins.subscribe((models) => hub.broadcast(modelPinsEvent(models)))

  const app = express()
  app.use(express.json())
  const ctx = {
    modelPins,
    hub,
    connection: { handleError: vi.fn((_error: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => response.status(500).json({ error: "SERVER_ERROR" })) },
  } as unknown as RouteContext
  registerModelPinRoutes(app, ctx)
  registerEventRoutes(app, ctx)

  server = createServer(app)
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()) })
  await rm(dir, { recursive: true, force: true })
})

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

// جهاز متصل على قناة الأحداث: بنقرا الـ frames لحد ما نلاقي حدث النماذج
async function openEventStream(): Promise<{ nextModels: () => Promise<string[]>; close: () => Promise<void> }> {
  const response = await fetch(`${base}/api/events`)
  const body = response.body
  if (!body) {
    throw new Error("no event stream")
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""

  const readFrame = async (): Promise<string> => {
    while (true) {
      const boundary = buffered.indexOf("\n\n")
      if (boundary >= 0) {
        const frame = buffered.slice(0, boundary)
        buffered = buffered.slice(boundary + 2)
        return frame
      }
      const chunk = await reader.read()
      if (chunk.done) {
        throw new Error("event stream closed")
      }
      buffered += decoder.decode(chunk.value, { stream: true })
    }
  }

  return {
    async nextModels(): Promise<string[]> {
      while (true) {
        const frame = await readFrame()
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) {
            continue
          }
          const payload = JSON.parse(line.slice(6)) as { models?: string[] }
          if (Array.isArray(payload.models)) {
            return payload.models
          }
        }
      }
    },
    async close(): Promise<void> {
      await reader.cancel().catch(() => undefined)
    },
  }
}

describe("GET /api/model-pin", () => {
  it("starts empty and then returns the stored keys", async () => {
    expect((await call("GET", "/api/model-pin")).body.models).toEqual([])
    await call("POST", "/api/model-pin", { model: "opencode/one" })
    expect((await call("GET", "/api/model-pin")).body.models).toEqual(["opencode/one"])
  })
})

describe("POST /api/model-pin", () => {
  it("stores the key with the newest first", async () => {
    const first = await call("POST", "/api/model-pin", { model: "opencode/one" })
    expect(first.status).toBe(201)
    const second = await call("POST", "/api/model-pin", { model: "openrouter/openai/gpt-4o" })
    expect(second.body.models).toEqual(["openrouter/openai/gpt-4o", "opencode/one"])
  })

  it("rejects a malformed key and keeps the stored list untouched", async () => {
    await call("POST", "/api/model-pin", { model: "opencode/one" })
    const { status, body } = await call("POST", "/api/model-pin", { model: "no-slash" })
    expect(status).toBe(400)
    expect(body.error).toBe("INVALID_MODEL_PIN")
    expect((await call("GET", "/api/model-pin")).body.models).toEqual(["opencode/one"])
  })

  it("refuses a sixth key without evicting an existing one", async () => {
    for (let i = 0; i < MAX_PINNED_MODELS; i += 1) {
      await call("POST", "/api/model-pin", { model: `opencode/model-${i}` })
    }
    const { status, body } = await call("POST", "/api/model-pin", { model: "opencode/extra" })
    expect(status).toBe(409)
    expect(body.error).toBe("MODEL_PINS_FULL")
    expect((await call("GET", "/api/model-pin")).body.models).toHaveLength(MAX_PINNED_MODELS)
  })
})

describe("POST /api/model-pin/merge", () => {
  it("merges a device list without dropping the stored keys", async () => {
    await call("POST", "/api/model-pin", { model: "opencode/server" })
    const { body } = await call("POST", "/api/model-pin/merge", { models: ["openrouter/device"] })
    expect(body.models).toEqual(["opencode/server", "openrouter/device"])
  })

  it("does not duplicate a key both devices already have", async () => {
    await call("POST", "/api/model-pin", { model: "opencode/one" })
    const { body } = await call("POST", "/api/model-pin/merge", { models: ["opencode/one"] })
    expect(body.models).toEqual(["opencode/one"])
  })

  it("ignores a merge body that is not a list", async () => {
    await call("POST", "/api/model-pin", { model: "opencode/one" })
    const { body } = await call("POST", "/api/model-pin/merge", { models: "nope" })
    expect(body.models).toEqual(["opencode/one"])
  })
})

describe("POST /api/model-pin/remove", () => {
  it("removes one key and ignores one that is not pinned", async () => {
    await call("POST", "/api/model-pin", { model: "opencode/one" })
    await call("POST", "/api/model-pin", { model: "opencode/two" })
    expect((await call("POST", "/api/model-pin/remove", { model: "opencode/one" })).body.models).toEqual(["opencode/two"])
    expect((await call("POST", "/api/model-pin/remove", { model: "opencode/nope" })).body.models).toEqual(["opencode/two"])
  })

  it("rejects a malformed key", async () => {
    const { status, body } = await call("POST", "/api/model-pin/remove", { model: "no-slash" })
    expect(status).toBe(400)
    expect(body.error).toBe("INVALID_MODEL_PIN")
  })
})

describe("cross device sync", () => {
  it("broadcasts every real change so the other devices follow", async () => {
    await call("POST", "/api/model-pin", { model: "opencode/one" })
    await call("POST", "/api/model-pin/merge", { models: ["openrouter/two"] })
    await call("POST", "/api/model-pin/remove", { model: "opencode/one" })
    expect(broadcasts).toEqual([
      ["opencode/one"],
      ["opencode/one", "openrouter/two"],
      ["openrouter/two"],
    ])
  })

  it("does not broadcast when nothing actually changed", async () => {
    await call("POST", "/api/model-pin", { model: "opencode/one" })
    broadcasts.length = 0
    await call("POST", "/api/model-pin", { model: "opencode/one" })
    await call("POST", "/api/model-pin/remove", { model: "opencode/missing" })
    await call("POST", "/api/model-pin/merge", { models: ["opencode/one"] })
    expect(broadcasts).toEqual([])
  })

  it("keeps two devices from overwriting each other", async () => {
    await call("POST", "/api/model-pin", { model: "opencode/shared" })
    const { body } = await call("POST", "/api/model-pin/merge", { models: ["openrouter/device", "opencode/shared"] })
    expect(body.models).toEqual(["opencode/shared", "openrouter/device"])
  })

  it("pushes the new list to a connected device over the event stream", async () => {
    // ده مسار "ثبّيت من الموبايل فظهر في الويب": الجهاز التاني شارد على نفس
    // قناة الأحداث وبيستقبل القائمة الجديدة من غير ما يسأل.
    const stream = await openEventStream()
    try {
      await call("POST", "/api/model-pin", { model: "opencode/one" })
      expect(await stream.nextModels()).toEqual(["opencode/one"])
      await call("POST", "/api/model-pin", { model: "openrouter/two" })
      expect(await stream.nextModels()).toEqual(["openrouter/two", "opencode/one"])
    } finally {
      await stream.close()
    }
  })
})