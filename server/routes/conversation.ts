import type { Express } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import { etagFor } from "../utils/hash.js"
import type { RouteContext } from "./context.js"

export function registerConversationRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/session/:id/message", async (request, response) => {
    try {
      response.json(await ctx.openCode.messages(request.params.id))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.get("/api/session/:id/history", async (request, response) => {
    try {
      response.json(await ctx.openCode.history(request.params.id, getServerLang(request)))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.get("/api/session/:id/requests", ctx.pollLimiter, async (request, response) => {
    try {
      const sessionId = String((request.params as { id?: unknown }).id ?? "")
      const result = await ctx.openCode.requests(sessionId, getServerLang(request))
      const etag = etagFor(result.version)
      response.setHeader("ETag", etag)
      if (request.headers["if-none-match"] === etag) {
        response.status(304).end()
        return
      }
      response.json(result)
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.post("/api/session/:id/message", async (request, response) => {
    try {
      const text = typeof request.body?.text === "string" ? request.body.text.trim() : ""
      const agent = typeof request.body?.agent === "string" ? request.body.agent.trim().slice(0, 100) : undefined
      const rawModel = request.body?.model as { providerID?: unknown; modelID?: unknown; variant?: unknown } | undefined
      const model = rawModel && typeof rawModel.providerID === "string" && typeof rawModel.modelID === "string"
        ? {
          providerID: rawModel.providerID.trim().slice(0, 100),
          modelID: rawModel.modelID.trim().slice(0, 200),
          ...(typeof rawModel.variant === "string" && rawModel.variant.trim()
            ? { variant: rawModel.variant.trim().slice(0, 100) }
            : {}),
        }
        : undefined
      if (!text) {
        response.status(400).json({ error: "EMPTY_MESSAGE", message: serverMessage("emptyMessage", getServerLang(request)) })
        return
      }
      if (text.length > 20000) {
        response.status(400).json({ error: "MESSAGE_TOO_LONG", message: serverMessage("messageTooLong", getServerLang(request)) })
        return
      }
      const { queued } = await ctx.openCode.prompt(request.params.id, text, agent, model && model.providerID && model.modelID ? model : undefined)
      response.status(202).json({ accepted: true, queued })
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.post("/api/session/:id/abort", async (request, response) => {
    try {
      response.json(await ctx.openCode.abort(request.params.id))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.post("/api/session/:id/skip", async (request, response) => {
    try {
      response.json(await ctx.openCode.skip(request.params.id))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.delete("/api/session/:id/request/:requestId", async (request, response) => {
    try {
      const requestId = request.params.requestId.trim()
      if (!requestId) {
        response.status(400).json({ error: "REQUEST_REQUIRED", message: serverMessage("requestRequired", getServerLang(request)) })
        return
      }
      response.json(ctx.openCode.removeQueued(request.params.id, requestId))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.post("/api/session/:id/request/:requestId/run", async (request, response) => {
    try {
      const requestId = request.params.requestId.trim()
      if (!requestId) {
        response.status(400).json({ error: "REQUEST_REQUIRED", message: serverMessage("requestRequired", getServerLang(request)) })
        return
      }
      response.json(await ctx.openCode.runQueued(request.params.id, requestId))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  // v2 بلا قائمة مهام — العقد باقٍ (قائمة فارغة) حتى لا تتغير الواجهة.
  app.get("/api/session/:id/todo", (_request, response) => {
    response.json([])
  })

  app.get("/api/session/:id/diff", async (request, response) => {
    try {
      response.json(await ctx.openCode.diff(request.params.id))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })
}
