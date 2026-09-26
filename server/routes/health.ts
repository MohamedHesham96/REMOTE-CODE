import type { Express } from "express"
import type { RouteContext } from "./context.js"

export function registerHealthRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      openCode: ctx.connection.isReady ? "connected" : "connecting",
      error: ctx.connection.isReady ? undefined : ctx.connection.error,
    })
  })
}
