import type { NextFunction, Request, Response } from "express"
import { setTimeout as sleep } from "node:timers/promises"
import type { OpenCodeService } from "./opencode.js"
import { consoleLang, getServerLang, serverMessage } from "./i18n.js"

const CONNECT_RETRY_MS = 5000
const BANNER_WIDTH = 58

// بانر بعرض ثابت بيتطبع مرة واحدة. الحروف والخطوط كلها ASCII عشان
// تتطبع زي ما هي على أي كونسول، من غير محارف زخرفية تبقى ؟
function logBanner(message: string): void {
  const rule = "-".repeat(BANNER_WIDTH)
  console.log("")
  console.log(rule)
  console.log(`  ${message}`)
  console.log(rule)
}

export class OpenCodeConnection {
  private ready = false
  private lastError = "Connecting to OpenCode…"
  private readonly readyListeners = new Set<() => void>()

  constructor(private readonly openCode: OpenCodeService) {}

  get isReady(): boolean {
    return this.ready
  }

  get error(): string {
    return this.lastError
  }

  // حاجات تعتمد على OpenCode بس لازم تتحرك في أول فرصة: ترقية المثبّتات
  // القديمة مثلًا.
  onReady(listener: () => void): void {
    this.readyListeners.add(listener)
  }

  unavailable(request: Request, response: Response): void {
    const lang = getServerLang(request)
    const detail = this.lastError ? ` (${this.lastError})` : ""
    response.status(503).json({
      error: "OPENCODE_UNAVAILABLE",
      message: `${serverMessage("opencodeUnavailable", lang)}${detail}`,
    })
  }

  handleError(error: unknown, response: Response, request?: Request): void {
    const message = error instanceof Error ? error.message : "Unexpected server error"
    if (!this.ready && /ECONNREFUSED|connect|fetch failed|OpenCode/i.test(message)) {
      if (request) {
        this.unavailable(request, response)
      } else {
        response.status(503).json({ error: "OPENCODE_UNAVAILABLE", message })
      }
      return
    }
    response.status(500).json({ error: "SERVER_ERROR", message })
  }

  readinessGate() {
    return (request: Request, response: Response, next: NextFunction): void => {
      const path = request.path
      if (
        path === "/health"
        || path === "/login"
        || path === "/logout"
        || path === "/config"
        || path === "/permission"
        || path === "/events"
        // المثبّتات بيانات ملف محلي — مالها صلة بـ OpenCode، فبتشتغل وهو واقع
        // (كل مساراتها: /pin و /pin/merge و /pin/forget و /pin/:id)
        || path === "/pin"
        || path.startsWith("/pin/")
        || path.startsWith("/push/")
      ) {
        next()
        return
      }
      if (!this.ready) {
        this.unavailable(request, response)
        return
      }
      next()
    }
  }

  async connectWithRetry(port: number): Promise<void> {
    while (!this.ready) {
      try {
        await this.openCode.connect()
        await this.openCode.startEvents()
        this.ready = true
        this.lastError = ""
        // بانر الاتصال. الحروف كلها من ASCII عدا "√" لأنها داخل خط
        // الكونسول: "√" موجود في خطوط الكونسول الافتراضية و"✓" بتطلع
        // علامة استفهام على كتير منها.
        logBanner("OpenCode connected √")
        for (const listener of [...this.readyListeners]) {
          try {
            listener()
          } catch {
            // متابع واحد مش لازم يوقع الباقي
          }
        }
      } catch (error) {
        this.ready = false
        this.lastError = error instanceof Error ? error.message : String(error)
        const lang = consoleLang()
        console.error(`OpenCode connect failed: ${this.lastError} — ${serverMessage("connectRetry", lang).replace("{port}", `${port}`)}`)
        if (/ENOENT|spawn/i.test(this.lastError)) {
          console.error(`  ${serverMessage("spawnHint", lang)}`)
        }
        await sleep(CONNECT_RETRY_MS)
      }
    }
  }
}
