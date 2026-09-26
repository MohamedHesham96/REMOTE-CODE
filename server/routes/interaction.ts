import type { Express } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

export function registerInteractionRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/permission", (_request, response) => {
    response.json(ctx.openCode.permissions())
  })

  app.post("/api/session/:id/permission/:permissionId", async (request, response) => {
    try {
      const value = request.body?.response
      if (value !== "once" && value !== "always" && value !== "reject") {
        response.status(400).json({ error: "INVALID_PERMISSION_RESPONSE", message: serverMessage("invalidPermissionResponse", getServerLang(request)) })
        return
      }
      response.json({ accepted: await ctx.openCode.replyPermission(request.params.id, request.params.permissionId, value) })
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.post("/api/session/:id/question/:requestId/reply", async (request, response) => {
    try {
      if (!request.params.requestId.trim()) {
        response.status(400).json({ error: "QUESTION_REQUIRED", message: serverMessage("questionRequired", getServerLang(request)) })
        return
      }
      response.json({ accepted: await ctx.openCode.replyQuestion(request.params.id, request.params.requestId, request.body?.answers) })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reply to question"
      const status = /not found/i.test(message) ? 404 : /answer|option|select/i.test(message) ? 400 : 500
      response.status(status).json({ error: "QUESTION_REPLY_FAILED", message })
    }
  })

  app.post("/api/session/:id/question/:requestId/reject", async (request, response) => {
    try {
      if (!request.params.requestId.trim()) {
        response.status(400).json({ error: "QUESTION_REQUIRED", message: serverMessage("questionRequired", getServerLang(request)) })
        return
      }
      response.json({ accepted: await ctx.openCode.rejectQuestion(request.params.id, request.params.requestId) })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reject question"
      const status = /not found/i.test(message) ? 404 : 500
      response.status(status).json({ error: "QUESTION_REJECT_FAILED", message })
    }
  })
}
