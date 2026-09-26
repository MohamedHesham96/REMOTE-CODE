import type { Express, Request, Response } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

// المثبّتات على السيرفر عشان تكون مشتركة بين كل الأجهزة. كل التغييرات متطبّقة
// على السيرفر (تثبيت/إزالة/مسح) — مفيش استبدال كامل إلا في حالة الاسترجاع،
// عشان جهازين ما يخسروش تحديث بعض. ودي مالها علاقة بـ OpenCode أصلًا، فبتشتغل
// حتى وهو واقع.
export function registerPinRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/pin", (_request, response) => {
    response.json({ pins: ctx.pins.list() })
  })

  app.post("/api/pin", async (request, response) => {
    try {
      response.status(201).json({ pins: await ctx.pins.add(request.body?.pin) })
    } catch (error) {
      invalidPinResponse(error, response, request, ctx)
    }
  })

  app.put("/api/pin", async (request, response) => {
    try {
      response.json({ pins: await ctx.pins.replace(request.body?.pins) })
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
