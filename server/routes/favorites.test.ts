import express from "express"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FavoritePromptService } from "../favorites.js"
import { EventHub, favoritesEvent } from "../sse/hub.js"
import type { FavoritePrompt } from "../opencode/types.js"
import { registerEventRoutes } from "./events.js"
import { registerFavoriteRoutes } from "./favorites.js"
import type { RouteContext } from "./context.js"

// اختبار على مستوى الـ HTTP الحقيقي: الحفظ والتعديل والحذف، ورفض المدخلات
// غير الصالحة بعقد الأخطاء الثابت، والبثّ لكل الأجهزة على قناة الأحداث —
// نفس أسلوب اختبار المثبّتات بالظبط.
let dir = ""
let server: Server
let base = ""
let favorites: FavoritePromptService
let hub: EventHub
const broadcasts: string[][] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "favorite-routes-"))
  favorites = new FavoritePromptService(join(dir, "favorites.json"))
  broadcasts.length = 0
  hub = new EventHub()
  favorites.subscribe((list) => broadcasts.push(list.map((favorite) => favorite.text)))
  // نفس التوصيل في server/index.ts: تغيير المفضّلات → بثّ لكل الـ clients
  favorites.subscribe((list) => hub.broadcast(favoritesEvent(list)))

  const app = express()
  app.use(express.json())
  const ctx = {
    favorites,
    hub,
    connection: { handleError: vi.fn((_error: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => response.status(500).json({ error: "SERVER_ERROR" })) },
  } as unknown as RouteContext
  registerFavoriteRoutes(app, ctx)
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

function textsOf(body: Record<string, unknown>): string[] {
  return (body.favorites as FavoritePrompt[]).map((favorite) => favorite.text)
}

// جهاز متصل على قناة الأحداث: بنقرا الـ frames لحد ما نلاقي حدث مفضّلات
async function openEventStream(): Promise<{ nextFavorites: () => Promise<string[]>; close: () => Promise<void> }> {
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
    async nextFavorites(): Promise<string[]> {
      while (true) {
        const frame = await readFrame()
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) {
            continue
          }
          const payload = JSON.parse(line.slice(6)) as { favorites?: FavoritePrompt[] }
          if (Array.isArray(payload.favorites)) {
            return payload.favorites.map((favorite) => favorite.text)
          }
        }
      }
    },
    async close(): Promise<void> {
      await reader.cancel().catch(() => undefined)
    },
  }
}

describe("GET /api/favorites", () => {
  it("بيرجّع القائمة الأحدث أولًا", async () => {
    await call("POST", "/api/favorites", { favorite: { text: "الأول" } })
    await call("POST", "/api/favorites", { favorite: { text: "التاني" } })
    const { status, body } = await call("GET", "/api/favorites")
    expect(status).toBe(200)
    expect(textsOf(body)).toEqual(["التاني", "الأول"])
  })
})

describe("POST /api/favorites", () => {
  it("بيحفظ الطلب ويرجّع القائمة كاملة", async () => {
    const { status, body } = await call("POST", "/api/favorites", { favorite: { text: "  أصلح المصادقة  " } })
    expect(status).toBe(201)
    expect(textsOf(body)).toEqual(["أصلح المصادقة"])
    expect((body.favorites as FavoritePrompt[])[0]?.label).toBe("أصلح المصادقة")
  })

  it("مبيضيفش نسخة تانية لنفس النص", async () => {
    await call("POST", "/api/favorites", { favorite: { text: "نفس الطلب" } })
    broadcasts.length = 0
    const { status, body } = await call("POST", "/api/favorites", { favorite: { text: "نفس الطلب" } })
    expect(status).toBe(201)
    expect(body.favorites).toHaveLength(1)
    // مفيش تغيير حقيقي = مفيش بثّ
    expect(broadcasts).toEqual([])
  })

  it("بيرفض نص فاضي أو مدخل غلط بعقد الأخطاء", async () => {
    const empty = await call("POST", "/api/favorites", { favorite: { text: "   " } })
    expect(empty.status).toBe(400)
    expect(empty.body.error).toBe("INVALID_FAVORITE")
    expect(typeof empty.body.message).toBe("string")

    const garbage = await call("POST", "/api/favorites", { favorite: 42 })
    expect(garbage.status).toBe(400)
    expect(garbage.body.error).toBe("INVALID_FAVORITE")

    const long = await call("POST", "/api/favorites", { favorite: { text: "ا".repeat(20001) } })
    expect(long.status).toBe(400)
    expect(long.body.error).toBe("FAVORITE_TOO_LONG")
  })

  it("بيرجّع رسالة إنجليزية لما ?lang=en", async () => {
    const { body } = await call("POST", "/api/favorites?lang=en", { favorite: { text: "" } })
    expect(body.message).toBe("A favorite prompt is required")
  })
})

