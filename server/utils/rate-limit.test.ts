import type { NextFunction, Request, Response } from "express"
import { describe, expect, it, vi } from "vitest"
import { createRateLimiter } from "./rate-limit.js"

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
