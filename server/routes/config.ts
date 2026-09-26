import type { Express } from "express"
import { config } from "../config.js"
import type { RouteContext } from "./context.js"

// Registered AFTER the auth guard + readiness gate (the gate allowlists
// /config so it answers degraded while OpenCode is still connecting).
export function registerConfigRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/config", async (request, response) => {
    if (!ctx.connection.isReady) {
      response.json({
        openCode: { healthy: false, version: `connecting: ${ctx.connection.error}` },
        push: { enabled: ctx.push.enabled, publicKey: ctx.push.publicKey ?? null },
        secureContext: Boolean(config.tlsCertificatePath),
      })
      return
    }
    try {
      const health = await ctx.openCode.health()
      response.json({
        openCode: health,
        push: { enabled: ctx.push.enabled, publicKey: ctx.push.publicKey ?? null },
        secureContext: Boolean(config.tlsCertificatePath),
      })
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })
}
