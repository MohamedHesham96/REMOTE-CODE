import type { OpenCodeEvent } from "@opencode/client"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import webpush, { type PushSubscription } from "web-push"
import { isServerLang, serverMessage, type ServerLang } from "./i18n.js"
import { mapWithConcurrency } from "./utils/concurrency.js"

// حد تزامن إرسال الإشعارات: إرسال غير محدود لكل الاشتراكات لحظيًا
// كان بيعلّق مسار الأحداث لما endpoint يهنّج — 5 concurrent تكفي وتُبقي الترتيب
const PUSH_SEND_CONCURRENCY = 5

interface StoredSubscriptions {
  version: 1
  subscriptions: PushSubscription[]
  languages?: Record<string, ServerLang>
}

interface PushPayload {
  title: string
  body: string
  sessionId?: string
  tag?: string
}

interface PushOptions {
  publicKey?: string
  privateKey?: string
  subject: string
}

function isPushSubscription(value: unknown): value is PushSubscription {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const candidate = value as Partial<PushSubscription>
  return (
    typeof candidate.endpoint === "string" &&
    candidate.endpoint.startsWith("https://") &&
    typeof candidate.keys?.auth === "string" &&
    typeof candidate.keys?.p256dh === "string"
  )
}

function questionNotification(event: OpenCodeEvent, lang: ServerLang): PushPayload | null {
  // v2 يستبدل الأسئلة باستمارات — عنوان الاستمارة هو نص السؤال.
  if ((event.type as string) !== "form.created") {
    return null
  }
  const form = (event.data as unknown as { form?: { id?: unknown; sessionID?: unknown; title?: unknown } }).form
  const sessionID = typeof form?.sessionID === "string" ? form.sessionID : undefined
  if (!sessionID) {
    return null
  }
  const requestID = typeof form?.id === "string" ? form.id : undefined
  const title = typeof form?.title === "string" ? form.title.trim() : ""
  return {
    title: serverMessage("pushQuestionTitle", lang),
    body: title || serverMessage("pushQuestionFallback", lang),
    sessionId: sessionID,
    tag: requestID ? `question-${requestID}` : `question-${sessionID}`,
  }
}

export class PushService {
  private readonly storagePath: string
  private readonly subscriptions = new Map<string, PushSubscription>()
  private readonly languages = new Map<string, ServerLang>()
  private readonly busySessions = new Set<string>()
  readonly enabled: boolean
  readonly publicKey: string | undefined

  constructor(options: PushOptions) {
    this.storagePath = resolve(process.cwd(), "data", "push-subscriptions.json")
    this.enabled = Boolean(options.publicKey && options.privateKey)
    this.publicKey = options.publicKey

    if (this.enabled) {
      webpush.setVapidDetails(options.subject, options.publicKey!, options.privateKey!)
    }
  }

  async initialize(): Promise<void> {
    await mkdir(resolve(process.cwd(), "data"), { recursive: true, mode: 0o700 })

    try {
      const content = await readFile(this.storagePath, "utf8")
      const stored = JSON.parse(content) as Partial<StoredSubscriptions>

      for (const subscription of stored.subscriptions || []) {
        if (isPushSubscription(subscription)) {
          this.subscriptions.set(subscription.endpoint, subscription)
          const lang = stored.languages?.[subscription.endpoint]
          this.languages.set(subscription.endpoint, isServerLang(lang) ? lang : "ar")
        }
      }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : ""
      if (code !== "ENOENT") {
        throw error
      }
    }
  }

  async register(value: unknown): Promise<void> {
    if (!isPushSubscription(value)) {
      throw new Error("Invalid push subscription")
    }

    this.subscriptions.set(value.endpoint, value)
    const lang = (value as { lang?: unknown }).lang
    this.languages.set(value.endpoint, isServerLang(lang) ? lang : "ar")
    await this.persist()
  }

