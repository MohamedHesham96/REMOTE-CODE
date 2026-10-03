import type { Express, Request, Response } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import { pinProjectKey } from "../pins.js"
import type { RouteContext } from "./context.js"

// المثبّتات على السيرفر عشان تكون مشتركة بين كل الأجهزة. كل التغييرات متطبّقة
// على السيرفر (تثبيت/إزالة/مسح) ومفيش استبدال كامل — الدمج بيضيف الجديد
// فوق الموجود، فجهازين ما يخسروش تحديث بعض. ودي مالها علاقة بـ OpenCode أصلًا،
// فبتشتغل حتى وهو واقع. البثّ لكل الأجهزة بيحصل من PinService نفسه
// (server/index.ts) عشان كل مسار تعديل — حتى مسار حذف الجلسة — يوصل لكل
// الـ clients.
export function registerPinRoutes(app: Express, ctx: RouteContext): void {
  // ?project=<worktree> = مثبّتات مشروع واحد بس (اللي بتعرضه اللوحة).
  // من غيره = المرآة الكاملة لكل المشاريع (العداد والفتح من أي مكان).
  // بارام فاضي أو تالف = لا شيء: أحسن ما نرجّع كل المثبّتات بالغلط.
  app.get("/api/pin", (request, response) => {
    if (request.query.project === undefined) {
      // قائمة واحدة بس: `total` كان بينده `list()` تاني (نسخ كل المثبّتات) لمجرد الطول.
      const pins = ctx.pins.list()
      response.json({ pins, total: pins.length })
      return
    }
    const project = typeof request.query.project === "string" ? request.query.project.trim() : ""
    response.json({
      pins: ctx.pins.listForProject(project),
      projectKey: pinProjectKey(project, ""),
      total: ctx.pins.count(),
    })
  })

  app.post("/api/pin", async (request, response) => {
    try {
      response.status(201).json({ pins: await ctx.pins.add(request.body?.pin) })
    } catch (error) {
      invalidPinResponse(error, response, request, ctx)
    }
  })

  // دمج قادم من جهاز (ترقية الكاش القديم على أجهزة لسه محدّثة): اللي عندنا
  // ما بيتمسحش والجاي الجديد بيتضاف — فمفيش مثبّتة بتضيع في أي اتجاه.
  app.post("/api/pin/merge", async (request, response) => {
    try {
      response.json({ pins: await ctx.pins.merge(request.body?.pins) })
    } catch (error) {
      invalidPinResponse(error, response, request, ctx)
    }
  })

  app.delete("/api/pin/:id", async (request, response) => {
    try {
      response.json({ pins: await ctx.pins.remove(request.params.id) })
    } catch (error) {
      invalidPinResponse(error, response, request, ctx)
    }
  })

  // مسح دفعة واحدة: بتتبعت لما عميل ينضّف مثبّتات محادثات محذوفة
  app.post("/api/pin/forget", async (request, response) => {
    try {
      const ids = request.body?.ids
      if (!Array.isArray(ids)) {
        response.status(400).json({
          error: "INVALID_PIN_IDS",
          message: serverMessage("invalidPinIds", getServerLang(request)),
        })
        return
      }
      response.json({ pins: await ctx.pins.forget(ids) })
    } catch (error) {
      invalidPinResponse(error, response, request, ctx)
    }
  })
}

function invalidPinResponse(
  error: unknown,
  response: Response,
  request: Request,
  ctx: RouteContext,
): void {
  if (error instanceof Error && error.message === "INVALID_PIN") {
    response.status(400).json({
      error: "INVALID_PIN",
      message: serverMessage("invalidPin", getServerLang(request)),
    })
    return
  }
  ctx.connection.handleError(error, response, request)
}
