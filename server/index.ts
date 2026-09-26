import express, { type NextFunction, type Request, type Response } from "express"
import compression from "compression"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { readFileSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { config } from "./config.js"
import { requireAuthentication } from "./auth.js"
import { OpenCodeService } from "./opencode.js"
import { PushService } from "./push.js"
import { createRateLimiter } from "./utils/rate-limit.js"
import { OpenCodeConnection } from "./connection.js"
import { EventHub } from "./sse/hub.js"
import { clientEvent, eventSessionId, isIdleEvent } from "./sse/filter.js"
import { securityHeaders } from "./middleware/security.js"
import { registerStatic } from "./static.js"
import { registerHealthRoutes } from "./routes/health.js"
import { registerAuthRoutes } from "./routes/auth.js"
import { registerConfigRoutes } from "./routes/config.js"
import { registerProjectRoutes } from "./routes/projects.js"
import { registerSessionRoutes } from "./routes/sessions.js"
import { registerConversationRoutes } from "./routes/conversation.js"
import { registerModelRoutes } from "./routes/models.js"
import { registerInteractionRoutes } from "./routes/interaction.js"
import { registerGitRoutes } from "./routes/git.js"
import { registerFileRoutes } from "./routes/files.js"
import { registerPushRoutes } from "./routes/push.js"
import { registerEventRoutes } from "./routes/events.js"
import type { RouteContext } from "./routes/context.js"
import type { Event } from "@opencode-ai/sdk"

// ── تركيب السيرفر (composition root): إنشاء الخدمات وحقنها في المسارات ──
// كل منطق الـ routes والـ SSE والاتصال انتقل لوحداته الخاصة؛ هنا التوصيل فقط.

const app = express()
const openCode = new OpenCodeService(config.openCode)
const push = new PushService(config.push)
const connection = new OpenCodeConnection(openCode)
const hub = new EventHub()

// حد معدل سخي للنقاط الساخنة: الاستخدام الطبيعي (~15-20 poll/min لكل عميل)
// بعيد عن السقف، لكن حلقات الخلل والعواصف بتتوقف بـ 429 + Retry-After
const pollLimiter = createRateLimiter({ windowMs: 60_000, max: 300 })

const routeContext: RouteContext = { openCode, push, connection, hub, pollLimiter }

app.disable("x-powered-by")
// ضغط gzip/deflate للأصول والـ JSON — يفرق على شبكات Wi-Fi الضعيفة.
// ملاحظة: /api/events عليه `no-transform` فالضغط يتخطاه تلقائيًا ولا يعلّق الستريم.
app.use(compression())
app.use(express.json({ limit: "2mb" }))

app.use(securityHeaders)

// عامة قبل حارس التوثيق: الفحص الحي وتسجيل الدخول/الخروج
registerHealthRoutes(app, routeContext)
registerAuthRoutes(app, routeContext)

app.use("/api", requireAuthentication(config.accessToken))

// أي route محتاج OpenCode فعلًا يرجّع 503 واضح بدل ما يموت أو يرمي 500 مبهم.
// المسموح بدون OpenCode: health/login/logout/config/permission/push/events (الكاش والتوثيق).
app.use("/api", connection.readinessGate())

registerConfigRoutes(app, routeContext)
registerProjectRoutes(app, routeContext)
registerSessionRoutes(app, routeContext)
registerConversationRoutes(app, routeContext)
registerModelRoutes(app, routeContext)
registerInteractionRoutes(app, routeContext)
registerGitRoutes(app, routeContext)
registerFileRoutes(app, routeContext)
registerPushRoutes(app, routeContext)
registerEventRoutes(app, routeContext)

// جسر الأحداث: OpenCode → ترشيح → (push + بثّ SSE)
// "خلص" بس في طلبات تانية مستنية في الطابور — متعملش لا إشعار ولا تحديث
// للموبايل، عشان المستخدم ما يشوفش إن الجلسة وقفت وهي في الحقيقة شغالة.
openCode.onEvent((event: Event) => {
  const visibleEvent = clientEvent(event)
  const queueContinues = visibleEvent
    ? isIdleEvent(visibleEvent) && openCode.hasPendingWork(eventSessionId(visibleEvent))
    : false
  if (!queueContinues) {
    push.handleEvent(event)
  }
  if (!visibleEvent || queueContinues) {
    return
  }
  const data = `event: opencode\ndata: ${JSON.stringify(visibleEvent)}\n\n`
  hub.broadcast(data)
})

registerStatic(app)

app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  void next
  connection.handleError(error, response, request)
})

function printLanAddresses(port: number): void {
  try {
    const nets = networkInterfaces()
    const ips = new Set<string>()
    for (const list of Object.values(nets)) {
      for (const entry of list || []) {
        if (entry.family === "IPv4" && !entry.internal) {
          ips.add(entry.address)
        }
      }
    }
    if (ips.size === 0) {
      console.log("No LAN IP found — تأكد أن الجهاز على نفس شبكة Wi-Fi مع الهاتف")
      return
    }
    console.log("من الهاتف (نفس شبكة Wi-Fi) افتح:")
    for (const ip of ips) {
      console.log(`  - Dev (Vite):  http://${ip}:5173`)
      console.log(`  - Prod (بعد build): http://${ip}:${port}`)
    }
  } catch {
    // تجاهل — الطباعة مساعدة فقط
  }
}

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
      console.error(`Port ${config.port} مشغول — اقفل أي نسخة قديمة من السيرفر أو غيّر APP_PORT في .env`)
    } else {
      console.error("Server error:", error.message)
    }
  })

  // الأهم: افتح بورت 7171 فورًا قبل أي اتصال بـ OpenCode،
  // عشان /api/login و /api/health يردّوا دايمًا وVite proxy ميضربش ECONNREFUSED أبدًا.
  server.listen(config.port, config.host, () => {
    console.log(`OpenCode Mobile listening on ${config.host}:${config.port}`)
    console.log(`OpenCode project: ${config.openCode.projectDirectory}`)
    printLanAddresses(config.port)
    if (!config.tlsCertificatePath) {
      console.log("TLS is disabled; Web Push and PWA installation require HTTPS or localhost")
    }
  })

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

export { app, openCode, push }
