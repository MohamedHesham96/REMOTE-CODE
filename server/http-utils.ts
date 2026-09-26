import type { NextFunction, Request, Response } from "express"

// FNV-1a خفيفة (32-bit) لبصمات ETag — من غير crypto وبتكفي للكشف عن التغيير
export function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function etagFor(version: string): string {
  return `W/"${fnv1a(version)}-${version.length}"`
}

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

// تجمع worker محدود لمهام async — يمنع fan-out غير محدود (مثل إرسال push
// لكل الاشتراكات لحظيًا) مع الحفاظ على ترتيب النتائج
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}
