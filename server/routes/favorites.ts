import type { Express, Request, Response } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

// الطلبات المفضّلة على السيرفر عشان تفضل بعد الـ refresh وإعادة تشغيل
// السيرفر، وتظهر على كل الأجهزة — نفس منطق المثبّتات بالظبط: كل تعديل
// متطبّق على السيرفر، والبثّ لكل الأجهزة بيحصل من FavoritePromptService نفسه
// (server/index.ts) عشان أي مسار تعديل يوصل لكل الـ clients.
// مالها علاقة بـ OpenCode أصلًا، فبتشتغل وهو واقع (زي المثبّتات).
export function registerFavoriteRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/favorites", (_request, response) => {
    response.json({ favorites: ctx.favorites.list() })
  })

  app.post("/api/favorites", async (request, response) => {
    try {
      response.status(201).json({ favorites: await ctx.favorites.add(request.body?.favorite) })
    } catch (error) {
      favoriteErrorResponse(error, response, request, ctx)
    }
  })

  // التعديل وإعادة التسمية: نفس المدخل — النص و/أو الاسم
  app.patch("/api/favorites/:id", async (request, response) => {
    try {
      response.json({ favorites: await ctx.favorites.update(request.params.id, request.body?.favorite) })
    } catch (error) {
      favoriteErrorResponse(error, response, request, ctx)
    }
  })

  app.delete("/api/favorites/:id", async (request, response) => {
    try {
      response.json({ favorites: await ctx.favorites.remove(request.params.id) })
    } catch (error) {
      favoriteErrorResponse(error, response, request, ctx)
    }
  })
}

function favoriteErrorResponse(
  error: unknown,
  response: Response,
  request: Request,
  ctx: RouteContext,
): void {
  const lang = getServerLang(request)
  const code = error instanceof Error ? error.message : ""
  if (code === "INVALID_FAVORITE" || code === "FAVORITE_TOO_LONG") {
    response.status(400).json({
      error: code,
      message: serverMessage(code === "INVALID_FAVORITE" ? "invalidFavorite" : "favoriteTooLong", lang),
    })
    return
  }
  if (code === "FAVORITE_EXISTS") {
    response.status(409).json({ error: code, message: serverMessage("favoriteExists", lang) })
    return
  }
  if (code === "FAVORITES_FULL") {
    response.status(409).json({ error: code, message: serverMessage("favoritesFull", lang) })
    return
  }
  if (code === "FAVORITE_NOT_FOUND") {
    response.status(404).json({ error: code, message: serverMessage("favoriteNotFound", lang) })
    return
  }
  ctx.connection.handleError(error, response, request)
}
