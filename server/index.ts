import express, { type NextFunction, type Request, type Response } from "express"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { readFileSync, existsSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { config } from "./config.js"
import { clearSessionCookie, isValidAccessToken, requireAuthentication, setSessionCookie } from "./auth.js"
import { OpenCodeService } from "./opencode.js"
import { PushService } from "./push.js"
import { getServerLang, serverMessage } from "./i18n.js"
import type { Event } from "@opencode-ai/sdk"

const app = express()
const openCode = new OpenCodeService(config.openCode)
const push = new PushService(config.push)
const eventClients = new Set<Response>()

function questionEvent(event: Event): { type: string; properties: { sessionID: string; requestID?: string } } | null {
  const candidate = event as unknown as { type?: unknown; properties?: unknown; data?: unknown }
  if (typeof candidate.type !== "string") {
    return null
  }
  if (
    candidate.type !== "question.asked"
    && candidate.type !== "question.replied"
    && candidate.type !== "question.rejected"
    && candidate.type !== "question.v2.asked"
    && candidate.type !== "question.v2.replied"
    && candidate.type !== "question.v2.rejected"
  ) {
    return null
  }
  const source = (candidate.properties ?? candidate.data) as { sessionID?: unknown; id?: unknown; requestID?: unknown } | undefined
  if (!source || typeof source.sessionID !== "string") {
    return null
  }
  const requestID = typeof source.id === "string" ? source.id : typeof source.requestID === "string" ? source.requestID : undefined
  return { type: candidate.type, properties: requestID ? { sessionID: source.sessionID, requestID } : { sessionID: source.sessionID } }
}

function clientEvent(event: Event): Record<string, unknown> | null {
  const question = questionEvent(event)
  if (question) {
    return question
  }
  if (event.type === "session.status" || event.type === "session.idle" || event.type === "session.error") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "todo.updated") {
    return { type: event.type, properties: { sessionID: event.properties.sessionID, todos: event.properties.todos } }
  }
  if (event.type === "permission.updated") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "permission.replied") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
    return { type: event.type, properties: event.properties }
  }
  // مزامنة فورية بين الأجهزة: أي رسالة تُكتب في اللاب (PWA أو TUI على نفس السيرفر)
  // تتبث فورًا لكل عملاء الموبايل الفاتحين نفس المحادثة.
  // نطبّع sessionID في المستوى الأعلى عشان الواجهة تقدر تطابق الجلسة النشطة
  // من غير ما تفكّ شكل كل حدث (info.sessionID أو part.sessionID).
  if (event.type === "message.updated") {
    const sessionID = (event.properties.info as { sessionID?: unknown } | undefined)?.sessionID
    return {
      type: event.type,
      properties: typeof sessionID === "string"
        ? { sessionID, info: event.properties.info }
        : { info: event.properties.info },
    }
  }
  if (event.type === "message.removed") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "message.part.updated") {
    const part = event.properties.part as { sessionID?: unknown } | undefined
    const sessionID = typeof part?.sessionID === "string" ? part.sessionID : undefined
    return {
      type: event.type,
      properties: sessionID ? { sessionID, ...event.properties } : event.properties,
    }
  }
  if (event.type === "message.part.removed") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "session.diff") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "session.compacted") {
    return { type: event.type, properties: event.properties }
  }
  return null
}

app.disable("x-powered-by")
app.use(express.json({ limit: "2mb" }))

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("X-Frame-Options", "DENY")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  next()
})

function handleError(error: unknown, response: Response, request?: Request): void {
  const message = error instanceof Error ? error.message : "Unexpected server error"
  // لو OpenCode لسه بيقوم أو وقع مؤقتًا رجّع 503 برسالة واضحة بدل 500 مبهم
  if (!openCodeReady && /ECONNREFUSED|connect|fetch failed|OpenCode/i.test(message)) {
    if (request) {
      openCodeUnavailable(request, response)
    } else {
      response.status(503).json({ error: "OPENCODE_UNAVAILABLE", message })
    }
    return
  }
  response.status(500).json({ error: "SERVER_ERROR", message })
}

// ── ضمان عدم موت الباك إند: حالة اتصال OpenCode + retry تلقائي ──
let openCodeReady = false
let openCodeLastError = "Connecting to OpenCode…"

function openCodeUnavailable(request: Request, response: Response): void {
  const lang = getServerLang(request)
  const detail = openCodeLastError ? ` (${openCodeLastError})` : ""
  response.status(503).json({
    error: "OPENCODE_UNAVAILABLE",
    message: `${serverMessage("opencodeUnavailable", lang)}${detail}`,
  })
}

