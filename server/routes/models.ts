import type { Express } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

export function registerModelRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/models", async (request, response) => {
    try {
      response.json(await ctx.openCode.models())
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.get("/api/session/:id/model", async (request, response) => {
    try {
      response.json(await ctx.openCode.sessionModel(request.params.id))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.post("/api/session/:id/model", async (request, response) => {
    try {
      const providerID = typeof request.body?.providerID === "string" ? request.body.providerID : ""
      const modelID = typeof request.body?.modelID === "string" ? request.body.modelID : ""
      const variant = typeof request.body?.variant === "string" ? request.body.variant : undefined
      if (!providerID.trim() || !modelID.trim()) {
        response.status(400).json({ error: "MODEL_REQUIRED", message: serverMessage("modelRequired", getServerLang(request)) })
        return
      }
      response.json({ model: await ctx.openCode.switchSessionModel(request.params.id, providerID, modelID, variant) })
    } catch (error) {
      const lang = getServerLang(request)
      // النموذج من الكتالوج العام بس مزوّده مش متصل — الحالة دي لها رسالة
      // مخصوصة بتقول للمستخدم يربط من OpenCode، مش "تعذّر التبديل"
      if (error instanceof Error && error.message === "MODEL_PROVIDER_NOT_CONNECTED") {
        response.status(409).json({
          error: "MODEL_PROVIDER_NOT_CONNECTED",
          message: serverMessage("modelProviderNotConnected", lang),
        })
        return
      }
      const message = error instanceof Error ? error.message : "Unable to switch model"
      const status = /not found/i.test(message) ? 404 : /required/i.test(message) ? 400 : 500
      response.status(status).json({ error: "MODEL_SWITCH_FAILED", message })
    }
  })
}
