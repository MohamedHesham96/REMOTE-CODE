import type { NextFunction, Request, Response } from "express"

export interface RateLimitOptions {
  windowMs: number
  max: number
}

// حد معدل بسيط لكل IP للنقاط الساخنة (polls) — يوقف حلقات العواصف
// من غير ما يأثر على الاستخدام الطبيعي. بيرجّع 429 مع Retry-After.
export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max } = options
  const hits = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = Date.now()

  return (request: Request, response: Response, next: NextFunction): void => {
    const now = Date.now()
    if (now - lastSweep > windowMs) {
      lastSweep = now
      for (const [key, entry] of hits) {
        if (entry.resetAt <= now) {
          hits.delete(key)
        }
      }
    }
    const ip = request.ip || request.socket?.remoteAddress || "unknown"
    let entry = hits.get(ip)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      hits.set(ip, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      response.setHeader("Retry-After", String(retryAfter))
      response.status(429).json({ error: "RATE_LIMITED", message: "Too many requests — backing off" })
      return
    }
    next()
  }
}
