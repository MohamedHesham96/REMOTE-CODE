import type { Express } from "express"
import type { RouteContext } from "./context.js"

// فحص التحديث لا يحتاج OpenCode ولا يمنع الإقلاع: الراوت مسجّل بعد حارس
// التوثيق وقبل بوابة الجهوزية، فالرد ييجي من كاش السيرفر أو من طلب شبكة
// واحد، والفشل يتحول لنتيجة "لا يوجد تحديث" بدل خطأ للمستخدم.
export function registerUpdateRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/update", async (request, response) => {
    try {
      response.json(await ctx.update.check())
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })
}
