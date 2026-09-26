import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { basename as pathBasename, extname, isAbsolute, resolve } from "node:path"
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
import { createOpencodeClient as createOpencodeV2Client } from "@opencode-ai/sdk/v2"
import type {
  Event,
  FileDiff,
  Message,
  OpencodeClient,
  Part,
  Permission,
  Project,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk"
import type { GlobalSession, OpencodeClient as OpencodeV2Client, QuestionAnswer, QuestionRequest, VcsFileStatus } from "@opencode-ai/sdk/v2"
import { setTimeout as sleep } from "node:timers/promises"
import { serverMessage, type ServerLang } from "./i18n.js"

export interface ServiceOptions {
  projectDirectory: string
  serverUrl?: string
  username: string
  password?: string
  port: number
}

interface MobileSessionFile {
  sessions: string[]
}

export interface GitChangeFile {
  path: string
  status: "added" | "deleted" | "modified"
  added: number
  removed: number
}

export interface GitChanges {
  branch: string
  available: boolean
  files: GitChangeFile[]
}

type EventListener = (event: Event) => void | Promise<void>

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; data?: { message?: unknown } }
    if (typeof candidate.data?.message === "string") {
      return candidate.data.message
    }
    if (typeof candidate.message === "string") {
      return candidate.message
    }
  }

  return "OpenCode request failed"
}

function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error) {
    throw new Error(errorMessage(result.error))
  }

  if (result.data === undefined) {
    throw new Error("OpenCode returned an empty response")
  }

  return result.data
}

function textFromParts(parts: Part[]): string {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.synthetic)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
}

function stripMobileSuffix(title: string): string {
  return title.replace(/\s*\(mobile\)\s*$/i, "").trim()
}

function isDefaultTitle(title: string | undefined | null): boolean {
  const clean = stripMobileSuffix((title || "").trim())
  if (!clean) {
    return true
  }
  const lower = clean.toLowerCase()
  return clean === "محادثة جديدة"
    || clean === "محادثة"
    || clean === "محادثة بدون عنوان"
    || lower === "new session"
    || lower === "untitled"
    || lower.startsWith("new session -")
    || lower.startsWith("new session (")
}

function titleFromUserText(text: string): string {
  const firstLine = (text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ""
  const collapsed = firstLine.replace(/\s+/g, " ").trim()
  if (!collapsed) {
    return ""
  }
  const maxLength = 60
  if (collapsed.length <= maxLength) {
    return collapsed
  }
  const sliced = collapsed.slice(0, maxLength).trimEnd()
  const lastSpace = sliced.lastIndexOf(" ")
  const cut = lastSpace > 30 ? sliced.slice(0, lastSpace) : sliced
  return `${cut}…`
}

function projectUpdatedAt(project: Project): number {
  const time = project.time as Project["time"] & { updated?: number }
  return time.updated || time.initialized || time.created
}

function directoryKey(directory: string): string {
  return directory.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
}

function isChildDirectory(directory: string, parent: string): boolean {
  const child = directoryKey(directory)
  const root = directoryKey(parent)
  return child !== root && child.startsWith(`${root}/`)
}

export interface ResultFile {
  id: string
  name: string
  mime: string
  path: string
  url: string
  downloadUrl: string
  source: "attachment" | "output"
  size?: number
}

export interface ConversationQuestionOption {
  label: string
  description: string
}

export interface ConversationQuestion {
  question: string
  header: string
  options: ConversationQuestionOption[]
  multiple: boolean
  custom: boolean
}

export interface ConversationQuestionRequest {
  id: string
  sessionID: string
  questions: ConversationQuestion[]
}

export interface HistoryTurn {
  id: string
  index: number
  prompt: string
  finalResult: string
  createdAt: number
  completedAt: number
  steps: number
  files: ResultFile[]
}

export type RequestState = "queued" | "running" | "done" | "stopped"

export interface SessionRequest {
  id: string
  index: number
  prompt: string
  state: RequestState
  activity: string
  finalResult: string
  // النص الحي للرد الجاري (يُملأ أثناء state=running فقط) — نفس رسائل
  // opencode وهي بتتكتب، قبل ما تكتمل وتبقى finalResult.
  liveText: string
  stepsCompleted: number
  activeTool: string | null
  todos: Todo[]
  completedTodos: number
  totalTodos: number
  resultFiles: ResultFile[]
  startedAt: number
  completedAt: number
  updatedAt: number
}

export interface SessionRequests {
  status: SessionStatus
  requests: SessionRequest[]
  questions: ConversationQuestionRequest[]
  queued: number
}

interface QueuedPrompt {
  id: string
  text: string
  agent?: string
  model?: SessionModelRef
  queuedAt: number
  attempts: number
}

// طابق واحد = رسالة مستخدم واحدة + الردود اللي جت بعدها.
interface RequestTurn {
  id: string
  prompt: string
  createdAt: number
  completedAt: number
  updatedAt: number
  texts: string[]
  steps: number
  entries: Array<{ info: Message; parts: Part[] }>
}

export interface ModelInfo {
  id: string
  providerID: string
  name: string
  free: boolean
  enabled: boolean
  status?: string
  // الـ variants اللي OpenCode بيسمح بيها للموديل ده (مثل high / max / low)
  variants?: string[]
}

export interface ActiveSession {
  id: string
  title: string
  directory: string
  worktree: string
  projectName: string
  status: SessionStatus
  updatedAt: number
}

export interface SessionModelRef {
  providerID: string
  modelID: string
  variant?: string
}

function isFreeCost(input: number, output: number, cacheRead: number, cacheWrite: number): boolean {
  return (input || 0) === 0 && (output || 0) === 0 && (cacheRead || 0) === 0 && (cacheWrite || 0) === 0
}

function parseModelString(value: string | undefined | null): SessionModelRef | null {
  const clean = (value || "").trim()
  if (!clean || !clean.includes("/")) {
    return null
  }
  const slash = clean.indexOf("/")
  const providerID = clean.slice(0, slash).trim()
  const modelID = clean.slice(slash + 1).trim()
  if (!providerID || !modelID) {
    return null
  }
  return { providerID, modelID }
}

const MAX_FILE_DOWNLOAD_BYTES = 25 * 1024 * 1024

// قائمة الـ variants نادرًا ما تتغير، فبنخزّنها 5 دقايق بدل ما نطلبها كل مرة
const VARIANTS_CACHE_MS = 5 * 60 * 1000

// ترتيب معروف لمستويات التفكير، عشان الكيبس تظهر بترتيب متوقع مش أبجدي
const VARIANT_ORDER = ["minimal", "none", "low", "medium", "high", "xhigh", "max"]

// OpenCode بيرجّع الـ variants بشكلين حسب الـ endpoint:
// - object map: { low: { reasoningEffort: "low" }, ... }  (من /config/providers)
// - array:       [ { id: "low", ... }, ... ]                (من كتالوج v2)
function variantIds(value: unknown): string[] | undefined {
  const ids: string[] = []
  if (Array.isArray(value)) {
    for (const entry of value) {
      const id = typeof (entry as { id?: unknown })?.id === "string" ? (entry as { id: string }).id.trim() : ""
      if (id) {
        ids.push(id)
      }
    }
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      const id = key.trim()
      if (id) {
        ids.push(id)
      }
    }
  }
  return ids.length > 0 ? [...new Set(ids)] : undefined
}

// ترتيب العرض: المستويات المعروفة أولًا بترتيبها، وبعدها أي اسم تاني أبجديًا
function sortVariants(variants: string[]): string[] {
  return [...variants].sort((a, b) => {
    const left = VARIANT_ORDER.indexOf(a)
    const right = VARIANT_ORDER.indexOf(b)
    if (left !== -1 && right !== -1) {
      return left - right
    }
    if (left !== -1) {
      return -1
    }
    if (right !== -1) {
      return 1
    }
    return a.localeCompare(b)
  })
}

// OpenCode بيقسّم المهمة الواحدة لرسائل assistant متتالية: كل خطوة/أداة
// بتقفل رسالة (completedAt يتسجل) ويفتح اللي بعدها. فـ completedAt > 0
// لوحده مش معناه إن المهمة خلصت — لازم نتأكد إن مفيش رسالة مفتوحة
// وإن آخر تحديث قديم (مفيش نشاط جديد جاي). غير كده كل خطوة هتتفهم
// "إتمام" والقائمة هتتنطط working ⇄ ready والصوت هيتكرر كل خطوة.
const STALE_BUSY_GRACE_MS = 20_000

