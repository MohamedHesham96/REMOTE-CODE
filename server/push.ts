import type { Event } from "@opencode-ai/sdk"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import webpush, { type PushSubscription } from "web-push"
import { isServerLang, serverMessage, type ServerLang } from "./i18n.js"
import { mapWithConcurrency } from "./http-utils.js"

// حد تزامن إرسال الإشعارات: إرسال غير محدود لكل الاشتراكات لحظيًا
// كان بيعلّق مسار الأحداث لما endpoint يهنّج — 5 concurrent تكفي وتُبقي الترتيب
const PUSH_SEND_CONCURRENCY = 5

interface StoredSubscriptions {
  version: 1
  subscriptions: PushSubscription[]
  languages?: Record<string, ServerLang>
}

interface StoredSubscriptions {
  version: 1
  subscriptions: PushSubscription[]
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

function questionNotification(event: Event, lang: ServerLang): PushPayload | null {
  const candidate = event as unknown as { type?: unknown; properties?: unknown; data?: unknown }
  if (candidate.type !== "question.asked" && candidate.type !== "question.v2.asked") {
    return null
  }
  const source = (candidate.properties ?? candidate.data) as { sessionID?: unknown; id?: unknown; requestID?: unknown; questions?: unknown } | undefined
  if (!source || typeof source.sessionID !== "string") {
    return null
  }
  const requestID = typeof source.id === "string" ? source.id : typeof source.requestID === "string" ? source.requestID : undefined
  const first = Array.isArray(source.questions) ? source.questions.find((value): value is { question?: unknown } => typeof value === "object" && value !== null) : undefined
  const body = first && typeof first.question === "string" && first.question.trim() ? first.question.trim() : serverMessage("pushQuestionFallback", lang)
  return {
    title: serverMessage("pushQuestionTitle", lang),
    body,
    sessionId: source.sessionID,
    tag: requestID ? `question-${requestID}` : `question-${source.sessionID}`,
  }
}

export class PushService {
  private readonly storagePath: string
  private readonly subscriptions = new Map<string, PushSubscription>()
  private readonly languages = new Map<string, ServerLang>()
  private readonly busySessions = new Set<string>()
  readonly enabled: boolean
  readonly publicKey: string | undefined

  constructor(private readonly options: PushOptions) {
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

  async test(value: unknown): Promise<void> {
    if (!isPushSubscription(value)) {
      throw new Error("Invalid push subscription")
    }

    if (!this.enabled) {
      throw new Error("Web Push is not configured")
    }

    const lang = isServerLang((value as unknown as { lang?: unknown }).lang) ? (value as unknown as { lang: ServerLang }).lang : "ar"
    await this.send(value, {
      title: "OpenCode Mobile",
      body: serverMessage("pushTestBody", lang),
      tag: "opencode-push-test",
    })
  }

  handleEvent(event: Event): void {
    if (!this.enabled) {
      return
    }

    if (event.type === "session.status" && event.properties.status.type === "busy") {
      this.busySessions.add(event.properties.sessionID)
    }

    if (event.type === "session.idle" && this.busySessions.delete(event.properties.sessionID)) {
      void this.broadcast((lang) => ({
        title: serverMessage("pushDoneTitle", lang),
        body: serverMessage("pushDoneBody", lang),
        sessionId: event.properties.sessionID,
        tag: `opencode-${event.properties.sessionID}`,
      }))
    }

    const questionAr = questionNotification(event, "ar")
    const questionEn = questionNotification(event, "en")
    if (questionAr && questionEn) {
      void this.broadcast((lang) => (lang === "en" ? questionEn : questionAr))
    }

    if (event.type === "permission.updated") {
      void this.broadcast((lang) => ({
        title: serverMessage("pushPermissionTitle", lang),
        body: event.properties.title,
        sessionId: event.properties.sessionID,
        tag: `permission-${event.properties.id}`,
      }))
    }

    if (event.type === "session.error") {
      void this.broadcast((lang) => ({
        title: serverMessage("pushErrorTitle", lang),
        body: serverMessage("pushErrorBody", lang),
        sessionId: event.properties.sessionID,
        tag: `error-${event.properties.sessionID ?? "unknown"}`,
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
