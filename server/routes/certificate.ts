import { existsSync, readFileSync } from "node:fs"
import type { Express } from "express"
import { config } from "../config.js"
import { getServerLang, serverMessage } from "../i18n.js"

// تنزيل شهادة الـ CA للموبايل: الملف اللي بيتثبّت مرة واحدة على كل جهاز
// عشان الكروم يثق بأصل HTTPS. من غيره المايك (Web Speech) والإشعارات مرفوضة
// لأن المتصفح بيعتبر الشهادة الموقّعة ذاتيًا غير آمنة.
//
// الراوت مسجّل بعد حارس التوثيق وقبل بوابة الجهوزية: المستخدم محتاج الملف
// وهو لسه بيرتّب الموبايل، ومش منطقي نستنی OpenCode يبقى جاهز لتنزيل ملف
// ثابت على القرص.
export function registerCertificateRoutes(app: Express): void {
  app.get("/api/certificate", (request, response) => {
    // مسار الشهادة من نفس مصدر TLS اللي السيرفر شغّال بيه: لو اتغيّرت الشهادة
    // يتغيّر معاها الملف اللي بنقدّمه، فما نقدّمش نسخة قديمة مش مطابقة.
    const certificatePath = config.tlsCertificatePath
    if (!certificatePath || !existsSync(certificatePath)) {
      response.status(404).json({ error: "CERTIFICATE_UNAVAILABLE", message: serverMessage("certificateUnavailable", getServerLang(request)) })
      return
    }
    // شهادة السيرفر مش الـ CA: اللابتوب بيثق بالـ CA (مثبّت في الـ Root store)
    // والموبايل محتاج نفس الـ CA. اقدر أقدّمه من caroot، بس أبسط وأضمن مصدر
    // موجود بجانب الشهادات هو ملف rootCA اللي build.bat بينسخه في cert\.
    const caPath = caFilePath(certificatePath)
    if (!caPath) {
      response.status(404).json({ error: "CERTIFICATE_UNAVAILABLE", message: serverMessage("certificateUnavailable", getServerLang(request)) })
      return
    }
    try {
      const content = readFileSync(caPath)
      response.setHeader("Content-Type", "application/x-x509-ca-cert")
      // امتداد .crt: أندرويد بيفتحه كشهادة من إعدادات الأمان مباشرة، وiOS
      // كمان يعرضه كوصف ملف (profile) قابل للتثبيت. اسم الملف ثابت عشان
      // المستخدم يلاقيه بسهولة في التنزيلات.
      response.setHeader("Content-Disposition", "attachment; filename=\"remotecode-ca.crt\"")
      response.setHeader("Cache-Control", "no-store")
      response.setHeader("Content-Length", String(content.length))
      response.end(content)
    } catch {
      response.status(500).json({ error: "CERTIFICATE_UNAVAILABLE", message: serverMessage("certificateUnavailable", getServerLang(request)) })
    }
  })
}

// ملف الـ CA المصدَّر بجانب شهادة السيرفر (cert\rootCA.crt). مسار الشهادة
// جاي من config.ts مطبَّع (resolve على cwd)، والشهادة في cert\server.pem،
// فالـ CA متوقع في نفس المجلد.
function caFilePath(certificatePath: string): string | undefined {
  const separator = Math.max(certificatePath.lastIndexOf("/"), certificatePath.lastIndexOf("\\"))
  if (separator < 0) {
    return undefined
  }
  const candidate = `${certificatePath.slice(0, separator)}${certificatePath[separator]}\\rootCA.crt`
  return existsSync(candidate) ? candidate : undefined
}
