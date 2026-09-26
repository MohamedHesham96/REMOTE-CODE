import express from "express"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PinService } from "../pins.js"
import { EventHub, pinsEvent } from "../sse/hub.js"
import type { PinnedConversation } from "../opencode/types.js"
import { registerEventRoutes } from "./events.js"
import { registerPinRoutes } from "./pins.js"
import type { RouteContext } from "./context.js"

// اختبار على مستوى الـ HTTP الحقيقي: الفلترة بمشروع، والدمج من جهاز تاني،
// والبثّ لكل الأجهزة على قناة الأحداث. من غير ما نعمل متصفح ولا سكربت.
let dir = ""
let server: Server
let base = ""
let pins: PinService
let hub: EventHub
const broadcasts: string[][] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pin-routes-"))
  pins = new PinService(join(dir, "pins.json"))
  broadcasts.length = 0
  hub = new EventHub()
  pins.subscribe((list) => broadcasts.push(list.map((item) => item.id)))
  // نفس التوصيل في server/index.ts: تغيير المثبّتات → بثّ لكل الـ clients
  pins.subscribe((list) => hub.broadcast(pinsEvent(list)))

  const app = express()
  app.use(express.json())
  const ctx = {
    pins,
    hub,
    connection: { handleError: vi.fn((_error: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => response.status(500).json({ error: "SERVER_ERROR" })) },
  } as unknown as RouteContext
  registerPinRoutes(app, ctx)
  registerEventRoutes(app, ctx)

  server = createServer(app)
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()) })
  await rm(dir, { recursive: true, force: true })
})

function pin(id: string, worktree: string, projectName: string): Record<string, unknown> {
  return { id, title: `title ${id}`, created: 1000, directory: worktree, worktree, projectName }
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

// جهاز متصل على قناة الأحداث: بنقرا الـ frames لحد ما نلاقي حدث مثبّتات
async function openEventStream(): Promise<{ nextPins: () => Promise<string[]>; close: () => Promise<void> }> {
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
    async nextPins(): Promise<string[]> {
      while (true) {
        const frame = await readFrame()
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) {
            continue
          }
          const payload = JSON.parse(line.slice(6)) as { pins?: PinnedConversation[] }
          if (Array.isArray(payload.pins)) {
            return payload.pins.map((item) => item.id)
          }
        }
      }
    },
    async close(): Promise<void> {
      await reader.cancel().catch(() => undefined)
    },
  }
}

describe("GET /api/pin", () => {
  it("returns every project's pins with a total", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    await call("POST", "/api/pin", { pin: pin("ses_b", "/srv/two", "two") })
    const { body } = await call("GET", "/api/pin")
    expect((body.pins as PinnedConversation[]).map((item) => item.id)).toEqual(["ses_b", "ses_a"])
    expect(body.total).toBe(2)
  })

  it("returns only the requested project's pins", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    await call("POST", "/api/pin", { pin: pin("ses_b", "/srv/two", "two") })
    const { body } = await call("GET", "/api/pin?project=%2Fsrv%2Fone")
    expect((body.pins as PinnedConversation[]).map((item) => item.id)).toEqual(["ses_a"])
    expect(body.projectKey).toBe("/srv/one")
    expect(body.total).toBe(2)
  })

  it("returns nothing for a project with no pins or a broken one", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    expect((await call("GET", "/api/pin?project=%2Fsrv%2Fnope")).body.pins).toEqual([])
    expect((await call("GET", "/api/pin?project=%20%20")).body.pins).toEqual([])
    expect((await call("GET", "/api/pin?project=%2F")).body.pins).toEqual([])
  })
})

describe("POST /api/pin", () => {
  it("stores the pin with the project the server derives from the paths", async () => {
    const { status, body } = await call("POST", "/api/pin", {
      pin: { ...pin("ses_a", "/srv/one", "one"), projectKey: "/srv/evil" },
    })
    expect(status).toBe(201)
    expect(body.pins).toEqual([{ ...pin("ses_a", "/srv/one", "one"), projectKey: "/srv/one" }])
  })

  it("rejects a pin with no id and keeps the stored list untouched", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    const { status, body } = await call("POST", "/api/pin", { pin: { title: "no id" } })
    expect(status).toBe(400)
    expect(body.error).toBe("INVALID_PIN")
    expect((await call("GET", "/api/pin")).body.pins).toHaveLength(1)
  })
})

