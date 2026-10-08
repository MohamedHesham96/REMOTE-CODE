import express, { type NextFunction, type Request, type Response } from "express"
import compression from "compression"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { readFileSync } from "node:fs"
import { config } from "./config.js"
import { requireAuthentication } from "./auth.js"
import { OpenCodeService } from "./opencode.js"
import { ModelPinService } from "./model-pins.js"
import { FavoritePromptService } from "./favorites.js"
import { PinService } from "./pins.js"
import { PushService } from "./push.js"
import { createRateLimiter } from "./utils/rate-limit.js"
import { OpenCodeConnection } from "./connection.js"
import { EventHub, favoritesEvent, modelPinsEvent, pinsEvent } from "./sse/hub.js"
import { consoleLang, serverMessage } from "./i18n.js"
import { clientEvent, conversationEvent, eventSessionId, finishedRunEvent, isIdleEvent } from "./sse/filter.js"
import { securityHeaders } from "./middleware/security.js"
import { registerStatic } from "./static.js"
import { registerHealthRoutes } from "./routes/health.js"
import { registerAuthRoutes } from "./routes/auth.js"
import { registerConfigRoutes } from "./routes/config.js"
import { registerCertificateRoutes } from "./routes/certificate.js"
import { registerProjectRoutes } from "./routes/projects.js"
import { registerSessionRoutes } from "./routes/sessions.js"
import { registerPinRoutes } from "./routes/pins.js"
import { registerModelPinRoutes } from "./routes/model-pins.js"
import { registerFavoriteRoutes } from "./routes/favorites.js"
import { registerConversationRoutes } from "./routes/conversation.js"
import { registerModelRoutes } from "./routes/models.js"
import { registerInteractionRoutes } from "./routes/interaction.js"
import { registerGitRoutes } from "./routes/git.js"
import { registerFileRoutes } from "./routes/files.js"
import { registerPushRoutes } from "./routes/push.js"
import { registerEventRoutes } from "./routes/events.js"
import type { RouteContext } from "./routes/context.js"
import type { OpenCodeEvent } from "@opencode/client"

// ── تركيب السيرفر (composition root): إنشاء الخدمات وحقنها في المسارات ──
// كل منطق الـ routes والـ SSE والاتصال انتقل لوحداته الخاصة؛ هنا التوصيل فقط.

// v2 يستخدم قاعدة البيانات المشتركة مع تطبيق الديسكتوب — نفس الجلسات
// في المكانين دون عزل أو استيراد. لا تضبط OPENCODE_DB إطلاقًا.

const app = express()
const openCode = new OpenCodeService(config.openCode)
const pins = new PinService()
const modelPins = new ModelPinService()
const favorites = new FavoritePromptService()
const push = new PushService(config.push)
const connection = new OpenCodeConnection(openCode)
const hub = new EventHub()

// حد معدل سخي للنقاط الساخنة: الاستخدام الطبيعي (~15-20 poll/min لكل عميل)
// بعيد عن السقف، لكن حلقات الخلل والعواصف بتتوقف بـ 429 + Retry-After
const pollLimiter = createRateLimiter({ windowMs: 60_000, max: 300 })

const routeContext: RouteContext = { openCode, pins, modelPins, favorites, push, connection, hub, pollLimiter }

// مثبّتات: مصدر الحقيقة الوحيد، فلازم يتغيّر في كل الأجهزة والـ tabs المفتوحة.
// البثّ من الـ service نفسه مش من الـ routes، فأي تعديل يوصل — حتى اللي
// بيحصل مع حذف جلسة (forget) أو مع ترقية كاش جهاز تاني (merge).
pins.subscribe((list) => {
  hub.broadcast(pinsEvent(list))
})

// مثبّتات النماذج نفس المنطق على قناة SSE تانية: تثبيت من الموبايل يظهر على
// الويب فورًا والعكس، والقائمة العالمية بتتحدث لكل الأجهزة المفتوحة.
modelPins.subscribe((models) => {
  hub.broadcast(modelPinsEvent(models))
})

// الطلبات المفضّلة نفس المسار على قناة SSE تالتة: الحفظ/التعديل/الحذف من أي
// جهاز يوصل لكل الأجهزة المفتوحة فورًا من غير poll.
favorites.subscribe((list) => {
  hub.broadcast(favoritesEvent(list))
})

// ترقية المثبّتات القديمة اللي مالها مسار (كاش ids مجرّدة): OpenCode هو اللي
// يعرف مكان كل محادثة، فننسبها لمشروعها بدل ما تفضل مختفية أو — الأسوأ —
// تظهر في مشروع غلط. بنجرّب أول ما الـ resolver يتركّب وأول ما OpenCode يبقى
// جاهز، وبعدها مع كل تعديل جديد.
pins.setProjectResolver((sessionIds) => openCode.sessionProjects(sessionIds))
connection.onReady(() => {
  void pins.attributeMissing()
})

app.disable("x-powered-by")
// ضغط gzip/deflate للأصول والـ JSON — يفرق على شبكات Wi-Fi الضعيفة.
// ملاحظة: /api/events عليه `no-transform` فالضغط يتخطاه تلقائيًا ولا يعلّق الستريم.
app.use(compression())
// 8MB يستوعب مرفقات الرسائل (صور/ملفات مضمّنة كـ data URI). الترميز
// المضمّن يكبّر الحجم ~33%، وOpenCode نفسه بيعيد ضغط الصور الكبيرة.
app.use(express.json({ limit: "8mb" }))