async function connectWithRetry(): Promise<void> {
  while (!openCodeReady) {
    try {
      await openCode.connect()
      await openCode.startEvents()
      openCodeReady = true
      openCodeLastError = ""
      console.log("OpenCode connected ✓")
    } catch (error) {
      openCodeReady = false
      openCodeLastError = error instanceof Error ? error.message : String(error)
      console.error(`OpenCode connect failed: ${openCodeLastError} — الخادم على :${config.port} يعمل ويعيد المحاولة بعد 5 ثوانٍ…`)
      await sleep(5000)
    }
  }
}

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

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, openCode: openCodeReady ? "connected" : "connecting", error: openCodeReady ? undefined : openCodeLastError })
})

app.post("/api/login", (request, response) => {
  const accessToken = typeof request.body?.accessToken === "string" ? request.body.accessToken : ""

  if (!isValidAccessToken(accessToken, config.accessToken)) {
    response.status(401).json({ error: "INVALID_ACCESS_TOKEN", message: serverMessage("invalidAccessToken", getServerLang(request)) })
    return
  }

  setSessionCookie(request, response, config.accessToken)
  response.json({ ok: true })
})

app.post("/api/logout", (request, response) => {
  clearSessionCookie(request, response)
  response.json({ ok: true })
})

app.use("/api", requireAuthentication(config.accessToken))

// أي route محتاج OpenCode فعلًا يرجّع 503 واضح بدل ما يموت أو يرمي 500 مبهم.
// المسموح بدون OpenCode: health/login/logout/config/permission/push/events (الكاش والتوثيق).
app.use("/api", (request, response, next) => {
  const path = request.path
  if (
    path === "/health"
    || path === "/login"
    || path === "/logout"
    || path === "/config"
    || path === "/permission"
    || path === "/events"
    || path.startsWith("/push/")
  ) {
    next()
    return
  }
  if (!openCodeReady) {
    openCodeUnavailable(request, response)
    return
  }
  next()
})

app.get("/api/project", async (request, response) => {
  try {
    const projects = await openCode.projects()
    response.json({
      projects: projects.filter((project) => project.worktree !== "/"),
      selected: await openCode.selectedProject(),
    })
  } catch (error) {
    handleError(error, response, request)
  }
})

