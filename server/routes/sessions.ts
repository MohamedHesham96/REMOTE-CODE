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

  // فرع من محادثة: جلسة جديدة مستقلة بنفس السياق — الأصل ما بيتغيّرش.
  // idempotency الضغط المزدوج مسؤولية العميل (حارس متزامن + حالة تحميل)،
  // وده الحدث اللي بيخلي باقي الأجهزة تشوف الفرع فورًا.
  app.post("/api/session/:id/branch", async (request, response) => {
    try {
      response.status(201).json(await ctx.openCode.branchSession(request.params.id, getServerLang(request)))
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.delete("/api/session/:id", async (request, response) => {
    try {
      const deleted = await ctx.openCode.deleteSession(request.params.id)
      // التثبيت مصدره السيرفر، فالمحادثة اللي اتمسحت لازم تنضّف منه —
      // وإلا الـ id الميت فضل في كل الأجهزة لحد ما يعمل pin تاني.
      await ctx.pins.forget([request.params.id])
      response.json({ deleted })
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