app.use(securityHeaders)

// عامة قبل حارس التوثيق: الفحص الحي وتسجيل الدخول/الخروج
registerHealthRoutes(app, routeContext)
registerAuthRoutes(app, routeContext)

app.use("/api", requireAuthentication(config.accessToken))

// تنزيل شهادة الـ CA لازم يكون متاح بعد التوثيق وقبل بوابة الجهوزية:
// المستخدم بيجهّز الموبايل قبل ما OpenCode يخلص، والملف مش محتاج المحرك.
registerCertificateRoutes(app)

// أي route محتاج OpenCode فعلًا يرجّع 503 واضح بدل ما يموت أو يرمي 500 مبهم.
// المسموح بدون OpenCode: health/login/logout/config/permission/push/events (الكاش والتوثيق).
app.use("/api", connection.readinessGate())

registerConfigRoutes(app, routeContext)
registerProjectRoutes(app, routeContext)
registerSessionRoutes(app, routeContext)
registerPinRoutes(app, routeContext)
registerModelPinRoutes(app, routeContext)
registerFavoriteRoutes(app, routeContext)
registerConversationRoutes(app, routeContext)
registerModelRoutes(app, routeContext)
registerInteractionRoutes(app, routeContext)
registerGitRoutes(app, routeContext)
registerFileRoutes(app, routeContext)
registerPushRoutes(app, routeContext)
registerEventRoutes(app, routeContext)

// جسر الأحداث: OpenCode → تجميع على المحادثة الأم → ترشيح → (push + بثّ SSE)
// مهمة Task جلسات ابن، وحالتها بتيجي على الـ id بتاعها هي. فلو بتتبلّث
// كأنها محادثات مستقلة، صوت الإتمام بيرنّ مع كل مهمة فرعية تخلص. فالتجميع
// بيحوّل الحالة للجذر قبل أي مستهلك — وحدث الـ idle بيتشال لو الشغل لسه
// جاري في نفس المحادثة (مهمة خلصت وأختها شغّالة).
// "خلص" بس في طلبات تانية مستنية في الطابور — متعملش لا إشعار ولا تحديث
// للموبايل، عشان المستخدم ما يشوفش إن الجلسة وقفت وهي في الحقيقة شغالة.
openCode.onEvent((event: OpenCodeEvent) => {
  const conversation = conversationEvent(event, openCode)
  if (!conversation) {
    return
  }
  const visibleEvent = clientEvent(conversation)
  const queueContinues = visibleEvent
    ? isIdleEvent(visibleEvent) && openCode.hasPendingWork(eventSessionId(visibleEvent))
    : false
  if (!queueContinues) {
    push.handleEvent(conversation)
  }
  if (!visibleEvent || queueContinues) {
    return
  }
  const data = `event: opencode\ndata: ${JSON.stringify(visibleEvent)}\n\n`
  hub.broadcast(data)
})

// نهاية تنفيذ فعلية (session.execution.succeeded/failed/interrupted) غالبًا
// مبيجيش بعدها idle صريح، والـ filter بيترجمها لحاجة تانية خالص. فنبعت هنا
// انتقال idle مصنّع للجذر لو الشجرة كلها فاضية، فأي جهاز مفتوح يخلّي المحادثة
// "جاهزة" في نفس اللحظة من غير ما يستنى refresh. (الحدث الحقيقي لسه بيمرّ من
// فوق في مساره، والحدث المصنّع بيتولّد بس لما finishedRunEvent ترجّع حدث.)
openCode.onEvent((event: OpenCodeEvent) => {
  const idle = finishedRunEvent(event, openCode)
  if (!idle) {
    return
  }
  hub.broadcast(`event: opencode\ndata: ${JSON.stringify(idle)}\n\n`)
})

registerStatic(app)

app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  void next
  connection.handleError(error, response, request)
})

async function start(): Promise<void> {
  // push اختيارية — فشلها لا يوقع السيرفر أبدًا
  try {
    await push.initialize()
  } catch (error) {
    console.error("Push init failed (continuing without push):", error instanceof Error ? error.message : error)
  }

  const server = config.tlsCertificatePath && config.tlsPrivateKeyPath
    ? createHttpsServer(
        {
          cert: readFileSync(config.tlsCertificatePath),
          key: readFileSync(config.tlsPrivateKeyPath),
        },
        app,
      )
    : createHttpServer(app)

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(serverMessage("portInUse", consoleLang()).replace("{port}", `${config.port}`))
    } else {
      console.error("Server error:", error.message)
    }
  })

  // الأهم: افتح بورت 7171 فورًا قبل أي اتصال بـ OpenCode،
  // عشان /api/login و /api/health يردّوا دايمًا وVite proxy ميضربش ECONNREFUSED أبدًا.
  // وضع هادئ مقصود: لا سطور بدء تشغيل — الأخطاء وحدها تُطبع
  // (تعارض البورت أعلى). سطور العناوين أُزيلت من هنا ومن build.bat معًا.
  server.listen(config.port, config.host, () => {})

  // اتصال OpenCode في الخلفية مع retry للأبد — السيرفر يفضل شغال حتى لو opencode واقع
  void connection.connectWithRetry(config.port)

  const shutdown = (): void => {
    openCode.close()
    server.close()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

void start().catch((error) => {
  // start نفسها لا ترمي عمليًا (listen + background retry)، لكن لو حصل خطأ قاتل
  // مثل .env ناقص اطبعه بوضوح بدل موت صامت.
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
