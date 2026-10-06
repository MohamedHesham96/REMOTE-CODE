import type { Express, Request, Response } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

// مثبّتات النماذج على السيرفر عشان تثبّت من الموبايل تظهر على الويب والعكس —
// نفس منطق مثبّتات المحادثات بالظبط: كل تعديل متطبّق على السيرفر ومفيش
// استبدال كامل، والبثّ لكل الأجهزة بيحصل من ModelPinService نفسه (مش من
// الـ routes) عشان أي تعديل يوصل لكل الـ clients.
//
// ولا حاجة هنا ليها علاقة بـ OpenCode، بس المسارات متسجّلة بعد بوابة الجهوزية
// زي مثبّتات المحادثات بالظبط — اتساق في السلوك أهم من إنه يبقى متاح والمحرك
// واقع.
export function registerModelPinRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/model-pin", (_request, response) => {
    response.json({ models: ctx.modelPins.list() })
  })

  app.post("/api/model-pin", async (request, response) => {
    try {
      response.status(201).json({ models: await ctx.modelPins.add(request.body?.model) })
    } catch (error) {
      modelPinErrorResponse(error, response, request, ctx)
    }
  })

  // دمج قادم من جهاز: كاش قديم من النسخة اللي كانت بتخزّن في المتصفح. اللي
  // عندنا ما بيتمسحش والجاي الجديد بيتضاف — فمفيش تثبيت بينسلب في أي اتجاه.
  app.post("/api/model-pin/merge", async (request, response) => {
    try {
      response.json({ models: await ctx.modelPins.merge(request.body?.models) })
    } catch (error) {
      modelPinErrorResponse(error, response, request, ctx)
    }
  })

  // POST مش DELETE بمعامل في المسار: المفتاح "providerID/modelID" فيه "/"،
  // فمش ينفع يتحط في :param — والجداء في body أوضح من ترميز slashes
  app.post("/api/model-pin/remove", async (request, response) => {
    try {
      response.json({ models: await ctx.modelPins.remove(request.body?.model) })
    } catch (error) {
      modelPinErrorResponse(error, response, request, ctx)
    }
  })
}

function modelPinErrorResponse(
  error: unknown,
  response: Response,
  request: Request,
  ctx: RouteContext,
): void {
  const lang = getServerLang(request)
  // السقف رفض مش رسالة تالف: العميل بيرجّع الاختيار عنده ويحدّث، فالمستخدم
  // بيشوف القسم بحجمه الصحيح بدل تثبيت بيختفي بعد ثانية
  if (error instanceof Error && error.message === "MODEL_PINS_FULL") {
    response.status(409).json({
      error: "MODEL_PINS_FULL",
      message: serverMessage("modelPinsFull", lang),
    })
    return
  }
  if (error instanceof Error && error.message === "INVALID_MODEL_PIN") {
    response.status(400).json({
      error: "INVALID_MODEL_PIN",
      message: serverMessage("invalidModelPin", lang),
    })
    return
  }
  ctx.connection.handleError(error, response, request)
}