  async unregister(endpoint: string): Promise<void> {
    if (this.subscriptions.delete(endpoint)) {
      this.languages.delete(endpoint)
      await this.persist()
    }
  }

  handleEvent(event: OpenCodeEvent): void {
    if (!this.enabled) {
      return
    }
    // الاتحاد اللفظي المغلق يُنسخ لنص حر — نفس علة server/sse/filter.ts.
    const eventType: string = event.type

    if (eventType === "session.execution.started") {
      const started = event.data as unknown as { sessionID: string }
      this.busySessions.add(started.sessionID)
    }

    if (eventType === "session.status") {
      const withStatus = event.data as unknown as { sessionID: string; status: { type: string } }
      if (withStatus.status.type === "busy" || withStatus.status.type === "retry") {
        this.busySessions.add(withStatus.sessionID)
      }
    }

    if (eventType === "session.idle") {
      const idle = event.data as unknown as { sessionID: string }
      if (this.busySessions.delete(idle.sessionID)) {
        const sessionId = idle.sessionID
        void this.broadcast((lang) => ({
          title: serverMessage("pushDoneTitle", lang),
          body: serverMessage("pushDoneBody", lang),
          sessionId,
          tag: `opencode-${sessionId}`,
        }))
      }
    }

    const questionAr = questionNotification(event, "ar")
    const questionEn = questionNotification(event, "en")
    if (questionAr && questionEn) {
      void this.broadcast((lang) => (lang === "en" ? questionEn : questionAr))
    }

    if (eventType === "permission.asked") {
      const asked = event.data as unknown as { id: string; sessionID: string; action: string }
      const { id, sessionID, action } = asked
      void this.broadcast((lang) => ({
        title: serverMessage("pushPermissionTitle", lang),
        body: action,
        sessionId: sessionID,
        tag: `permission-${id}`,
      }))
    }

    if (eventType === "session.execution.succeeded" && this.busySessions.delete((event.data as unknown as { sessionID: string }).sessionID)) {
      const sessionId = (event.data as unknown as { sessionID: string }).sessionID
      void this.broadcast((lang) => ({
        title: serverMessage("pushDoneTitle", lang),
        body: serverMessage("pushDoneBody", lang),
        sessionId,
        tag: `opencode-${sessionId}`,
      }))
    }

    if (eventType === "session.execution.failed") {
      const failed = event.data as unknown as { sessionID: string }
      const sessionId = failed.sessionID
      this.busySessions.delete(sessionId)
      void this.broadcast((lang) => ({
        title: serverMessage("pushErrorTitle", lang),
        body: serverMessage("pushErrorBody", lang),
        sessionId,
        tag: `error-${sessionId ?? "unknown"}`,
      }))
    }
  }

  private async broadcast(build: (lang: ServerLang) => PushPayload): Promise<void> {
    const expired: string[] = []

    // تزامن محدود بدل Promise.all غير المحدود: endpoint بطيء واحد
    // لا يوقف الباقي ولا يعلّق معالج الأحداث
    await mapWithConcurrency([...this.subscriptions.values()], PUSH_SEND_CONCURRENCY, async (subscription) => {
      try {
        const lang = this.languages.get(subscription.endpoint) ?? "ar"
        await this.send(subscription, build(lang))
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined
        if (statusCode === 404 || statusCode === 410) {
          expired.push(subscription.endpoint)
        } else {
          console.error("Push delivery failed", error)
        }
      }
    })

    if (expired.length > 0) {
      for (const endpoint of expired) {
        this.subscriptions.delete(endpoint)
      }
      await this.persist()
    }
  }

  private async send(subscription: PushSubscription, payload: PushPayload): Promise<void> {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60,
      urgency: "high",
    })
  }

  private async persist(): Promise<void> {
    const data: StoredSubscriptions = {
      version: 1,
      subscriptions: [...this.subscriptions.values()],
      languages: Object.fromEntries(this.languages),
    }
    await writeFile(this.storagePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
  }
}