describe("POST /api/pin/merge", () => {
  it("merges a device list without dropping the stored pins", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_server", "/srv/one", "one") })
    const { body } = await call("POST", "/api/pin/merge", { pins: [pin("ses_device", "/srv/two", "two")] })
    expect((body.pins as PinnedConversation[]).map((item) => item.id)).toEqual(["ses_server", "ses_device"])
  })

  it("does not duplicate a pin that both devices have", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    const { body } = await call("POST", "/api/pin/merge", { pins: [pin("ses_a", "/srv/one", "one")] })
    expect(body.pins).toHaveLength(1)
  })

  it("ignores a merge body that is not a list", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    const { body } = await call("POST", "/api/pin/merge", { pins: "nope" })
    expect(body.pins).toHaveLength(1)
  })
})

describe("DELETE /api/pin/:id and POST /api/pin/forget", () => {
  it("removes one pin", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    const { body } = await call("DELETE", `/api/pin/${encodeURIComponent("ses_a")}`)
    expect(body.pins).toEqual([])
  })

  it("forgets a batch of deleted conversations", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    await call("POST", "/api/pin", { pin: pin("ses_b", "/srv/one", "one") })
    const { body } = await call("POST", "/api/pin/forget", { ids: ["ses_a", "ses_b"] })
    expect(body.pins).toEqual([])
  })

  it("rejects a forget call without a list of ids", async () => {
    const { status, body } = await call("POST", "/api/pin/forget", { ids: "ses_a" })
    expect(status).toBe(400)
    expect(body.error).toBe("INVALID_PIN_IDS")
  })
})

describe("cross device sync", () => {
  it("broadcasts every real change so the other devices follow", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    await call("POST", "/api/pin/merge", { pins: [pin("ses_b", "/srv/two", "two")] })
    await call("DELETE", "/api/pin/ses_a")
    await call("POST", "/api/pin/forget", { ids: ["ses_b"] })
    expect(broadcasts).toEqual([["ses_a"], ["ses_a", "ses_b"], ["ses_b"], []])
  })

  it("does not broadcast when nothing actually changed", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    broadcasts.length = 0
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    await call("DELETE", "/api/pin/ses_missing")
    await call("POST", "/api/pin/forget", { ids: [] })
    await call("POST", "/api/pin/merge", { pins: [pin("ses_a", "/srv/one", "one")] })
    expect(broadcasts).toEqual([])
  })

  it("keeps two devices from overwriting each other", async () => {
    // الجهاز A ثبّت، وجهاز B رفع كاشه فيه نفس المحادثة + واحدة زيادة: ولا واحد
    // بيكتب فوق التاني، والاتنين ظاهرين (ترتيب كل مصدر محفوظ جواه)
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    await call("POST", "/api/pin/merge", { pins: [pin("ses_b", "/srv/one", "one"), pin("ses_a", "/srv/one", "one")] })
    const { body } = await call("GET", "/api/pin?project=%2Fsrv%2Fone")
    expect((body.pins as PinnedConversation[]).map((item) => item.id)).toEqual(["ses_a", "ses_b"])
  })
})

describe("session deletion", () => {
  it("keeps a pin from a deleted conversation out of the list", async () => {
    await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
    await call("POST", "/api/pin", { pin: pin("ses_b", "/srv/one", "one") })
    // مسار حذف الجلسة نفسه بينضّف التثبيت على السيرفر (routes/sessions.ts)
    await call("POST", "/api/pin/forget", { ids: ["ses_a"] })
    expect((await call("GET", "/api/pin?project=%2Fsrv%2Fone")).body.pins).toHaveLength(1)
  })
})

describe("live sync between devices", () => {
  it("pushes every change to every connected device over the event stream", async () => {
    const first = await openEventStream()
    const second = await openEventStream()
    try {
      await call("POST", "/api/pin", { pin: pin("ses_a", "/srv/one", "one") })
      // الجهاز الأول عمل التثبيت — الجهاز التاني لازم يشوفه من غير ما يسأل
      expect(await first.nextPins()).toEqual(["ses_a"])
      expect(await second.nextPins()).toEqual(["ses_a"])

      await call("DELETE", "/api/pin/ses_a")
      expect(await first.nextPins()).toEqual([])
      expect(await second.nextPins()).toEqual([])

      await call("POST", "/api/pin/merge", { pins: [pin("ses_b", "/srv/two", "two")] })
      const frame = await second.nextPins()
      expect(frame).toEqual(["ses_b"])
    } finally {
      await first.close()
      await second.close()
    }
  })
})