describe("PATCH /api/favorites/:id", () => {
  it("بيعدّل النص والاسم", async () => {
    const created = await call("POST", "/api/favorites", { favorite: { text: "النص القديم" } })
    const id = (created.body.favorites as FavoritePrompt[])[0]!.id
    const { status, body } = await call("PATCH", `/api/favorites/${encodeURIComponent(id)}`, { favorite: { text: "النص الجديد", label: "اسم جديد" } })
    expect(status).toBe(200)
    expect(textsOf(body)).toEqual(["النص الجديد"])
    expect((body.favorites as FavoritePrompt[])[0]?.label).toBe("اسم جديد")
  })

  it("بيرفض التعديل لنص مفضّلة تانية", async () => {
    await call("POST", "/api/favorites", { favorite: { text: "الأول" } })
    const created = await call("POST", "/api/favorites", { favorite: { text: "التاني" } })
    // القائمة الأحدث أولًا: العنصر التاني هو "الأول"
    const id = (created.body.favorites as FavoritePrompt[])[1]!.id
    // التعديل لنفس النص الحالي مسموح
    const same = await call("PATCH", `/api/favorites/${encodeURIComponent(id)}`, { favorite: { text: "الأول" } })
    expect(same.status).toBe(200)
    // أما نص مفضّلة تانية فمرفوض
    const conflict = await call("PATCH", `/api/favorites/${encodeURIComponent(id)}`, { favorite: { text: "التاني" } })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error).toBe("FAVORITE_EXISTS")
  })

  it("بيرجّع 404 لمفضّلة مش موجودة", async () => {
    const { status, body } = await call("PATCH", "/api/favorites/fav_missing", { favorite: { label: "x" } })
    expect(status).toBe(404)
    expect(body.error).toBe("FAVORITE_NOT_FOUND")
  })
})

describe("DELETE /api/favorites/:id", () => {
  it("بيشيل المفضّلة ويرجّع الباقي", async () => {
    await call("POST", "/api/favorites", { favorite: { text: "الأول" } })
    const created = await call("POST", "/api/favorites", { favorite: { text: "التاني" } })
    const id = (created.body.favorites as FavoritePrompt[])[0]!.id
    const { status, body } = await call("DELETE", `/api/favorites/${encodeURIComponent(id)}`)
    expect(status).toBe(200)
    expect(textsOf(body)).toEqual(["الأول"])
  })
})

describe("cross device sync", () => {
  it("بيبعت كل تغيير حقيقي لكل الأجهزة المتصلة", async () => {
    const first = await openEventStream()
    const second = await openEventStream()
    try {
      await call("POST", "/api/favorites", { favorite: { text: "طلب" } })
      expect(await first.nextFavorites()).toEqual(["طلب"])
      expect(await second.nextFavorites()).toEqual(["طلب"])

      const created = await call("POST", "/api/favorites", { favorite: { text: "طلب تاني" } })
      const id = (created.body.favorites as FavoritePrompt[])[0]!.id
      expect(await first.nextFavorites()).toEqual(["طلب تاني", "طلب"])
      expect(await second.nextFavorites()).toEqual(["طلب تاني", "طلب"])

      await call("DELETE", `/api/favorites/${encodeURIComponent(id)}`)
      expect(await first.nextFavorites()).toEqual(["طلب"])
      expect(await second.nextFavorites()).toEqual(["طلب"])
    } finally {
      await first.close()
      await second.close()
    }
  })

  it("مبيبعتش حاجة لما مفيش تغيير حقيقي", async () => {
    await call("POST", "/api/favorites", { favorite: { text: "موجود" } })
    expect(broadcasts).toEqual([["موجود"]])
    await call("POST", "/api/favorites", { favorite: { text: "موجود" } })
    await call("DELETE", "/api/favorites/fav_missing")
    expect(broadcasts).toEqual([["موجود"]])
  })
})
