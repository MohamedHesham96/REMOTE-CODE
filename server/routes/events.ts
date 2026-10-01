import type { Express } from "express"
import type { RouteContext } from "./context.js"

const HEARTBEAT_MS = 25000

// نبضة الحياة لازم تكون حدثًا مسمّى لا تعليق SSE: التعليقات بيستهلكها المتصفح
// ولا تصل للجافاسكربت خالص، فالستريم نصف المفتوح يفضل شكله حي للأبد والعميل
// ما يقدرش يكتشف إنه مات ويعيد الاتصال. الحدث المسمّى بيوصل للمستمع، وبرضه
// بيمنع الوصلات الوسيطة (proxies) إنها تقفل الاتصال الخامل.
export function pingFrame(): string {
  return `event: ping\ndata: {}\n\n`
}

export function registerEventRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/events", (request, response) => {
    response.status(200)
    response.setHeader("Content-Type", "text/event-stream")
    response.setHeader("Cache-Control", "no-cache, no-transform")
    response.setHeader("Connection", "keep-alive")
    response.setHeader("X-Accel-Buffering", "no")
    response.flushHeaders()
    response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)
    ctx.hub.add(response)

    const heartbeat = setInterval(() => {
      if (!response.writableEnded) {
        response.write(pingFrame())
      }
    }, HEARTBEAT_MS)

    request.on("close", () => {
      clearInterval(heartbeat)
      ctx.hub.remove(response)
    })
  })
}
