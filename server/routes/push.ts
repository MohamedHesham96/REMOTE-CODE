import type { Express } from "express"
import type { RouteContext } from "./context.js"

export function registerPushRoutes(app: Express, ctx: RouteContext): void {
  app.post("/api/push/subscribe", async (request, response) => {
    try {
      await ctx.push.register(request.body)
      response.status(201).json({ ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Push subscription failed"
      response.status(400).json({ error: "INVALID_SUBSCRIPTION", message })
    }
  })

  app.delete("/api/push/subscribe", async (request, response) => {
    const endpoint = typeof request.body?.endpoint === "string" ? request.body.endpoint : ""
    await ctx.push.unregister(endpoint)
    response.json({ ok: true })
  })
}
