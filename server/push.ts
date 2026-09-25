import type { Event } from "@opencode-ai/sdk"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import webpush, { type PushSubscription } from "web-push"

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

function questionNotification(event: Event): PushPayload | null {
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
  const body = first && typeof first.question === "string" && first.question.trim() ? first.question.trim() : "OpenCode يسأل عن اختيار"
  return {
    title: "سؤال من OpenCode",
    body,
    sessionId: source.sessionID,
    tag: requestID ? `question-${requestID}` : `question-${source.sessionID}`,
  }
}

export class PushService {
  private readonly storagePath: string
  private readonly subscriptions = new Map<string, PushSubscription>()
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
    await this.persist()
  }

  async unregister(endpoint: string): Promise<void> {
    if (this.subscriptions.delete(endpoint)) {
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

    await this.send(value, {
      title: "OpenCode Mobile",
      body: "الإشعارات تعمل بنجاح",
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
      void this.broadcast({
        title: "انتهت المهمة",
        body: "اكتملت المهمة — افتح التطبيق لعرض النتيجة وتحميل الملفات إن وجدت",
        sessionId: event.properties.sessionID,
        tag: `opencode-${event.properties.sessionID}`,
      })
    }

    const question = questionNotification(event)
    if (question) {
      void this.broadcast(question)
    }

    if (event.type === "permission.updated") {
      void this.broadcast({
        title: "طلب إذن",
        body: event.properties.title,
        sessionId: event.properties.sessionID,
        tag: `permission-${event.properties.id}`,
      })
    }

    if (event.type === "session.error") {
      void this.broadcast({
        title: "توقفت المهمة",
        body: "حدث خطأ في OpenCode. افتح التطبيق للتفاصيل.",
        sessionId: event.properties.sessionID,
        tag: `error-${event.properties.sessionID ?? "unknown"}`,
      })
    }
  }

  private async broadcast(payload: PushPayload): Promise<void> {
    const expired: string[] = []

    await Promise.all(
      [...this.subscriptions.values()].map(async (subscription) => {
        try {
          await this.send(subscription, payload)
        } catch (error) {
          const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined
          if (statusCode === 404 || statusCode === 410) {
            expired.push(subscription.endpoint)
          } else {
            console.error("Push delivery failed", error)
          }
        }
      }),
    )

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
    }
    await writeFile(this.storagePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
  }
}
