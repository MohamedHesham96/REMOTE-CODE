import type { NextFunction, Request, Response } from "express"

export function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("X-Frame-Options", "DENY")
  response.setHeader("Referrer-Policy", "no-referrer")
  // `microphone=()` بتقفل المايك على كل المتصفحات فورًا لأن Chrome وBrave وEdge
  // كلهم بيحترموا Permissions-Policy — والإدخال الصوتي محتاج المايك لنفس الأصل.
  // الكاميرا والموقع يفضلوا مقفولين: مفيش حاجة في التطبيق بتستخدمهم.
  response.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()")
  next()
}