app.post("/api/project/select", async (request, response) => {
  try {
    const worktree = typeof request.body?.worktree === "string" ? request.body.worktree : ""
    const id = typeof request.body?.id === "string" ? request.body.id : ""
    const projectKey = worktree || id
    if (!projectKey) {
      response.status(400).json({ error: "PROJECT_REQUIRED", message: serverMessage("projectRequired", getServerLang(request)) })
      return
    }
    response.json({ project: await openCode.selectProject(projectKey) })
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/config", async (request, response) => {
  // الـ config لازم يشتغل حتى لو OpenCode لسه بيقوم — يرجّع degraded بدل ما يوقع login
  if (!openCodeReady) {
    response.json({
      openCode: { healthy: false, version: `connecting: ${openCodeLastError}` },
      push: {
        enabled: push.enabled,
        publicKey: push.publicKey ?? null,
      },
      secureContext: Boolean(config.tlsCertificatePath),
    })
    return
  }
  try {
    const health = await openCode.health()
    response.json({
      openCode: health,
      push: {
        enabled: push.enabled,
        publicKey: push.publicKey ?? null,
      },
      secureContext: Boolean(config.tlsCertificatePath),
    })
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/session", async (request, response) => {
  try {
    response.json(await openCode.sessions())
  } catch (error) {
    handleError(error, response, request)
  }
})

app.post("/api/session", async (request, response) => {
  try {
    const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 120) : undefined
    const mobile = request.body?.mobile === true
    response.status(201).json(await openCode.createSession(title || undefined, mobile))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.patch("/api/session/:id", async (request, response) => {
  try {
    const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 120) : ""
    if (!title) {
      response.status(400).json({ error: "INVALID_TITLE", message: serverMessage("invalidTitle", getServerLang(request)) })
      return
    }
    response.json(await openCode.updateSession(request.params.id, title, getServerLang(request)))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.delete("/api/session/:id", async (request, response) => {
  try {
    response.json({ deleted: await openCode.deleteSession(request.params.id) })
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/session/status", async (request, response) => {
  try {
    response.json(await openCode.statuses())
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/activity", async (request, response) => {
  try {
    response.json(await openCode.activity(getServerLang(request)))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/session/:id/message", async (request, response) => {
  try {
    response.json(await openCode.messages(request.params.id))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/session/:id/history", async (request, response) => {
  try {
    response.json(await openCode.history(request.params.id, getServerLang(request)))
  } catch (error) {
    handleError(error, response, request)
  }
})

// كارت لكل طلب في المحادثة، الأقدم فوق والأحدث تحت
app.get("/api/session/:id/requests", async (request, response) => {
  try {
    response.json(await openCode.requests(request.params.id, getServerLang(request)))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.post("/api/session/:id/message", async (request, response) => {
  try {
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : ""
    const agent = typeof request.body?.agent === "string" ? request.body.agent.trim().slice(0, 100) : undefined
    const rawModel = request.body?.model as { providerID?: unknown; modelID?: unknown; variant?: unknown } | undefined
    const model = rawModel && typeof rawModel.providerID === "string" && typeof rawModel.modelID === "string"
      ? {
        providerID: rawModel.providerID.trim().slice(0, 100),
        modelID: rawModel.modelID.trim().slice(0, 200),
        ...(typeof rawModel.variant === "string" && rawModel.variant.trim()
          ? { variant: rawModel.variant.trim().slice(0, 100) }
          : {}),
      }
      : undefined
    if (!text) {
      response.status(400).json({ error: "EMPTY_MESSAGE", message: serverMessage("emptyMessage", getServerLang(request)) })
      return
    }
    if (text.length > 20000) {
      response.status(400).json({ error: "MESSAGE_TOO_LONG", message: serverMessage("messageTooLong", getServerLang(request)) })
      return
    }
    const { queued } = await openCode.prompt(request.params.id, text, agent, model && model.providerID && model.modelID ? model : undefined)
    response.status(202).json({ accepted: true, queued })
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/models", async (request, response) => {
  try {
    response.json(await openCode.models())
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/session/:id/model", async (request, response) => {
  try {
    response.json(await openCode.sessionModel(request.params.id))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.post("/api/session/:id/model", async (request, response) => {
  try {
    const providerID = typeof request.body?.providerID === "string" ? request.body.providerID : ""
    const modelID = typeof request.body?.modelID === "string" ? request.body.modelID : ""
    const variant = typeof request.body?.variant === "string" ? request.body.variant : undefined
    if (!providerID.trim() || !modelID.trim()) {
      response.status(400).json({ error: "MODEL_REQUIRED", message: serverMessage("modelRequired", getServerLang(request)) })
      return
    }
    response.json({ model: await openCode.switchSessionModel(request.params.id, providerID, modelID, variant) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to switch model"
    const status = /not found/i.test(message) ? 404 : /required/i.test(message) ? 400 : 500
    response.status(status).json({ error: "MODEL_SWITCH_FAILED", message })
  }
})

app.post("/api/session/:id/abort", async (request, response) => {
  try {
    response.json(await openCode.abort(request.params.id))
  } catch (error) {
    handleError(error, response, request)
  }
})

// تخطّي الطلب الشغّال: بيوقفه بس والطابور بيكمل بعده
app.post("/api/session/:id/skip", async (request, response) => {
  try {
    response.json(await openCode.skip(request.params.id))
  } catch (error) {
    handleError(error, response, request)
  }
})

// حذف طلب واحد من الطابور من غير ما نوقف اللي شغّال
app.delete("/api/session/:id/request/:requestId", async (request, response) => {
  try {
    const requestId = request.params.requestId.trim()
    if (!requestId) {
      response.status(400).json({ error: "REQUEST_REQUIRED", message: serverMessage("requestRequired", getServerLang(request)) })
      return
    }
    response.json(openCode.removeQueued(request.params.id, requestId))
  } catch (error) {
    handleError(error, response, request)
  }
})

// تنفيذ طلب مستني حالًا: بيوقّف اللي شغّال وبيبعث المطلوب ده على طول
app.post("/api/session/:id/request/:requestId/run", async (request, response) => {
  try {
    const requestId = request.params.requestId.trim()
    if (!requestId) {
      response.status(400).json({ error: "REQUEST_REQUIRED", message: serverMessage("requestRequired", getServerLang(request)) })
      return
    }
    response.json(await openCode.runQueued(request.params.id, requestId))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/session/:id/todo", async (request, response) => {
  try {
    response.json(await openCode.todos(request.params.id))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.post("/api/session/:id/question/:requestId/reply", async (request, response) => {
  try {
    if (!request.params.requestId.trim()) {
      response.status(400).json({ error: "QUESTION_REQUIRED", message: serverMessage("questionRequired", getServerLang(request)) })
      return
    }
    response.json({ accepted: await openCode.replyQuestion(request.params.id, request.params.requestId, request.body?.answers) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reply to question"
    const status = /not found/i.test(message) ? 404 : /answer|option|select/i.test(message) ? 400 : 500
    response.status(status).json({ error: "QUESTION_REPLY_FAILED", message })
  }
})

app.post("/api/session/:id/question/:requestId/reject", async (request, response) => {
  try {
    if (!request.params.requestId.trim()) {
      response.status(400).json({ error: "QUESTION_REQUIRED", message: serverMessage("questionRequired", getServerLang(request)) })
      return
    }
    response.json({ accepted: await openCode.rejectQuestion(request.params.id, request.params.requestId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reject question"
    const status = /not found/i.test(message) ? 404 : 500
    response.status(status).json({ error: "QUESTION_REJECT_FAILED", message })
  }
})

app.get("/api/session/:id/diff", async (request, response) => {
  try {
    response.json(await openCode.diff(request.params.id))
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/git/changes", async (request, response) => {
  try {
    response.json(await openCode.gitChanges())
  } catch (error) {
    handleError(error, response, request)
  }
})

app.get("/api/session/:id/file", async (request, response) => {
  try {
    const filePath = typeof request.query.path === "string" ? request.query.path : ""
    if (!filePath.trim()) {
      response.status(400).json({ error: "FILE_PATH_REQUIRED", message: serverMessage("filePathRequired", getServerLang(request)) })
      return
    }
    const file = await openCode.readResultFile(request.params.id, filePath)
    response.setHeader("Content-Type", file.mime)
    response.setHeader("Content-Length", String(file.size))
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
    response.setHeader("Cache-Control", "no-store")
    response.send(file.content)
  } catch (error) {
    const message = error instanceof Error ? error.message : "File download failed"
    const status = /not found/i.test(message) ? 404 : 400
    response.status(status).json({ error: "FILE_DOWNLOAD_FAILED", message })
  }
})

app.get("/api/permission", (_request, response) => {
  response.json(openCode.permissions())
})

app.post("/api/session/:id/permission/:permissionId", async (request, response) => {
  try {
    const value = request.body?.response
    if (value !== "once" && value !== "always" && value !== "reject") {
      response.status(400).json({ error: "INVALID_PERMISSION_RESPONSE", message: serverMessage("invalidPermissionResponse", getServerLang(request)) })
      return
    }
    response.json({ accepted: await openCode.replyPermission(request.params.id, request.params.permissionId, value) })
  } catch (error) {
    handleError(error, response, request)
  }
})

app.post("/api/push/subscribe", async (request, response) => {
  try {
    await push.register(request.body)
    response.status(201).json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push subscription failed"
    response.status(400).json({ error: "INVALID_SUBSCRIPTION", message })
  }
})

app.post("/api/push/test", async (request, response) => {
  try {
    await push.test(request.body)
    response.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push test failed"
    response.status(400).json({ error: "PUSH_TEST_FAILED", message })
  }
})

app.delete("/api/push/subscribe", async (request, response) => {
  const endpoint = typeof request.body?.endpoint === "string" ? request.body.endpoint : ""
  await push.unregister(endpoint)
  response.json({ ok: true })
})

app.get("/api/events", (request, response) => {
  response.status(200)
  response.setHeader("Content-Type", "text/event-stream")
  response.setHeader("Cache-Control", "no-cache, no-transform")
  response.setHeader("Connection", "keep-alive")
  response.setHeader("X-Accel-Buffering", "no")
  response.flushHeaders()
  response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)
  eventClients.add(response)

  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      response.write(": heartbeat\n\n")
    }
  }, 25000)

  request.on("close", () => {
    clearInterval(heartbeat)
    eventClients.delete(response)
  })
})

// هل الحدث ده "الجلسة خلصت"؟ (session.idle أو status=idle)
function isIdleEvent(event: Record<string, unknown>): boolean {
  if (event.type === "session.idle") {
    return true
  }
  if (event.type !== "session.status") {
    return false
  }
  const status = (event.properties as { status?: { type?: string } } | undefined)?.status
  return status?.type === "idle"
}

function eventSessionId(event: Record<string, unknown>): string {
  const properties = event.properties as { sessionID?: unknown } | undefined
  return typeof properties?.sessionID === "string" ? properties.sessionID : ""
}

openCode.onEvent((event) => {
  const visibleEvent = clientEvent(event)
  // "خلص" بس في طلبات تانية مستنية في الطابور — متعملش لا إشعار ولا تحديث
  // للموبايل، عشان المستخدم ما يشوفش إن الجلسة وقفت وهي في الحقيقة شغالة.
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
  for (const client of eventClients) {
    if (!client.writableEnded) {
      client.write(data)
    }
  }
})

const distDirectory = resolve(process.cwd(), "dist")
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory, { index: false }))
  app.use((request, response, next) => {
    if (request.method === "GET" && !request.path.startsWith("/api/")) {
      response.sendFile(join(distDirectory, "index.html"))
      return
    }
    next()
  })
}

app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  void next
  handleError(error, response, request)
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
  void connectWithRetry()

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