// بعد كام محاولة فاشلة بنسقط الطلب من الطابور بدل ما نفضل نعيد تجربته
const MAX_PROMPT_ATTEMPTS = 3

// بادئة الـ id اللي بتظهر بيه الطلبات المستنية في كروت المحادثة
const QUEUED_ID_PREFIX = "queued:"

// الواجهة بتبع الـ id بالبادئة دي، فبنشيلها قبل ما نطابقه بالـ id الداخلي
function queuedItemId(requestId: string): string {
  return requestId.startsWith(QUEUED_ID_PREFIX) ? requestId.slice(QUEUED_ID_PREFIX.length) : requestId
}

const mimeByExtension: Record<string, string> = {
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

function mimeFromName(name: string, fallback = "application/octet-stream"): string {
  const extension = extname(name || "").toLowerCase()
  return mimeByExtension[extension] || fallback
}

function fileNameFromPath(path: string, fallback: string): string {
  const base = pathBasename(path.replace(/\\/g, "/")).trim()
  return base || fallback
}

export class OpenCodeService {
  private baseClient!: OpencodeClient
  private globalClient!: OpencodeV2Client
  private baseUrl = ""
  private readonly authHeaders: Record<string, string> = {}
  private readonly clients = new Map<string, OpencodeClient>()
  private selectedProjectDirectory: string
  private selectedProjectId: string | null = null
  private closeServer: (() => void) | undefined
  private readonly abortController = new AbortController()
  private readonly listeners = new Set<EventListener>()
  private readonly busySessions = new Set<string>()
  // طابور الطلبات لكل جلسة: المستخدم يقدر يبعت أكتر من طلب من غير ما يستنى،
  // والطلب اللي بعده يستنى لحد ما يخلص اللي قبله.
  private readonly promptQueues = new Map<string, QueuedPrompt[]>()
  // جلسات عندنا طلب اتبعت بالفعل ومستنيين الـ idle عشان نبعث اللي بعده
  private readonly runningSessions = new Set<string>()
  // جلسات بنوقف طلبها الشغّال دلوقتي (تخطّي): بنستخدمها عشان الـ idle اللي
  // جاي من الإيقاف ما يعيدش بناء الطابور قبل ما الإيقاف يخلص فعلًا
  private readonly skippingSessions = new Set<string>()
  // عدد مرات poll متتالية OpenCode بيقول فيها "idle" لجلسة شغّالة عندنا
  private readonly idlePolls = new Map<string, number>()
  // جessions اتأكدنا منها إن آخر ردّ خلص فعلًا (time.completed اتسجل) ومفيش
  // شغل مستني وراها. OpenCode ساعات بيفضل واقف على "busy" والـ idle بتاعه
  // يضيع، فلو كل endpoint حساب الحالة لوحده كان هيبقى في تعارض: /session/status
  // بيقول "شغّال" و /api/session/:id بيقول "خلص" ⇒ عنوان الحالة في الواجهة
  // بيتبدّل "شغّال ⇄ جاهز" كل بضع ثواني للأبد. فبنشارك الحكم ده مع الكل.
  private readonly finishedRuns = new Set<string>()
  private promptSeq = 0
  private queueWatchdog: NodeJS.Timeout | null = null
  private readonly pendingPermissions = new Map<string, Permission>()
  private readonly mobileSessions = new Set<string>()
  private readonly mobileSessionsPath = resolve(process.cwd(), "data", "mobile-sessions.json")
  private eventsStarted = false
  // كاش Variants:endpoint واحد بس وبطيء، والقائمة مش بتتغير كتير
  private variantsCache: { directory: string; expiresAt: number; map: Map<string, string[]> } | null = null

  constructor(private readonly options: ServiceOptions) {
    this.selectedProjectDirectory = options.projectDirectory
    this.loadMobileSessions()
  }

  private loadMobileSessions(): void {
    if (!existsSync(this.mobileSessionsPath)) {
      return
    }

    try {
      const data = JSON.parse(readFileSync(this.mobileSessionsPath, "utf8")) as Partial<MobileSessionFile>
      for (const id of data.sessions || []) {
        if (typeof id === "string") {
          this.mobileSessions.add(id)
        }
      }
    } catch {
      this.mobileSessions.clear()
    }
  }

  private persistMobileSessions(): void {
    mkdirSync(resolve(process.cwd(), "data"), { recursive: true, mode: 0o700 })
    const data: MobileSessionFile = { sessions: [...this.mobileSessions] }
    writeFileSync(this.mobileSessionsPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
  }

  private clientFor(directory = this.selectedProjectDirectory): OpencodeClient {
    const existing = this.clients.get(directory)
    if (existing) {
      return existing
    }

    const client = createOpencodeClient({
      baseUrl: this.baseUrl,
      directory,
      headers: this.authHeaders,
    })
    this.clients.set(directory, client)
    return client
  }

  private directoryQuery(): { directory: string } {
    return { directory: this.selectedProjectDirectory }
  }

  async connect(): Promise<void> {
    if (this.options.password) {
      const credentials = Buffer.from(`${this.options.username}:${this.options.password}`).toString("base64")
      this.authHeaders.Authorization = `Basic ${credentials}`
    }

    if (this.options.serverUrl) {
      this.baseUrl = this.options.serverUrl
    } else {
      const currentDirectory = process.cwd()
      let instance: Awaited<ReturnType<typeof createOpencode>>
      try {
        process.chdir(this.options.projectDirectory)
        instance = await createOpencode({
          hostname: "127.0.0.1",
          port: this.options.port,
          timeout: 15000,
        })
      } finally {
        process.chdir(currentDirectory)
      }
      this.baseUrl = instance.server.url
      this.closeServer = instance.server.close
    }

    this.baseClient = createOpencodeClient({
      baseUrl: this.baseUrl,
      headers: this.authHeaders,
    })
    this.globalClient = createOpencodeV2Client({
      baseUrl: this.baseUrl,
      headers: this.authHeaders,
    })
    await this.health()
  }

  async startEvents(): Promise<void> {
    if (this.eventsStarted) {
      return
    }

    this.eventsStarted = true
    this.startQueueWatchdog()
    void this.consumeEvents()
  }

  private async consumeEvents(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      try {
        const stream = await this.baseClient.event.subscribe({
          signal: this.abortController.signal,
        })

        for await (const event of stream.stream) {
          this.trackEvent(event)
          await Promise.all([...this.listeners].map((listener) => listener(event)))
        }
      } catch (error) {
        if (!this.abortController.signal.aborted) {
          console.error("OpenCode event stream disconnected", errorMessage(error))
        }
      }

      if (!this.abortController.signal.aborted) {
        await sleep(2000)
      }
    }
  }

  private trackEvent(event: Event): void {
    if (event.type === "permission.updated") {
      this.pendingPermissions.set(event.properties.id, event.properties)
    }

    if (event.type === "permission.replied") {
      this.pendingPermissions.delete(event.properties.permissionID)
    }

    if (event.type === "session.status") {
      const statusType = (event.properties as { status?: { type?: string } }).status?.type
      if (statusType === "busy" || statusType === "retry") {
        this.busySessions.add(event.properties.sessionID)
      } else if (statusType === "idle") {
        this.busySessions.delete(event.properties.sessionID)
        this.releaseSession(event.properties.sessionID)
      }
      // أي نوع حالة غير معروف (أو حدث ناقص): تجاهل — الـ poll الدوري
      // لـ /session/status هو مصدر الحقيقة الأساسي
    }

    if (event.type === "session.idle") {
      this.busySessions.delete(event.properties.sessionID)
      this.releaseSession(event.properties.sessionID)
    }

    if (event.type === "session.error") {
      // خطأ OpenCode بيقفل الشغل من غير ما يبعت idle بعدها، فبدون السطر ده
      // الجلسة هتفضل متسجّلة "شغّال" للأبد في قائمة المحادثات النشطة.
      const sessionId = event.properties.sessionID
      if (sessionId) {
        this.busySessions.delete(sessionId)
        this.releaseSession(sessionId)
      }
    }
  }

  // فيه شغل معلّق على الجلسة دي (طلب شغّال أو طلبات مستنية في الطابور)؟
  // بنستخدمها عشان نخفي حالة "idle" المؤقتة اللي بتحصل بين طلبين متتالين،
  // فالمستخدم ما يشوفش إن خلص وهو لسه فاضل طلبات وراه.
  hasPendingWork(sessionId: string): boolean {
    return this.runningSessions.has(sessionId) || (this.promptQueues.get(sessionId)?.length ?? 0) > 0
  }

  // هل آخر turn لسه فيه رسالة assistant مفتوحة (من غير completed)؟
  // طول ما فيه واحدة مفتوحة يبقى الشغل شغّال فعلًا حتى لو رسائل قبلها اتقفلت.
  private turnHasOpenAssistant(turn: RequestTurn | undefined): boolean {
    if (!turn) {
      return false
    }
    return turn.entries.some((entry) => entry.info.role === "assistant" && !entry.info.time.completed)
  }

  // جلسة مسجّلة "شغّالة" عندنا بس ردّها خلص فعلًا (OpenCode سجّل completedAt):
  // يا إما حدث الـ idle ضاع (سيرفر اتقفل / الـ SSE اتقطع) يا إما OpenCode واقف
  // على busy. في الحالتين الفلاج بتاعنا مبقاش صح، ولو فضل مسجّل كان هيخلي
  // الـ staleBusy ماتشتغلش والكارت يفضل "شغّال" للأبد. بنشيله بس لو مفيش
  // طلبات مستنية وراه، عشان الـ idle الحقيقي هو اللي يبعتهم.
  // مهم: الخطوات الوسيطة بتقفل رسالة وتفتح اللي بعدها، فـ completedAt > 0
  // مش كفاية — لازم مفيش رسالة مفتوحة وآخر تحديث قديم (عدّت مهلة الـ grace).
  private releaseFinishedRun(sessionId: string, lastTurn: RequestTurn | undefined): void {
    if (!this.runningSessions.has(sessionId) || lastTurn === undefined || lastTurn.completedAt === 0) {
      return
    }
    if ((this.promptQueues.get(sessionId)?.length ?? 0) > 0) {
      return
    }
    if (this.turnHasOpenAssistant(lastTurn)) {
      return
    }
    if (Date.now() - lastTurn.updatedAt < STALE_BUSY_GRACE_MS) {
      return
    }
    this.runningSessions.delete(sessionId)
  }

  private effectiveStatus(sessionId: string, status: SessionStatus): SessionStatus {
    if (status.type === "idle" && this.hasPendingWork(sessionId)) {
      return { type: "busy" }
    }
    // نفس حكم requests(): آخر ردّ خلص فعلًا ومفيش شغل مستني وراه ⇒ الجلسة
    // جاهزة، حتى لو OpenCode لسه واقف على "busy" والـ idle بتاعه ضاع. من غير
    // السطر ده الـ /session/status بيخالف /api/session/:id، والواجهة بتخطف
    // "شغّال ⇄ جاهز" (وكمان بتكرّر صوت الإتمام) كل بضع ثواني.
    if (
      (status.type === "busy" || status.type === "retry")
      && !this.hasPendingWork(sessionId)
      && this.finishedRuns.has(sessionId)
    ) {
      return { type: "idle" }
    }
    return status
  }

  // الجلسة خلصت: ابعت الطلب اللي مستني في الطابور (لو فيه).
  private releaseSession(sessionId: string): void {
    this.runningSessions.delete(sessionId)
    if (this.skippingSessions.has(sessionId)) {
      // تخطّي شغّال: الـ idle ده بتاع الطلب القديم، والـ skip نفسه هيبني
      // الطابور تاني لما الإيقاف يخلص.
      return
    }
    this.pumpQueue(sessionId)
  }

  // بعت عنصر واحد بس من الطابور، وبعديه بنستنى الـ idle عشان اللي بعده.
  // القرار كله متزامن (من غير await) عشان حدثين idle متتاليين ما يبقاش
  // واحد فيهم مستني التاني. بيرجع true لو العنصر اتبعت فعلًا.
  private pumpQueue(sessionId: string): boolean {
    if (this.runningSessions.has(sessionId)) {
      return false
    }
    const queue = this.promptQueues.get(sessionId)
    if (!queue || queue.length === 0) {
      this.promptQueues.delete(sessionId)
      return false
    }
    const next = queue.shift()
    if (!next) {
      this.promptQueues.delete(sessionId)
      return false
    }

    this.runningSessions.add(sessionId)
    // طلب جديد اتبعت فعلًا ⇒ حكم "آخر ردّ خلص" القديم بقى ملغي
    this.finishedRuns.delete(sessionId)
    void this.dispatchPrompt(sessionId, next).catch((error: unknown) => {
      // الطلب مانعتش — سيبه للـ watchdog يجرب تاني أو يشيله نهائيًا
      this.runningSessions.delete(sessionId)
      next.attempts += 1
      console.error("Unable to send the queued prompt", errorMessage(error))
      const pending = this.promptQueues.get(sessionId)
      if (next.attempts >= MAX_PROMPT_ATTEMPTS) {
        console.error("Dropping the queued prompt after repeated failures", next.id)
        return
      }
      pending?.unshift(next)
    })
    return true
  }

  // Safety net: when the SSE drops and the queue stalls, poll the statuses and
  // release the prompts that stalled without anyone sending them.
  private startQueueWatchdog(): void {
    if (this.queueWatchdog) {
      return
    }
    this.queueWatchdog = setInterval(() => {
      if (this.promptQueues.size === 0 && this.runningSessions.size === 0) {
        return
      }
      void this.rawStatuses().then((statuses) => {
        for (const sessionId of [...this.promptQueues.keys()]) {
          const status = statuses[sessionId]
          if (status && status.type === "idle") {
            this.busySessions.delete(sessionId)
            this.releaseSession(sessionId)
          }
        }
        // جلسة مسجّلة "شغّالة" عندنا والطابور بتاعها فاضي، بس OpenCode بيقولها
        // idle: يعني حدث الـ idle بتاعها ضاع (السيرفر اتقفل أو الـ SSE اتقطع).
        // من غير السطور دي كانت هتفضل "شغّال" للأبد وكارت الطلب ميفصلش عنها.
        for (const sessionId of [...this.runningSessions]) {
          const status = statuses[sessionId]
          const queued = (this.promptQueues.get(sessionId)?.length ?? 0) > 0
          if (!status || status.type !== "idle" || queued) {
            this.idlePolls.delete(sessionId)
            continue
          }
          // تأكيد مرّتين: طلب لسه بيلفّ حالته لـ busy مينفعش يتحرّك من أول poll
          const seen = (this.idlePolls.get(sessionId) ?? 0) + 1
          this.idlePolls.set(sessionId, seen)
          if (seen < 2) {
            continue
          }
          this.idlePolls.delete(sessionId)
          this.busySessions.delete(sessionId)
          this.releaseSession(sessionId)
        }
      }).catch(() => undefined)
    }, 5000)
    this.queueWatchdog.unref?.()
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async health(): Promise<{ healthy: boolean; version: string }> {
    await unwrap(await this.baseClient.project.current())
    return { healthy: true, version: "connected" }
  }

  async projects(): Promise<Project[]> {
    const registered = unwrap(await this.baseClient.project.list({ query: { directory: this.options.projectDirectory } }))
    const sessions = await this.globalClient.experimental.session
      .list({ roots: true, limit: 1000 })
      .then(unwrap)
      .catch(() => [] as GlobalSession[])
    const sessionDirectories = new Set(
      sessions
        .map((session) => session.directory)
        .filter((directory) => directory && isChildDirectory(directory, this.options.projectDirectory)),
    )
    const projectsByDirectory = new Map<string, Project>()
    const hasScopedSessions = sessionDirectories.size > 0

    for (const project of registered) {
      const key = directoryKey(project.worktree)
      if (project.worktree !== "/" && isChildDirectory(project.worktree, this.options.projectDirectory) && (!hasScopedSessions || sessionDirectories.has(key))) {
        projectsByDirectory.set(key, project)
      }
    }

    for (const session of sessions) {
      if (!session.directory || !isChildDirectory(session.directory, this.options.projectDirectory)) {
        continue
      }
      const key = directoryKey(session.directory)
      if (projectsByDirectory.has(key)) {
        continue
      }
      const project = session.project
      const hasProject = Boolean(project && project.worktree !== "/")
      projectsByDirectory.set(key, {
        id: hasProject ? project!.id : session.directory,
        worktree: session.directory,
        ...(hasProject && project!.name ? { name: project!.name } : {}),
        time: {
          created: session.time.created,
        },
      })
    }

    return [...projectsByDirectory.values()].sort((left, right) => projectUpdatedAt(right) - projectUpdatedAt(left))
  }

  async selectedProject(): Promise<Project | null> {
    if (!this.selectedProjectId && this.selectedProjectDirectory === this.options.projectDirectory) {
      return null
    }
    const projects = await this.projects()
    return projects.find((project) => directoryKey(project.worktree) === directoryKey(this.selectedProjectDirectory))
      || projects.find((project) => project.id === this.selectedProjectId)
      || null
  }

  async selectProject(worktree: string): Promise<Project> {
    const projects = await this.projects()
    const normalizedWorktree = directoryKey(worktree)
    const project = projects.find((item) => directoryKey(item.worktree) === normalizedWorktree)
      || projects.find((item) => item.id === worktree)
    if (!project || project.worktree === "/") {
      throw new Error("Project not found")
    }

    await unwrap(await this.clientFor(project.worktree).project.current({ query: { directory: project.worktree } }))
    this.selectedProjectId = project.id
    this.selectedProjectDirectory = project.worktree
    return project
  }

  async sessions(): Promise<Session[]> {
    return unwrap(await this.clientFor().session.list({ query: this.directoryQuery() }))
  }

  async createSession(title?: string, mobile = false): Promise<Session> {
    // Create without a custom title when the title is empty/default so that
    // OpenCode's native auto-title (based on the first message) can run,
    // just like on desktop. A custom title would make native generation skip.
    const cleanTitle = stripMobileSuffix((title || "").trim())
    const useTitle = cleanTitle && !isDefaultTitle(cleanTitle) ? cleanTitle : undefined
    const session = unwrap(await this.clientFor().session.create({
      body: useTitle ? { title: useTitle } : {},
      query: this.directoryQuery(),
    }))

    if (!mobile) {
      return session
    }

    this.mobileSessions.add(session.id)
    this.persistMobileSessions()
    return session
  }

  async updateSession(id: string, title: string, lang: ServerLang = "ar"): Promise<Session> {
    const nextTitle = stripMobileSuffix(title.trim()).slice(0, 120) || serverMessage("newConversation", lang)
    return unwrap(await this.clientFor().session.update({
      path: { id },
      body: { title: nextTitle },
      query: this.directoryQuery(),
    }))
  }

  async deleteSession(id: string): Promise<boolean> {
    this.mobileSessions.delete(id)
    this.promptQueues.delete(id)
    this.runningSessions.delete(id)
    this.persistMobileSessions()
    return unwrap(await this.clientFor().session.delete({ path: { id }, query: this.directoryQuery() }))
  }

  async messages(id: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    return unwrap(await this.clientFor().session.messages({
      path: { id },
      query: { ...this.directoryQuery(), limit: 200 },
    }))
  }

  // تقسيم رسائل الجلسة إلى "طوابق": كل رسالة مستخدم بتبدأ طابق،
  // والردود اللي بعدها بتاعتها. الترتيب زمني من الأقدم للأحدث.
  private turns(messages: Array<{ info: Message; parts: Part[] }>): RequestTurn[] {
    const sorted = [...messages].sort((a, b) => a.info.time.created - b.info.time.created)
    const turns: RequestTurn[] = []
    let current: RequestTurn | null = null

    for (const entry of sorted) {
      if (entry.info.role === "user") {
        if (current) {
          turns.push(current)
        }
        const prompt = textFromParts(entry.parts)
        if (!prompt && entry.parts.length === 0) {
          current = null
          continue
        }
        current = {
          id: entry.info.id,
          prompt,
          createdAt: entry.info.time.created,
          completedAt: 0,
          updatedAt: entry.info.time.created,
          texts: [],
          steps: 0,
          entries: [],
        }
        continue
      }

      if (entry.info.role !== "assistant" || !current) {
        continue
      }
      const text = textFromParts(entry.parts)
      if (text) {
        current.texts.push(text)
      }
      for (const part of entry.parts) {
        if (part.type === "tool" && part.state.status === "completed") {
          current.steps += 1
        }
      }
      current.entries.push(entry)
      current.updatedAt = Math.max(current.updatedAt, entry.info.time.created, entry.info.time.completed ?? 0)
      if (entry.info.time.completed) {
        current.completedAt = Math.max(current.completedAt, entry.info.time.completed)
      }
    }
    if (current) {
      turns.push(current)
    }

    return turns
  }

  async history(id: string, lang: ServerLang = "ar"): Promise<HistoryTurn[]> {
    const turns = this.turns(await this.messages(id))

    const withIndex = turns.map((turn, position) => ({
      id: turn.id || `turn-${position + 1}`,
      index: position + 1,
      prompt: turn.prompt,
      finalResult: turn.texts.join("\n\n"),
      createdAt: turn.createdAt,
      completedAt: turn.completedAt || turn.createdAt,
      steps: turn.steps,
      files: this.collectResultFiles(id, turn.entries, lang),
    }))

    // الأحدث أولًا عشان مراجعة النتائج القديمة تبقى أسهل
    return withIndex.reverse()
  }

  // كارت لكل طلب في المحادثة: القديم فوق والأحدث تحت، وآخر كارت هو
  // الطلب الشغّال دلوقتي وبعديه الطلبات اللي مستنية في الطابور.
  async requests(id: string, lang: ServerLang = "ar"): Promise<SessionRequests> {
    const [rawStatuses, messages, todos, questions] = await Promise.all([
      this.rawStatuses(),
      this.messages(id),
      this.todos(id),
      this.sessionQuestions(id),
    ])
    const turns = this.turns(messages)
    const lastTurn = turns[turns.length - 1]
    const rawStatus = rawStatuses[id] || { type: "idle" }
    // لو ردّنا الأخير خلص فعلًا مش لازم فضل محسوبين "شغّالين": الـ idle ضاع أو
    // OpenCode واقف على busy. من غير السطر ده الـ staleBusy تحت ماتشتغلش.
    this.releaseFinishedRun(id, lastTurn)
    // حالة OpenCode أحيانًا بتتأخر، والحدث اللي بيقول "خلص" ممكن يضيع خالص
    // لو الـ SSE اتقطع (انقطاع شبكة، قفل شاشة، ريزارت للسيرفر). فبنقيسها على
    // حقيقة أقوى من الحدث: هل آخر طلب خلص فعلًا؟ لو الرد الأخير اتقفل
    // (completedAt اتسجل) يبقى الطلب خلص مهما OpenCode لسه بيقول "شغّال"،
    // غير لو في طلبات مستنية في الطابور فالساعتها الشغل لسه بيكمل فعلًا.
    // مهم: الخطوة الوسيطة بتقفل رسالة assistant واحدة وبتفتح اللي بعدها فورًا،
    // فـ completedAt > 0 لوحده كان بيخلي كل خطوة تتفهم "خلص" والقائمة تتنطط
    // والصوت يتكرر. لازم ٣ شروط مع بعض: مفيش رسالة مفتوحة + آخر تحديث قديم
    // (عدّت مهلة الـ grace) + مفيش شغل مستني في الطابور.
    const hasOpenAssistant = this.turnHasOpenAssistant(lastTurn)
    const lastUpdateOld = lastTurn !== undefined && Date.now() - lastTurn.updatedAt >= STALE_BUSY_GRACE_MS
    const pendingWork = this.hasPendingWork(id)
    const trulyFinished = lastTurn !== undefined
      && lastTurn.completedAt > 0
      && !hasOpenAssistant
      && lastUpdateOld
      && !pendingWork
    const staleBusy = (rawStatus.type === "busy" || rawStatus.type === "retry") && trulyFinished
    // خلاصة "الرد الأخير خلص فعلًا" دي محفوظة في السيرفر عشان /session/status
    // يعرض نفس الحكم. من غير التسجيل ده كان كل endpoint بيحسب لوحده فبيتقولوا
    // حاجات متضاربة، والواجهة بتتبدّل "شغّال ⇄ جاهز" وتكرّر صوت الإتمام.
    // وبنمسحها مع أي نشاط جديد (رسالة مفتوحة/تحديث حديث/شغل مستني) عشان
    // حكم "خلص" القديم مايلزقش والمهمة الجديدة تتفهم غلط.
    if (trulyFinished) {
      this.finishedRuns.add(id)
    } else {
      this.finishedRuns.delete(id)
    }
    const status = this.effectiveStatus(id, staleBusy ? { type: "idle" } : rawStatus)
    const busy = status.type === "busy" || status.type === "retry"
    const runningIndex = busy ? turns.length - 1 : -1
    const activeTodo = todos.find((todo) => todo.status === "in_progress")
    const completedTodos = todos.filter((todo) => todo.status === "completed").length

    const requests: SessionRequest[] = turns.map((turn, index) => {
      const running = index === runningIndex
      const reversed = [...turn.entries].reverse()
      const currentAssistant = reversed.find((entry) => entry.info.role === "assistant")
      const completedAssistant = reversed.find((entry) => entry.info.role === "assistant" && Boolean(entry.info.time.completed))
      const activeTool = currentAssistant?.parts.find((part): part is Extract<Part, { type: "tool" }> =>
        part.type === "tool" && (part.state.status === "running" || part.state.status === "pending"))

      let activity = serverMessage("taskReady", lang)
      if (running) {
        if (status.type === "retry") {
          activity = serverMessage("retryingNow", lang)
        } else if (activeTool) {
          activity = activeTool.state.status === "running" && "title" in activeTool.state && activeTool.state.title
            ? activeTool.state.title
            : `${serverMessage("usesTool", lang)} ${activeTool.tool}`
        } else if (activeTodo) {
          activity = activeTodo.content
        } else {
          activity = serverMessage("workingOnTask", lang)
        }
      }

      // طلب اتوقف في نصه (إيدوي أو خطأ): مقدّم رسائل بس مفيش ولا رد مكتمل
      const state: RequestState = running
        ? "running"
        : turn.completedAt === 0 && turn.entries.length > 0
          ? "stopped"
          : "done"
      // النص الحي: كل نصوص الـ assistant في الـ turn ده لحد دلوقتي، بما فيها
      // الرسالة المفتوحة اللي لسه بتتكتب. ده اللي بيخلي المستخدم يشوف رد
      // opencode وهو شغال بدل ما يستنى finalResult بعد الاكتمال.
      const liveText = running ? turn.texts.join("\n\n").trim() : ""

      return {
        id: turn.id || `turn-${index + 1}`,
        index: index + 1,
        prompt: turn.prompt,
        state,
        activity,
        finalResult: completedAssistant ? textFromParts(completedAssistant.parts) : "",
        liveText,
        stepsCompleted: turn.steps,
        activeTool: activeTool?.tool ?? null,
        // خطة الـ todos بتاعة الشغل الشغّال دلوقتي بس
        todos: running ? todos : [],
        completedTodos: running ? completedTodos : 0,
        totalTodos: running ? todos.length : 0,
        resultFiles: this.collectResultFiles(id, turn.entries, lang),
        startedAt: turn.createdAt,
        completedAt: turn.completedAt,
        updatedAt: turn.updatedAt,
      }
    })

    const queue = this.promptQueues.get(id) ?? []
    for (const [offset, item] of queue.entries()) {
      requests.push({
        id: `${QUEUED_ID_PREFIX}${item.id}`,
        index: turns.length + offset + 1,
        prompt: item.text,
        state: "queued",
        activity: serverMessage("queuedWaiting", lang),
        finalResult: "",
        liveText: "",
        stepsCompleted: 0,
        activeTool: null,
        todos: [],
        completedTodos: 0,
        totalTodos: 0,
        resultFiles: [],
        startedAt: item.queuedAt,
        completedAt: 0,
        updatedAt: item.queuedAt,
      })
    }

    return { status, requests, questions, queued: queue.length }
  }

  private collectResultFiles(
    sessionId: string,
    messages: Array<{ info: Message; parts: Part[] }>,
    lang: ServerLang = "ar",
  ): ResultFile[] {
    const files = new Map<string, ResultFile>()
    const fileFallback = serverMessage("fileFallback", lang)

    const pushFile = (entry: {
      id: string
      name: string
      mime: string
      path: string
      url: string
      source: ResultFile["source"]
    }): void => {
      const key = entry.path ? `path:${entry.path.toLowerCase()}` : `url:${entry.url}`
      if (!entry.path && !entry.url) {
        return
      }
      if (files.has(key)) {
        return
      }
      const downloadUrl = entry.path
        ? `/api/session/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(entry.path)}`
        : entry.url
      files.set(key, {
        id: entry.id,
        name: entry.name || fileFallback,
        mime: entry.mime || mimeFromName(entry.name),
        path: entry.path,
        url: entry.url,
        downloadUrl,
        source: entry.source,
      })
    }

    for (const entry of messages) {
      if (entry.info.role !== "assistant") {
        continue
      }
      for (const part of entry.parts) {
        if (part.type === "file") {
          const sourcePath = part.source && "path" in part.source && typeof part.source.path === "string"
            ? part.source.path
            : ""
          const name = part.filename || (sourcePath ? fileNameFromPath(sourcePath, fileFallback) : fileNameFromPath(part.url || "", fileFallback))
          pushFile({
            id: part.id,
            name,
            mime: part.mime || mimeFromName(name),
            path: sourcePath,
            url: part.url || "",
            source: "attachment",
          })
        }

        if (part.type === "tool" && part.state.status === "completed" && Array.isArray(part.state.attachments)) {
          for (const attachment of part.state.attachments) {
            const sourcePath = attachment.source && "path" in attachment.source && typeof attachment.source.path === "string"
              ? attachment.source.path
              : ""
            const name = attachment.filename
              || (sourcePath ? fileNameFromPath(sourcePath, fileFallback) : fileNameFromPath(attachment.url || "", fileFallback))
            pushFile({
              id: attachment.id,
              name,
              mime: attachment.mime || mimeFromName(name),
              path: sourcePath,
              url: attachment.url || "",
              source: "attachment",
            })
          }
        }

        if (part.type === "patch" && Array.isArray(part.files)) {
          for (const filePath of part.files) {
            if (typeof filePath !== "string" || !filePath.trim()) {
              continue
            }
            const name = fileNameFromPath(filePath, fileFallback)
            pushFile({
              id: `${part.id}:${filePath}`,
              name,
              mime: mimeFromName(name),
              path: filePath,
              url: "",
              source: "output",
            })
          }
        }
      }
    }

    return [...files.values()].slice(-20)
  }

  private async sessionDirectory(sessionId: string): Promise<string> {
    try {
      const sessions = await this.sessions()
      const match = sessions.find((session) => session.id === sessionId)
      if (match?.directory) {
        return match.directory
      }
    } catch {
      // Fall back to the selected project below.
    }
    return this.selectedProjectDirectory
  }

  async readResultFile(sessionId: string, requestedPath: string): Promise<{ filename: string; mime: string; size: number; content: Buffer }> {
    const trimmed = (requestedPath || "").trim()
    if (!trimmed || trimmed.length > 1024) {
      throw new Error("Invalid file path")
    }

    const sessionDir = await this.sessionDirectory(sessionId)
    const absolutePath = isAbsolute(trimmed) ? resolve(trimmed) : resolve(sessionDir, trimmed)
    const workspaceRoot = resolve(this.options.projectDirectory)
    const relativeToRoot = absolutePath.toLowerCase().startsWith(workspaceRoot.toLowerCase())
      ? absolutePath
      : null
    if (!relativeToRoot) {
      throw new Error("File is outside the workspace")
    }

    let fileStat
    try {
      fileStat = await stat(absolutePath)
    } catch {
      throw new Error("File not found")
    }
    if (!fileStat.isFile()) {
      throw new Error("Path is not a file")
    }
    if (fileStat.size > MAX_FILE_DOWNLOAD_BYTES || fileStat.size <= 0) {
      throw new Error(fileStat.size <= 0 ? "File is empty" : "File is too large for mobile download")
    }

    try {
      const { readFile } = await import("node:fs/promises")
      const content = await readFile(absolutePath)
      const filename = pathBasename(absolutePath)
      return { filename, mime: mimeFromName(filename), size: content.length, content }
    } catch {
      throw new Error("Unable to read file")
    }
  }

  // المستخدم يقدر يبعت كذا طلب ورا بعض من غير ما يستنى. لو الجلسة شغالة
  // الطلب بيروح في طابور specific للجلسة، ولو هي فاضية بيتنفذ على طول.
  async prompt(id: string, text: string, agent?: string, model?: SessionModelRef): Promise<{ queued: boolean }> {
    const item: QueuedPrompt = {
      id: `q${++this.promptSeq}`,
      text,
      ...(agent ? { agent } : {}),
      ...(model?.providerID && model?.modelID ? { model } : {}),
      queuedAt: Date.now(),
      attempts: 0,
    }
    const wasBusy = this.hasPendingWork(id) || this.busySessions.has(id)
    const queue = this.promptQueues.get(id) ?? []
    queue.push(item)
    this.promptQueues.set(id, queue)
    if (wasBusy) {
      return { queued: true }
    }
    return { queued: !this.pumpQueue(id) }
  }

  private async dispatchPrompt(id: string, item: QueuedPrompt): Promise<void> {
    const result = await this.clientFor().session.promptAsync({
      path: { id },
      body: {
        parts: [{ type: "text", text: item.text }],
        ...(item.agent ? { agent: item.agent } : {}),
        ...(item.model?.providerID && item.model?.modelID
          ? {
            model: {
              providerID: item.model.providerID,
              modelID: item.model.modelID,
              ...(item.model.variant ? { variant: item.model.variant } : {}),
            } as { providerID: string; modelID: string },
          }
          : {}),
      },
      query: this.directoryQuery(),
    })

    if (result.error) {
      throw new Error(errorMessage(result.error))
    }

    // Fallback auto-title like desktop: if the session still has a default
    // title after the first question, name it based on the message content.
    // Sessions created without a title let OpenCode's native generator run;
    // this covers servers where native generation is disabled/missing.
    void this.autoTitleFromFirstMessage(id, item.text).catch((error) => {
      console.error("Unable to auto-name mobile session", errorMessage(error))
    })
  }

  private async autoTitleFromFirstMessage(sessionId: string, text: string): Promise<void> {
    const fallback = titleFromUserText(text)
    if (!fallback) {
      return
    }

    let currentTitle = ""
    let sessionDirectory = this.selectedProjectDirectory
    try {
      const sessions = await this.sessions()
      const match = sessions.find((session) => session.id === sessionId)
      if (!match) {
        return
      }
      currentTitle = match.title || ""
      if (match.directory) {
        sessionDirectory = match.directory
      }
    } catch {
      return
    }

    if (!isDefaultTitle(currentTitle)) {
      return
    }

    // Double-check there are no previous user messages (only title the
    // session based on the very first question).
    try {
      const history = await this.messages(sessionId)
      const userCount = history.filter((entry) => entry.info.role === "user").length
      if (userCount > 1) {
        return
      }
    } catch {
      // If history is unavailable, still apply the fallback title.
    }

    await unwrap(await this.clientFor(sessionDirectory).session.update({
      path: { id: sessionId },
      body: { title: fallback },
      query: { directory: sessionDirectory },
    }))
  }

  // الإيقاف اليدوي بيوقف الطلب الشغّال وبيشيل كل الطلبات اللي مستنية في الطابور.
  async abort(id: string): Promise<{ aborted: boolean; cleared: number }> {
    const cleared = this.promptQueues.get(id)?.length ?? 0
    this.promptQueues.delete(id)
    this.runningSessions.delete(id)
    this.skippingSessions.delete(id)
    const aborted = unwrap(await this.clientFor().session.abort({ path: { id }, query: this.directoryQuery() }))
    return { aborted, cleared }
  }

  // تخطّي الطلب الشغّال: بيوقفه بس وبيسيب باقي الطابور يكمل عادي، يعني
  // مختلف عن الإيقاف اليدوي اللي بيشيل الطابور كله.
  async skip(id: string): Promise<{ skipped: boolean; remaining: number }> {
    if (!this.runningSessions.has(id)) {
      return { skipped: false, remaining: this.promptQueues.get(id)?.length ?? 0 }
    }

    this.runningSessions.delete(id)
    this.skippingSessions.add(id)
    let skipped = false
    try {
      skipped = unwrap(await this.clientFor().session.abort({ path: { id }, query: this.directoryQuery() }))
    } finally {
      this.skippingSessions.delete(id)
      this.pumpQueue(id)
    }
    // بعد ما الطلب اللي بعده اتبعث، فـ remaining بتعد اللي فاضل في الطابور فعلًا
    return { skipped, remaining: this.promptQueues.get(id)?.length ?? 0 }
  }

  // حذف طلب واحد من الطابور من غير ما نوقف اللي شغّال. الواجهة بتبعته
  // بالشكل "queued:q1" فبنشيل البادئة قبل المقارنة.
  removeQueued(id: string, requestId: string): { removed: boolean; remaining: number } {
    const queue = this.promptQueues.get(id)
    const target = queuedItemId(requestId)
    if (!queue || queue.length === 0) {
      return { removed: false, remaining: 0 }
    }

    const index = queue.findIndex((item) => item.id === target)
    if (index < 0) {
      return { removed: false, remaining: queue.length }
    }

    queue.splice(index, 1)
    if (queue.length === 0) {
      this.promptQueues.delete(id)
    }
    return { removed: true, remaining: queue.length }
  }

  // تنفيذ طلب مستني حالًا بدل ما يستنى: بنوقّف الطلب الشغّال دلوقتي وبنبعث
  // المطلوب ده هو اللي بعده، فبيسبق أي طلب تاني مستني.
  async runQueued(id: string, requestId: string): Promise<{ started: boolean; remaining: number }> {
    const queue = this.promptQueues.get(id)
    const target = queuedItemId(requestId)
    const index = queue ? queue.findIndex((item) => item.id === target) : -1
    const item = index < 0 ? undefined : queue?.splice(index, 1)[0]
    if (!queue || !item) {
      return { started: false, remaining: queue?.length ?? 0 }
    }

    // هنقله أول الطابور عشان هو ده اللي يتنفذ أول ما الطلب الشغّال يتوقّف
    queue.unshift(item)
    this.promptQueues.set(id, queue)
    const left = (): number => this.promptQueues.get(id)?.length ?? 0

    if (!this.runningSessions.has(id)) {
      // مفيش حاجة شغّالة — الطابور واقف أصلًا فبنبعثه على طول
      this.pumpQueue(id)
      return { started: true, remaining: left() }
    }

    // فيه طلب شغّال: نوقّفه ونخلي المطلوب ده هو اللي يكمّل بدل اللي بعده.
    // الـ skippingSessions بيمنع الـ idle القديم من إنهاء الطابور مرّتين.
    this.runningSessions.delete(id)
    this.skippingSessions.add(id)
    let started = false
    try {
      unwrap(await this.clientFor().session.abort({ path: { id }, query: this.directoryQuery() }))
    } finally {
      this.skippingSessions.delete(id)
      started = this.pumpQueue(id)
    }
    return { started, remaining: left() }
  }

  async statuses(): Promise<Record<string, SessionStatus>> {
    const statuses = await this.rawStatuses()
    for (const [sessionId, status] of Object.entries(statuses)) {
      statuses[sessionId] = this.effectiveStatus(sessionId, status)
    }
    return statuses
  }

  // الحالة الخام من OpenCode من غير تعديل الطابور — الـ watchdog محتاجها عشان
  // يفرّق بين "خلص فعلًا" و"خلص مؤقتًا وعندنا طلبات مستنية".
  private async rawStatuses(): Promise<Record<string, SessionStatus>> {
    return unwrap(await this.clientFor().session.status({ query: this.directoryQuery() }))
  }

  // المحادثات الشغالة حاليًا في كل المشاريع — عشان تظهر قدام المستخدم
  // من غير ما يفتح قائمة المشاريع ويدوّر بنفسه
  async activity(lang: ServerLang = "ar"): Promise<ActiveSession[]> {
    const sessions = await this.globalClient.experimental.session
      .list({ roots: true, limit: 1000 })
      .then(unwrap)
      .catch(() => [] as GlobalSession[])

    const relevant = sessions.filter(
      (session) => session.directory && isChildDirectory(session.directory, this.options.projectDirectory),
    )
    if (relevant.length === 0) {
      return []
    }

    // حالات الجلسات scoped حسب الـ directory في OpenCode — لازم نسأل كل
    // directory لوحده وندمج النتايج، وإلا /session/status بدون directory
    // بيرجع فاضي والمحادثات النشطة مش بتظهر في أي حتة.
    const directories = [...new Set(relevant.map((session) => session.directory as string))].slice(0, 30)
    const settled = await Promise.allSettled(
      directories.map(async (directory) => ({
        directory,
        values: unwrap(await this.clientFor(directory).session.status({ query: { directory } })),
      })),
    )
    const statuses: Record<string, SessionStatus> = {}
    // الـ directories اللي نجحنا نسألها فعلًا — غيرها سيبنا سجلّ الـ events هي
    // المصدر الوحيد اللي متاح، فما ننضبطش عليه.
    const polled = new Set<string>()
    for (const entry of settled) {
      if (entry.status === "fulfilled" && entry.value) {
        Object.assign(statuses, entry.value.values)
        polled.add(entry.value.directory)
      }
    }
    // احتياطي أخير: حالة السيرفر الافتراضية (قد تنفع لمشروع واحد)
    if (Object.keys(statuses).length === 0) {
      try {
        const fallback = unwrap(await this.baseClient.session.status())
        Object.assign(statuses, fallback)
      } catch {
        // تجاهل — busySessions من الـ event stream يكفي كمصدر احتياطي
      }
    }

    // This poll is the source of truth, so use it to reconcile busySessions: when
    // the event stream loses the idle event (dropped stream, locked screen), those
    // sessions stay flagged working in every project forever. Sessions in a directory
    // we could not poll are left alone: the event log is all we have for them.
    for (const session of relevant) {
      if (!polled.has(session.directory as string)) {
        continue
      }
      const status = statuses[session.id]
      if (status?.type !== "busy" && status?.type !== "retry") {
        this.busySessions.delete(session.id)
      }
    }

    const items: ActiveSession[] = []
    for (const session of relevant) {
      const raw = statuses[session.id]
      // نفس حكم /session/status: آخر ردّ خلص فعلًا = جاهزة، حتى لو OpenCode
      // واقف على busy والـ idle ضاع
      const status = raw ? this.effectiveStatus(session.id, raw) : undefined
      // الـ event stream كمصدر احتياطي: لو حالة الجلسة مش متاحة لسبب ما
      // لكن شفناها شغالة من الأحداث المباشرة
      const busy = raw
        ? status?.type === "busy" || status?.type === "retry"
        : this.busySessions.has(session.id)
      if (!busy) {
        continue
      }
      const projectWorktree = session.project && session.project.worktree !== "/"
        ? session.project.worktree
        : session.directory
      // أحيانًا project.worktree بيكون قديم/مختلف عن مكان الجلسة الحقيقي —
      // اعتمد session.directory لما الجلسة مش جواه، عشان زرار الانتقال
      // يفتح المشروع الصح بدل ما يوديك مشروع غلط.
      const sessionDir = session.directory as string
      const insideProject = directoryKey(sessionDir) === directoryKey(projectWorktree)
        || isChildDirectory(sessionDir, projectWorktree)
      const worktree = insideProject ? projectWorktree : sessionDir
      const normalized = worktree.replace(/[\\/]+$/, "")
      const projectName = normalized.split(/[\\/]/).filter(Boolean).pop() || worktree
      items.push({
        id: session.id,
        title: stripMobileSuffix(session.title) || serverMessage("newConversation", lang),
        directory: session.directory,
        worktree,
        projectName,
        status: status || { type: "busy" },
        updatedAt: session.time.updated,
      })
    }
    return items.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async todos(id: string): Promise<Todo[]> {
    return unwrap(await this.clientFor().session.todo({ path: { id }, query: this.directoryQuery() }))
  }

  // خريطة variants لكل موديل — بتجيبها من كتالوج v2 كـ fallback بس
  private async modelVariants(): Promise<Map<string, string[]>> {
    const directory = this.selectedProjectDirectory
    const cached = this.variantsCache
    if (cached && cached.directory === directory && cached.expiresAt > Date.now()) {
      return cached.map
    }
    const map = new Map<string, string[]>()
    try {
      const response = unwrap(await this.globalClient.v2.model.list({ location: { directory } }))
      const list = Array.isArray(response) ? response : response?.data
      if (Array.isArray(list)) {
        for (const model of list) {
          const ids = variantIds(model.variants)
          if (ids) {
            map.set(`${model.providerID}/${model.id}`, ids)
          }
        }
      }
      this.variantsCache = { directory, expiresAt: Date.now() + VARIANTS_CACHE_MS, map }
    } catch (error) {
      console.error("v2 model variants failed", errorMessage(error))
    }
    return map
  }

  async models(): Promise<ModelInfo[]> {
    const variantMap = await this.modelVariants()
    // OpenCode بيرجّع الـ variants بشكلين: object map في /config/providers
    // ({ low: {...}, high: {...} }) و array في الكتالوج v2 ([{ id, ... }]).
    // هنقبل الاتنين ونرتّبهم بترتيب معروف (من الأقل للأعلى) عشان العرض يبقى ثابت.
    const withVariants = (infos: ModelInfo[]): ModelInfo[] => infos.map((info) => {
      const fromProvider = info.variants && info.variants.length > 0 ? info.variants : variantMap.get(`${info.providerID}/${info.id}`)
      const variants = fromProvider && fromProvider.length > 0 ? sortVariants(fromProvider) : undefined
      return variants ? { ...info, variants } : info
    })

    // المصدر الأساسي: settings opencode (/config/providers) — الموديلات المسموحة فعلًا
    // عند المستخدم ده provider واحد (opencode) فيه ~8 موديلات مجانية، مش كتالوج models.dev الكامل.
    try {
      const providersResponse = unwrap(await this.globalClient.config.providers({ directory: this.selectedProjectDirectory }))
      const providers = providersResponse?.providers || []
      const infos: ModelInfo[] = []
      for (const provider of providers) {
        for (const [modelId, model] of Object.entries(provider.models || {})) {
          const cost = model?.cost
          const free = Boolean(cost) && isFreeCost(cost.input, cost.output, cost.cache?.read, cost.cache?.write)
          infos.push({
            id: modelId,
            providerID: provider.id,
            name: model?.name || modelId,
            free,
            enabled: true,
            status: model?.status,
            // هنا الـ variants موجودة فعلًا كـ object map: { low: { reasoningEffort }, ... }
            variants: variantIds(model?.variants),
          })
        }
      }
      if (infos.length > 0) {
        return withVariants(infos).sort((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id))
      }
    } catch (error) {
      console.error("config providers failed, falling back to model catalog", errorMessage(error))
    }

    // Fallback: كتالوج الموديلات (v2) مقيدًا بالـ providers النشطة من الـ settings
    let settingsProviders: Set<string> | null = null
    try {
      const providersResponse = unwrap(await this.globalClient.v2.provider.list({ location: { directory: this.selectedProjectDirectory } }))
      const providers = Array.isArray(providersResponse) ? providersResponse : providersResponse?.data
      if (Array.isArray(providers)) {
        settingsProviders = new Set(
          providers.filter((provider) => !provider.disabled).map((provider) => provider.id),
        )
      }
    } catch (error) {
      console.error("v2 provider list failed, showing catalog without settings filter", errorMessage(error))
    }

    // المصدر الأساسي: /api/model (v2) — فيه cost الحقيقي لكل موديل
    try {
      const response = unwrap(await this.globalClient.v2.model.list({ location: { directory: this.selectedProjectDirectory } }))
      const list = Array.isArray(response) ? response : response?.data
      if (Array.isArray(list)) {
        return withVariants(
          list
            .filter((model) => !settingsProviders || settingsProviders.has(model.providerID))
            .map((model) => {
              const costs = Array.isArray(model.cost) ? model.cost : []
              const free = costs.length > 0 && costs.every((tier: { input: number; output: number; cache?: { read: number; write: number } }) => isFreeCost(tier.input, tier.output, tier.cache?.read ?? 0, tier.cache?.write ?? 0))
              return {
                id: model.id,
                providerID: model.providerID,
                name: model.name || model.id,
                free,
                enabled: model.enabled !== false,
                status: model.status,
              } satisfies ModelInfo
            })
            .sort((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id)),
        )
      }
    } catch (error) {
      console.error("v2 model list failed", errorMessage(error))
    }

    return []
  }

  async sessionModel(id: string): Promise<{ model: SessionModelRef | null; defaultModel: SessionModelRef | null }> {
    let model: SessionModelRef | null = null
    try {
      const session = unwrap(await this.globalClient.session.get({ sessionID: id, directory: this.selectedProjectDirectory }))
      const ref = session?.model as { id?: string; modelID?: string; providerID?: string; variant?: string } | undefined
      if (ref?.providerID && (ref.id || ref.modelID)) {
        model = { providerID: ref.providerID, modelID: ref.id || ref.modelID || "", ...(ref.variant ? { variant: ref.variant } : {}) }
      }
    } catch (error) {
      console.error("session get model failed", errorMessage(error))
    }

    let defaultModel: SessionModelRef | null = null
    try {
      const config = unwrap(await this.globalClient.config.get({ directory: this.selectedProjectDirectory }))
      defaultModel = parseModelString(config?.model)
    } catch {
      // تجاهل — الـ default اختياري
    }
    // لو مفيش model عام، استخدم default الـ providers من الـ settings (مثال: {opencode: "big-pickle"})
    if (!defaultModel) {
      try {
        const providersResponse = unwrap(await this.globalClient.config.providers({ directory: this.selectedProjectDirectory }))
        const entries = Object.entries(providersResponse?.default || {})
        const first = entries.find(([providerID, modelID]) => Boolean(providerID) && Boolean(modelID))
        if (first) {
          defaultModel = { providerID: first[0], modelID: first[1] as string }
        }
      } catch {
        // تجاهل — الـ default اختياري
      }
    }
    return { model, defaultModel }
  }

  async switchSessionModel(id: string, providerID: string, modelID: string, variant?: string): Promise<SessionModelRef> {
    const cleanProvider = (providerID || "").trim()
    const cleanModel = (modelID || "").trim()
    if (!cleanProvider || !cleanModel) {
      throw new Error("Model is required")
    }
    // تحقق إن الموديل موجود فعلًا (ويفضل free — الواجهة بتعرض free فقط)
    const available = await this.models()
    const match = available.find((candidate) => candidate.providerID === cleanProvider && candidate.id === cleanModel)
    if (!match) {
      throw new Error("Model not found")
    }
    const cleanVariant = (variant || "").trim()
    // لو الموديل معروف بـ variants بنتحقق، ولو مش معروفين (مفيش بيانات) بنسمح بيه
    // عشان ما نقفلش feature على موديل OpenCode لسه مش مbrickش بيانات عنه.
    const known = match.variants
    if (cleanVariant && known && known.length > 0 && !known.includes(cleanVariant)) {
      throw new Error("Variant not found")
    }
    const result = await this.globalClient.v2.session.switchModel({
      sessionID: id,
      model: { id: cleanModel, providerID: cleanProvider, ...(cleanVariant ? { variant: cleanVariant } : {}) },
    })
    if (result.error) {
      throw new Error(errorMessage(result.error))
    }
    return { providerID: cleanProvider, modelID: cleanModel, ...(cleanVariant ? { variant: cleanVariant } : {}) }
  }

  private mapQuestionRequest(request: QuestionRequest): ConversationQuestionRequest {
    return {
      id: request.id,
      sessionID: request.sessionID,
      questions: request.questions.map((question) => ({
        question: question.question,
        header: question.header,
        options: question.options.map((option) => ({ label: option.label, description: option.description })),
        multiple: question.multiple ?? false,
        custom: question.custom ?? false,
      })),
    }
  }

  private normalizeQuestionAnswers(request: QuestionRequest, answers: unknown): QuestionAnswer[] {
    if (!Array.isArray(answers) || answers.length !== request.questions.length) {
      throw new Error("Answers do not match questions")
    }
    return request.questions.map((question, index) => {
      const selected = answers[index]
      if (!Array.isArray(selected)) {
        throw new Error("Answers do not match questions")
      }
      const values = [...new Set(selected.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))]
      if (question.multiple) {
        if (values.length === 0) {
          throw new Error("Select at least one option")
        }
        return values
      }
      if (values.length !== 1) {
        throw new Error("Select one option")
      }
      return values
    })
  }

  async sessionQuestions(id: string): Promise<ConversationQuestionRequest[]> {
    const requests = unwrap(await this.globalClient.question.list({ directory: this.selectedProjectDirectory }))
    return requests.filter((request) => request.sessionID === id).map((request) => this.mapQuestionRequest(request))
  }

  async replyQuestion(sessionId: string, requestId: string, answers: unknown): Promise<boolean> {
    const requests = unwrap(await this.globalClient.question.list({ directory: this.selectedProjectDirectory }))
    const request = requests.find((candidate) => candidate.id === requestId)
    if (!request || request.sessionID !== sessionId) {
      throw new Error("Question not found")
    }
    const normalized = this.normalizeQuestionAnswers(request, answers)
    const result = await this.globalClient.question.reply({
      requestID: requestId,
      directory: this.selectedProjectDirectory,
      answers: normalized,
    })
    if (result.error) {
      throw new Error(errorMessage(result.error))
    }
    return result.data
  }

  async rejectQuestion(sessionId: string, requestId: string): Promise<boolean> {
    const requests = unwrap(await this.globalClient.question.list({ directory: this.selectedProjectDirectory }))
    const request = requests.find((candidate) => candidate.id === requestId)
    if (!request || request.sessionID !== sessionId) {
      throw new Error("Question not found")
    }
    const result = await this.globalClient.question.reject({ requestID: requestId, directory: this.selectedProjectDirectory })
    if (result.error) {
      throw new Error(errorMessage(result.error))
    }
    return result.data
  }

  async diff(id: string): Promise<FileDiff[]> {
    return unwrap(await this.clientFor().session.diff({ path: { id }, query: this.directoryQuery() }))
  }

  // حالة git للمشروع الحالي: الملفات المتغيّرة + اسم الفرع.
  // لازم v2 هنا: endpoint "/file/status" في v1 بيرجع [] دايمًا (حتى لمشاريع
  // عندها ملفات متغيّرة فعلًا)، بينما "/vcs/status" في v2 بيرجّع القائمة صح.
  // لو المشروع مش مستودع git، بنرجّع available=false بدل ما نرمي خطأ.
  async gitChanges(): Promise<GitChanges> {
    const query = { directory: this.selectedProjectDirectory }

    let statusFiles: VcsFileStatus[]
    try {
      statusFiles = unwrap(await this.globalClient.vcs.status({ directory: query.directory }))
    } catch {
      return { branch: "", available: false, files: [] }
    }

    let branch = ""
    try {
      const info = await this.globalClient.vcs.get({ directory: query.directory })
      if (!info.error && typeof info.data?.branch === "string") {
        branch = info.data.branch
      }
    } catch {
      branch = ""
    }

    const files = (Array.isArray(statusFiles) ? statusFiles : [])
      .filter((file) => typeof file?.file === "string" && file.file.trim().length > 0)
      .map((file) => ({
        path: file.file.replace(/\\/g, "/"),
        status: file.status,
        added: Number.isFinite(file.additions) ? file.additions : 0,
        removed: Number.isFinite(file.deletions) ? file.deletions : 0,
      }))
      .sort((left, right) => left.path.localeCompare(right.path))

    // مشروع مش مستودع git بيرجّع v2 قائمة فاضية و branch فاضي — نميّزه عن
    // مستودع نضيف عشان الواجهة متقولش "الشجرة نضيفة" لمفيش git أصلًا
    return { branch, available: branch !== "" || files.length > 0, files }
  }

  async replyPermission(id: string, permissionId: string, response: "once" | "always" | "reject"): Promise<boolean> {
    const result = await this.clientFor().postSessionIdPermissionsPermissionId({
      path: { id, permissionID: permissionId },
      body: { response },
      query: this.directoryQuery(),
    })

    if (result.error) {
      throw new Error(errorMessage(result.error))
    }

    this.pendingPermissions.delete(permissionId)
    return result.data
  }

  permissions(): Permission[] {
    return [...this.pendingPermissions.values()]
  }

  close(): void {
    this.abortController.abort()
    if (this.queueWatchdog) {
      clearInterval(this.queueWatchdog)
      this.queueWatchdog = null
    }
    this.promptQueues.clear()
    this.runningSessions.clear()
    this.skippingSessions.clear()
    this.idlePolls.clear()
    this.closeServer?.()
    this.listeners.clear()
    this.clients.clear()
  }
}
