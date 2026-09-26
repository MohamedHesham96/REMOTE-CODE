import type { NextFunction, Request, Response } from "express"
import { describe, expect, it, vi } from "vitest"
import { createRateLimiter, etagFor, fnv1a, mapWithConcurrency } from "./http-utils.js"

function fakeReq(ip = "1.2.3.4"): Request {
  return { ip, socket: {} } as unknown as Request
}

interface FakeRes extends Response {
  headers: Record<string, string>
  responseBody: unknown
}

function fakeRes(): FakeRes {
  const res = {
    headers: {} as Record<string, string>,
    responseBody: undefined as unknown,
    statusCode: 200,
    setHeader(name: string, value: string) {
      res.headers[name] = value
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.responseBody = body
      return res
    },
  } as unknown as FakeRes
  return res
}

describe("fnv1a / etagFor", () => {
  it("is deterministic and distinguishes versions", () => {
    expect(fnv1a("busy|1|abc")).toBe(fnv1a("busy|1|abc"))
    expect(fnv1a("busy|1|abc")).not.toBe(fnv1a("busy|1|abd"))
    expect(etagFor("v1")).toMatch(/^W\/"[0-9a-f]{8}-\d+"$/)
    expect(etagFor("v1")).not.toBe(etagFor("v2"))
  })
})

describe("createRateLimiter", () => {
  it("allows requests under the cap and rejects with 429 + Retry-After above it", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 })
    const next = vi.fn()

    const first = fakeRes()
    limiter(fakeReq(), first, next as unknown as NextFunction)
    const second = fakeRes()
    limiter(fakeReq(), second, next as unknown as NextFunction)
    expect(next).toHaveBeenCalledTimes(2)

    const limited = fakeRes()
    limiter(fakeReq(), limited, next as unknown as NextFunction)
    expect(next).toHaveBeenCalledTimes(2)
    expect(limited.statusCode).toBe(429)
    expect(limited.headers["Retry-After"]).toBeDefined()
    expect(limited.responseBody).toMatchObject({ error: "RATE_LIMITED" })
  })

  it("tracks buckets per IP independently", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
    const next = vi.fn()

    limiter(fakeReq("1.1.1.1"), fakeRes(), next as unknown as NextFunction)
    limiter(fakeReq("2.2.2.2"), fakeRes(), next as unknown as NextFunction)
    expect(next).toHaveBeenCalledTimes(2)

    const limited = fakeRes()
    limiter(fakeReq("1.1.1.1"), limited, next as unknown as NextFunction)
    expect(limited.statusCode).toBe(429)
  })

  it("resets the bucket after the window passes", async () => {
    const limiter = createRateLimiter({ windowMs: 20, max: 1 })
    const next = vi.fn()

    limiter(fakeReq(), fakeRes(), next as unknown as NextFunction)
    expect(next).toHaveBeenCalledTimes(1)

    await new Promise((resolve) => setTimeout(resolve, 40))
    limiter(fakeReq(), fakeRes(), next as unknown as NextFunction)
    expect(next).toHaveBeenCalledTimes(2)
  })
})

describe("mapWithConcurrency", () => {
  it("preserves order and caps concurrency", async () => {
    let running = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return value * 10
    })
    expect(results).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBeLessThanOrEqual(2)
  })

  it("handles an empty list and serial execution", async () => {
    await expect(mapWithConcurrency([], 5, async (value: number) => value)).resolves.toEqual([])
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3], 1, async (value) => {
      seen.push(value)
    })
    expect(seen).toEqual([1, 2, 3])
  })
})
