import type { Express } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

export function registerSessionRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/session", async (request, response) => {
    try {
      response.json(await ctx.openCode.sessions())
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.post("/api/session", async (request, response) => {
    try {
      const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 120) : undefined
      const mobile = request.body?.mobile === true
      response.status(201).json(await ctx.openCode.createSession(title || undefined, mobile))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.patch("/api/session/:id", async (request, response) => {
    try {
      const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 120) : ""
      if (!title) {
        response.status(400).json({ error: "INVALID_TITLE", message: serverMessage("invalidTitle", getServerLang(request)) })
        return
      }
      response.json(await ctx.openCode.updateSession(request.params.id, title, getServerLang(request)))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.delete("/api/session/:id", async (request, response) => {
    try {
      response.json({ deleted: await ctx.openCode.deleteSession(request.params.id) })
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.get("/api/session/status", ctx.pollLimiter, async (request, response) => {
    try {
      response.json(await ctx.openCode.statuses())
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.get("/api/activity", ctx.pollLimiter, async (request, response) => {
    try {
      response.json(await ctx.openCode.activity(getServerLang(request)))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })
}
