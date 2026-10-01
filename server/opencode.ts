import { existsSync, readFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename as pathBasename, isAbsolute, resolve } from "node:path"
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client"
import { Service } from "@opencode/client/service"
import type {
  FileDiffInfo,
  FormInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client"
import { setTimeout as sleep } from "node:timers/promises"
import { ensureLocalEndpoint } from "./opencode/service-launch.js"
import { consoleLang, serverMessage, type ServerLang } from "./i18n.js"
import type {
  ActiveSession,
  ConversationQuestionRequest,
  EnginePermission,
  GitChanges,
  HistoryTurn,
  ModelInfo,
  Project,
  RequestState,
  ResultFile,
  ServiceOptions,
  Session,
  SessionModelRef,
  SessionRequest,
  SessionRequests,
  SessionStatus,
} from "./opencode/types.js"
import {
  ACTIVITY_CACHE_MS,
  BUSY_STALL_MS,
  directoryKey,
  errorDetail,
  errorMessage,
  fileNameFromPath,
  folderName,
  HEALTHCHECK_TIMEOUT_MS,
  isDefaultTitle,
  isFreeCost,
  isListableProjectDirectory,
  MAX_FILE_DOWNLOAD_BYTES,
  MAX_PROMPT_ATTEMPTS,
  MAX_STALL_WATCHES,
  mimeFromName,
  MODELS_CACHE_MS,
  parseModelString,
  parseCliVersion,
  PROMPT_DISPATCH_TIMEOUT_MS,
  QUEUED_ID_PREFIX,
  queuedItemId,
  QUESTIONS_CACHE_MS,
  sessionRoots,
  sortVariants,
  STALE_BUSY_GRACE_MS,
  stripMobileSuffix,
  titleFromUserText,
  variantIds,
  VARIANTS_CACHE_MS,
  withTimeout,
} from "./opencode/utils.js"

// إعادة تصدير للتوافق: الاستيراد من "./opencode.js" ما زال يعطي نفس الأنواع.
export type {
  ActiveSession,
  ConversationQuestion,
  ConversationQuestionOption,
  ConversationQuestionRequest,
  GitChangeFile,
  GitChanges,
  HistoryTurn,
  ModelInfo,
  Project,
  RequestState,
  ResultFile,
  ServiceOptions,
  Session,
  SessionModelRef,
  SessionRequest,
  SessionRequests,
  SessionStatus,
  Todo,
} from "./opencode/types.js"

interface MobileSessionFile {
  sessions: string[]
}

type EventListener = (event: OpenCodeEvent) => void | Promise<void>

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
  entries: SessionMessageAssistant[]
}

export class OpenCodeService {
  private client: OpenCodeClient | null = null
  private selectedProjectDirectory: string
  private selectedProjectId: string | null = null
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
  // مراقبة الجمود: آخر بصمة تقدّم ووقتها لكل جلسة محسوبة busy. لو الجلسة
  // فضلت busy بنفس البصمة (لا رسالة جديدة ولا إتمام ولا نمو نص ولا سؤال)
  // لمهلة BUSY_STALL_MS، وهي لا مستنية طابور ولا سؤال/إذن من المستخدم،
  // بنحرّرها بدل ما الكارت يفضل "يعمل OpenCode على المهمة" للأبد.
  private readonly stallWatches = new Map<string, { sig: string; at: number }>()
  // جلسات اتحرّرت بالجمود: حكم "خلص" ثابت حتى يظهر تقدّم حقيقي أو يتبعت
  // طلب جديد أو يوصل idle. مجموعة مستقلة عن finishedRuns عشان صيانته
  // الدورية (المسح مع أي تقدّم) ما تمسحش حكم الجمود في نفس الـ poll
  // فيتنطط الكارت "شغّال ⇄ خلص" — المسح هنا مع تغيّر البصمة فقط.
  private readonly stalledSessions = new Set<string>()
  private promptSeq = 0
  private queueWatchdog: NodeJS.Timeout | null = null
  private readonly pendingPermissions = new Map<string, EnginePermission>()
  private readonly mobileSessions = new Set<string>()
  private readonly mobileSessionsPath = resolve(process.cwd(), "data", "mobile-sessions.json")
  private eventsStarted = false
  // كاش Variants:endpoint واحد بس وبطيء، والقائمة مش بتتغير كتير
  private variantsCache: {
    directory: string
    expiresAt: number
    map: Map<string, string[]>
    items: Array<{
      id: string
      modelID: string
      providerID: string
      name: string
      cost: Array<{ input: number; output: number; cache: { read: number; write: number } }>
      enabled: boolean
      status: string
      variants: string[] | undefined
    }>
  } | null = null
  // إلغاء تكرار الطلبات المتزامنة: نفس المورد المطلوب لحظيًا يشارك promise واحدة
  private readonly inflight = new Map<string, Promise<unknown>>()
  // كاش النشاط قصير المدى ( Issue: fan-out كل ٤ ثواني لكل عميل )
  private activityCache: { expiresAt: number; lang: ServerLang; value: ActiveSession[] } | null = null
  // كاش الموديلات الكامل + قوائم الأسئلة لكل جلسة
  private modelsCache: { expiresAt: number; directory: string; value: ModelInfo[] } | null = null
  private readonly questionsCache = new Map<string, { expiresAt: number; value: FormInfo[]}>()
  // سلسلة كتابة ملف الجلسات: ترتيب مضمون من غير حظر الـ event loop
  private persistChain: Promise<void> = Promise.resolve()

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

  private persistMobileSessions(): Promise<void> {
    const write = async (): Promise<void> => {
      try {
        const { mkdir, writeFile } = await import("node:fs/promises")
        await mkdir(resolve(process.cwd(), "data"), { recursive: true, mode: 0o700 })
        const data: MobileSessionFile = { sessions: [...this.mobileSessions] }
        await writeFile(this.mobileSessionsPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
      } catch {
        // التخزين اختياري — الفشل لا يوقع الطلب
      }
    }
    // تسلسل الكتابات عشان ترتيب الملف يفضل صح من غير await متزامن يحظر الـ loop
    this.persistChain = this.persistChain.then(write, write)
    return this.persistChain
  }

  // نفس المورد يُطلب لحظيًا من كذا poll متزامن: شارك promise واحدة بدل N calls
  private dedup<T>(key: string, build: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) {
      return existing as Promise<T>
    }
    const task = build().finally(() => {
      if (this.inflight.get(key) === task) {
        this.inflight.delete(key)
      }
    })
    this.inflight.set(key, task)
    return task
  }

  // عميل واحد لكل الاتجاهات: v2 يأخذ الموقع (directory) مع كل نداء،
  // فلا حاجة لعملاء مُخزّنة لكل مجلد كما في v1.
  private requireClient(): OpenCodeClient {
    if (!this.client) {
      throw new Error("OpenCode is not connected")
    }
    return this.client
  }

  private location(directory = this.selectedProjectDirectory): { directory: string } {
    return { directory }
  }

  // فحص مسبق لنسخة CLI قبل محاولة تشغيل الخدمة — v1 لا يدعم `serve --service`
  // ويخرج بـ code 1 بدون رسالة واضحة، فهذا الفحص يعطي خطأً فوريًا قابلًا للحل.
  private async checkCliVersion(): Promise<string> {
    const lang = consoleLang()
    const { execFile } = await import("node:child_process")
    return new Promise((resolve, reject) => {
      const command = process.platform === "win32" ? "cmd" : "opencode"
      const args = process.platform === "win32" ? ["/c", "opencode", "--version"] : ["--version"]
      execFile(command, args, { timeout: 10_000 }, (error, stdout) => {
        if (error) {
          reject(new Error(`${serverMessage("cliRunFailed", lang)}: ${error.message}. ${serverMessage("cliInstallHint", lang)}`))
          return
        }
        // v2 تطبع "opencode v2.0.18" لا الرقم مجرّدًا، فبنمطّع الصيغة قبل الحكم.
        const version = parseCliVersion(stdout)
        if (!version.startsWith("2.")) {
          reject(new Error(
            serverMessage("cliVersionMismatch", lang).replace("{version}", version || stdout.trim() || serverMessage("versionUnknown", lang)),
          ))
          return
        }
        resolve(version)
      })
    })
  }

  async connect(): Promise<void> {
    if (this.options.serverUrl) {
      this.client = OpenCode.make({ baseUrl: this.options.serverUrl })
    } else {
      // خدمة v2 المحلية: تُكتشف أو تُشغَّل تلقائيًا مع تثبيت الإصدار 2،
      // وتستخدم قاعدة البيانات المشتركة مع تطبيق الديسكتوب — فالجلسات
      // القديمة والجديدة من مصدر واحد دون عزل أو استيراد.
      await this.checkCliVersion()
      let endpoint: Awaited<ReturnType<typeof Service.ensure>>
      try {
        // الاكتشاف أولًا ثم التشغيل المخفي على Windows (بلا نافذة بوب)،
        // و`Service.ensure()` ملاذ أخير لحالات الاستبدال فقط.
        endpoint = await ensureLocalEndpoint()
      } catch (error) {
        // بدء الخدمة يرمي سببًا مخفيًا في cause (مثل غياب التنفيذية)،
        // فنحفظ السلسلة كاملة مع تلميح عملي — وإلا بقي سجل البدء يكرر
        // رسالة مبهمة كل 5 ثوانٍ بلا طريق للحل.
        const lang = consoleLang()
        throw new Error(
          `${serverMessage("serviceStartFailed", lang)} (${errorDetail(error)}). ${serverMessage("cliV2Hint", lang)}`,
          { cause: error },
        )
      }
      this.client = OpenCode.make({
        baseUrl: endpoint.url,
        headers: Service.headers(endpoint),
      })
    }
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
        for await (const event of this.requireClient().event.subscribe({ signal: this.abortController.signal })) {
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

  private trackEvent(event: OpenCodeEvent): void {
    // الاتحاد اللفظي المغلق يُنسخ لنص حر — نفس علة server/sse/filter.ts.
    const eventType: string = event.type
    // أي دورة حياة جلسة تبطل كاش النشاط فورًا (من غير انتظار TTL) عشان
    // القائمة متعرضش حالة قديمة، والـ TTL القصير يمتص العواصف بين الأحداث
    if (
      eventType === "session.status"
      || eventType === "session.idle"
      || eventType === "session.execution.failed"
      || eventType === "session.created"
      || eventType === "session.renamed"
      || eventType === "session.moved"
      || eventType === "session.deleted"
    ) {
      this.activityCache = null
    }
    // أحداث الاستمارات (أسئلة المستخدم) تبطل كاش أسئلة جلستها
    if (eventType === "form.created" || eventType === "form.replied" || eventType === "form.cancelled") {
      const sessionId = (event.data as { sessionID?: unknown }).sessionID
      if (typeof sessionId === "string") {
        this.questionsCache.delete(sessionId)
      } else {
        this.questionsCache.clear()
      }
    }
    if (eventType === "permission.asked") {
      const data = event.data as unknown as { id: string; sessionID: string; action: string; resources: string[]; message?: unknown }
      this.pendingPermissions.set(data.id, {
        id: data.id,
        sessionID: data.sessionID,
        title: typeof data.message === "string" && data.message.trim() ? data.message : data.action,
        pattern: data.resources.join(", "),
      })
    }

    if (eventType === "permission.replied") {
      const replied = event.data as unknown as { requestID: string }
      this.pendingPermissions.delete(replied.requestID)
    }

    if (eventType === "session.status") {
      const withStatus = event.data as unknown as { sessionID: string; status: { type: string } }
      const statusType = withStatus.status.type
      if (statusType === "busy" || statusType === "retry") {
        this.busySessions.add(withStatus.sessionID)
      } else if (statusType === "idle") {
        this.busySessions.delete(withStatus.sessionID)
        this.releaseSession(withStatus.sessionID)
      }
      // أي نوع حالة غير معروف (أو حدث ناقص): تجاهل — الـ poll الدوري
      // لـ /session/status هو مصدر الحقيقة الأساسي
    }

    if (eventType === "session.idle") {
      const idle = event.data as unknown as { sessionID: string }
      this.busySessions.delete(idle.sessionID)
      this.releaseSession(idle.sessionID)
    }

    if (eventType === "session.execution.failed") {
      // خطأ OpenCode بيقفل الشغل من غير ما يبعت idle بعدها، فبدون السطر ده
      // الجلسة هتفضل متسجّلة "شغّال" للأبد في قائمة المحادثات النشطة.
      const failed = event.data as unknown as { sessionID: string }
      const sessionId = failed.sessionID
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
    return turn.entries.some((entry) => entry.time.completed === undefined)
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
    // جلسة متحرّرة بالجمود (stalledSessions) تتعامل نفس المعاملة: busy بلا
    // تقدّم لمهلة طويلة = خلصت حكمًا حتى لو OpenCode ما قالش.
    if (
      (status.type === "busy" || status.type === "retry")
      && !this.hasPendingWork(sessionId)
      && (this.finishedRuns.has(sessionId) || this.stalledSessions.has(sessionId))
    ) {
      return { type: "idle" }
    }
    return status
  }

  // كاشف الجمود — بيتنادى مع كل poll للـ requests (كل ~٢.٥ ثانية أثناء
  // الشغل) فمفيش مؤقتات إضافية. البصمة هي نفس version الـ ETag: أي تقدّم
  // مرئي يغيّرها. الغير مؤهل (طابور مستني/سؤال/إذن) يمسح المراقبة ويبدأ
  // من جديد بعدها — الانتظار ده مشروع للمستخدم مش جمود، ورسائل الطابور
  // ملك المستخدم فممنوع المساس بها هنا.
  private trackStall(id: string, busy: boolean, sig: string, eligible: boolean): void {
    if (!busy || !eligible) {
      this.stallWatches.delete(id)
      return
    }
    const previous = this.stallWatches.get(id)
    if (!previous) {
      // أول مراقبة: سجّل من غير ما تمسح حكم جمود ثابت سابق — وإلا الحكم
      // هيتمسح في الـ poll اللي بعد إطلاقه مباشرة والكارت هيتنطط.
      if (this.stallWatches.size >= MAX_STALL_WATCHES) {
        const oldest = this.stallWatches.keys().next()
        if (!oldest.done) {
          this.stallWatches.delete(oldest.value)
        }
      }
      this.stallWatches.set(id, { sig, at: Date.now() })
      return
    }
    if (previous.sig !== sig) {
      // تقدّم حقيقي ظهر — امسح أي حكم جمود قديم على الجلسة دي
      this.stallWatches.set(id, { sig, at: Date.now() })
      this.stalledSessions.delete(id)
      return
    }
    if (Date.now() - previous.at >= BUSY_STALL_MS) {
      // جمود مؤكد: حرّر أعلام الشغل وسجّل الحكم الثابت. الطابور فاضي هنا
      // (شرط الأهلية) فمفيش رسائل مستخدم هتضيع.
      this.stallWatches.delete(id)
      this.runningSessions.delete(id)
      this.busySessions.delete(id)
      this.stalledSessions.add(id)
    }
  }

  // الجلسة خلصت: ابعت الطلب اللي مستني في الطابور (لو فيه).
  private releaseSession(sessionId: string): void {
    this.runningSessions.delete(sessionId)
    // إشارة نهاية حقيقية (idle/خطأ/إيقاف) تنسخ أي حكم جمود ثابت —
    // الواقع الجديد هو مصدر الحقيقة من هنا.
    this.stalledSessions.delete(sessionId)
    this.stallWatches.delete(sessionId)
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
    // وحكم الجمود الثابت كمان: النشاط الجديد يبدأ مراقبة من الصفر
    this.stalledSessions.delete(sessionId)
    this.stallWatches.delete(sessionId)
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
    // بسقف زمني: المحرك المزنوق يقبل الاتصال ولا يرد، ومن غير السقف
    // يبقى connect() معلقًا بدل ما يدخل حلقة إعادة المحاولة.
    const info = await withTimeout(this.requireClient().server.info(), HEALTHCHECK_TIMEOUT_MS, "OpenCode healthcheck")
    return { healthy: true, version: info.version || "connected" }
  }

  // كل الجلسات عبر كل المواقع مع ترقيم الصفحات: v2 يرجّع دفعات بمؤشر،
  // فنجمعها حتى ينفد المؤشر التالي (بسقف يمنع الحلقات الطويلة).
  private async listAllSessions(limit = 200): Promise<SessionInfo[]> {
    const all: SessionInfo[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page += 1) {
      const response = await this.requireClient().session.list(
        cursor ? { cursor, limit } : { limit },
      )
      all.push(...response.data)
      const next = response.cursor.next
      if (!next) {
        break
      }
      cursor = next
    }
    return all
  }

  // جلسات المجلد المختار فقط — هي ما تعرضه قائمة المحادثات.
  // بترجّع المهام الفرعية كمان لأنها جلسات ابن: نحتاجها عشان نبني خريطة
  // الجذور، فالإخفاء بيحصل عند العرض مش عند الجلب.
  private async listDirectorySessions(directory: string): Promise<SessionInfo[]> {
    const response = await this.requireClient().session.list({ directory, limit: 200 })
    return response.data
  }

  private toSession(summary: SessionInfo): Session {
    return {
      id: summary.id,
      title: summary.title || "",
      directory: summary.location.directory,
      time: { created: summary.time.created, updated: summary.time.updated },
    }
  }

  async projects(): Promise<Project[]> {
    // مصدران للمجلدات: سجل المشروع في المحرك (`project.list`) وجلسات
    // حيّة. السجل وحده يكفي لعرض مشروع ما بدأ فيه محادثة بعد، والجلسات
    // وحدها تكفي لعميل قديم لا يسجّل — فالجمع يغطّي الاثنين. القاعدة
    // مشتركة مع الديسكتوب، فلا عزل ولا استيراد.
    // الجذور والمسارات النسبية والأعشاش المؤقتة تُخفى من كل مصدر عبر
    // البوابة نفسها، فقائمة `/api/project` لا تتسرّب من أي فرع.
    const home = homedir()
    const projectsByDirectory = new Map<string, Project>()
    const nameByProjectId = new Map<string, string>()
    // المسجَّل بمجلد لا يحمل جلسات: نضيفه الآن بـ canonical الخاص به لا
    // بمجلد جلسة، وإلا اختفى المشروع حتى يُفتح فيه حوار.
    const registeredByDirectory = new Map<string, { id: string; worktree: string; name?: string; created: number; updated: number }>()
    try {
      const registered = await this.requireClient().project.list()
      for (const project of registered) {
        if (project.name) {
          nameByProjectId.set(project.id, project.name)
        }
        if (!isListableProjectDirectory(project.canonical, home)) {
          continue
        }
        registeredByDirectory.set(directoryKey(project.canonical), {
          id: project.id,
          worktree: project.canonical,
          name: project.name,
          created: project.time?.created || 0,
          updated: project.time?.updated || 0,
        })
      }
    } catch {
      // فشل السجل يُبقي المجلد المُعدّ والمشاريع ذات الجلسات
    }

    // المجلد المُعدّ يظهر دائمًا — حتى قبل أول جلسة — فشاشة الاختيار لا
    // تُسدّ أبدًا. أي بيانات حقيقية عنه من الجلسات تتجاوزه تحت. إعداد خاطئ
    // بجذر قرص (الافتراضي القديم `..` من داخل `E:\REMOTE-CODE` يساوي `E:\`)
    // يُتجاهل هنا بدل عرضه كمشروع، فسطر بدء السيرفر يكشف الخطأ لا القائمة.
    const configured = this.options.projectDirectory
    if (isListableProjectDirectory(configured, home)) {
      projectsByDirectory.set(directoryKey(configured), {
        id: configured,
        worktree: configured,
        time: { created: 0, updated: 0 },
      })
    }

    // مشروع مسجَّل بلا جلسات: يظهر بزمنه من المحرك. لو كان هو المجلد
    // المُعدّ فالاسم والزمن يُملآن على القامة الموجودة بدل تكرار الصف.
    for (const [key, project] of registeredByDirectory) {
      const existing = projectsByDirectory.get(key)
      if (existing) {
        if (existing.id === configured) {
          existing.name = project.name
          existing.time = {
            created: Math.min(existing.time.created || project.created, project.created),
            updated: Math.max(existing.time.updated, project.updated),
          }
        }
        continue
      }
      projectsByDirectory.set(key, {
        id: project.id,
        worktree: project.worktree,
        name: project.name || folderName(project.worktree),
        time: { created: project.created, updated: project.updated },
      })
    }

    let sessions: SessionInfo[] = []
    try {
      sessions = await this.listAllSessions()
    } catch {
      // الفشل يُبقي المجلد المُعدّ فقط
    }
    for (const session of sessions) {
      const directory = session.location.directory
      if (!isListableProjectDirectory(directory, home)) {
        continue
      }
      const key = directoryKey(directory)
      const existing = projectsByDirectory.get(key)
      const created = session.time.created
      const updated = session.time.updated
      // أي صف قائم — مُعدّ أو مسجَّل — يقرأ زمن الجلسات فقط ولا يُستبدل:
      // استبداله كان يضيّع `id` المُعدّ ويمنع أي تحديث على زمنه، فيبقى
      // مثالًا في أسفل القائمة مهما كثرت محادثاته.
      if (existing) {
        existing.time = {
          created: Math.min(existing.time.created || created, created),
          updated: Math.max(existing.time.updated, updated),
        }
        continue
      }
      const fallbackName = folderName(directory)
      projectsByDirectory.set(key, {
        id: session.projectID,
        worktree: directory,
        name: nameByProjectId.get(session.projectID) || fallbackName,
        time: { created, updated },
      })
    }

    return [...projectsByDirectory.values()].sort((left, right) => right.time.updated - left.time.updated)
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
    if (!project || !isListableProjectDirectory(project.worktree, homedir())) {
      throw new Error("Project not found")
    }

    // v2 بلا project.current: الاختيار حالة محلية فقط، والموقع يُمرَّر
    // مع كل نداء — فلا تسجيل ولا تبديل على مستوى المحرك.
    this.selectedProjectId = project.id
    this.selectedProjectDirectory = project.worktree
    return project
  }

  // الجذور وحدها: مهمة Task جلسات ابن بتتجمّع في محادثتها الأم، والمستخدم
  // بيشوف محادثة واحدة مش خمس — نفس اللي بيعمله الديسكتوب (`!e.parentID`).
  async sessions(): Promise<Session[]> {
    const listed = await this.listDirectorySessions(this.selectedProjectDirectory)
    const { roots } = sessionRoots(listed)
    const rootIds = new Set(roots)
    return listed.filter((session) => rootIds.has(session.id)).map((session) => this.toSession(session))
  }

  async createSession(title?: string, mobile = false): Promise<Session> {
    // Create without a custom title when the title is empty/default so that
    // OpenCode's native auto-title (based on the first message) can run,
    // just like on desktop. A custom title would make native generation skip.
    const cleanTitle = stripMobileSuffix((title || "").trim())
    const useTitle = cleanTitle && !isDefaultTitle(cleanTitle) ? cleanTitle : undefined
    const created = await this.requireClient().session.create({
      ...(useTitle ? { title: useTitle } : {}),
      location: this.location(),
    })
    const session = this.toSession(created)

    if (!mobile) {
      return session
    }

    this.mobileSessions.add(session.id)
    await this.persistMobileSessions()
    return session
  }

  async updateSession(id: string, title: string, lang: ServerLang = "ar"): Promise<Session> {
    const nextTitle = stripMobileSuffix(title.trim()).slice(0, 120) || serverMessage("newConversation", lang)
    await this.requireClient().session.update({ sessionID: id, title: nextTitle })
    return this.toSession(await this.requireClient().session.get({ sessionID: id }))
  }

  async deleteSession(id: string): Promise<boolean> {
    this.mobileSessions.delete(id)
    this.promptQueues.delete(id)
    this.runningSessions.delete(id)
    // تنظيف كل الحالة المرتبطة بالجلسة عشان مفيش تسريب ذاكرة طويل المدى:
    // أعلام الشغل، عدّادات الـ watchdog، أحكام "خلص"، وأذوناتها المعلّقة
    this.skippingSessions.delete(id)
    this.busySessions.delete(id)
    this.finishedRuns.delete(id)
    this.stalledSessions.delete(id)
    this.stallWatches.delete(id)
    this.idlePolls.delete(id)
    for (const [permissionId, permission] of this.pendingPermissions) {
      if (permission.sessionID === id) {
        this.pendingPermissions.delete(permissionId)
      }
    }
    this.activityCache = null
    await this.persistMobileSessions()
    await this.requireClient().session.remove({ sessionID: id })
    return true
  }

  async messages(id: string): Promise<SessionMessageInfo[]> {
    const response = await this.requireClient().message.list({ sessionID: id, limit: 200 })
    return response.data
  }

  // تقسيم رسائل الجلسة إلى "طوابق": كل رسالة مستخدم بتبدأ طابق،
  // والردود اللي بعدها بتاعتها. الترتيب زمني من الأقدم للأحدث.
  private turns(messages: SessionMessageInfo[]): RequestTurn[] {
    const sorted = [...messages].sort((a, b) => this.messageCreated(a) - this.messageCreated(b))
    const turns: RequestTurn[] = []
    let current: RequestTurn | null = null

    for (const entry of sorted) {
      if (entry.type === "user") {
        if (current) {
          turns.push(current)
        }
        const prompt = entry.text.trim()
        if (!prompt && !entry.files?.length && !entry.agents?.length && !entry.skills?.length) {
          current = null
          continue
        }
        current = {
          id: entry.id,
          prompt,
          createdAt: entry.time.created,
          completedAt: 0,
          updatedAt: entry.time.created,
          texts: [],
          steps: 0,
          entries: [],
        }
        continue
      }

      if (entry.type !== "assistant" || !current) {
        continue
      }
      for (const part of entry.content) {
        if (part.type === "text" && part.text.trim()) {
          current.texts.push(part.text)
        }
        if (part.type === "tool" && part.state.status === "completed") {
          current.steps += 1
        }
      }
      current.entries.push(entry)
      current.updatedAt = Math.max(current.updatedAt, entry.time.created, entry.time.completed ?? 0)
      if (entry.time.completed) {
        current.completedAt = Math.max(current.completedAt, entry.time.completed)
      }
    }
    if (current) {
      turns.push(current)
    }

    return turns
  }

  private messageCreated(message: SessionMessageInfo): number {
    return message.time.created
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
    const [rawStatuses, messages, questions] = await Promise.all([
      this.rawStatuses(),
      this.messages(id),
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
    const queue = this.promptQueues.get(id) ?? []
    // بصمة التقدّم: أي حراك مرئي (رسالة/إتمام/نص/طابور/سؤال) يغيّرها.
    // الطول التراكمي للنصوص يلتقط نمو الـ live text حتى لو الأوقات لم تتغير.
    // الطابور الفاضي شرط الأهلية: رسائل المستخدم ملكه فممنوع المساس بها هنا.
    // والسؤال/الإذن المعلّق انتظار مشروع للمستخدم (كارت ظاهر) مش جمود.
    // (v2 بلا قائمة مهام، فلا todos في البصمة ولا في الكروت.)
    const turnSig = turns
      .map((turn) => `${turn.updatedAt}:${turn.completedAt}:${turn.texts.join("").length}`)
      .join(";")
    const sharedTail = [
      turns.length,
      turnSig,
      queue.map((item) => item.id).join(","),
      questions.map((question) => question.id).join(","),
    ].join("|")
    const waitingOnUser = questions.length > 0
      || [...this.pendingPermissions.values()].some((permission) => permission.sessionID === id)
    // كاشف الجمود يشتغل على الحالة الخام وقبل الحكم الفعّال، عشان تحرير
    // الجلسة في الـ poll ده نفسه ينعكس على الكارت فورًا بلا تأخير poll.
    this.trackStall(
      id,
      rawStatus.type === "busy" || rawStatus.type === "retry",
      `${rawStatus.type}|${sharedTail}`,
      queue.length === 0 && !waitingOnUser,
    )
    const status = this.effectiveStatus(id, staleBusy ? { type: "idle" } : rawStatus)
    const busy = status.type === "busy" || status.type === "retry"
    const runningIndex = busy ? turns.length - 1 : -1

    const requests: SessionRequest[] = turns.map((turn, index) => {
      const running = index === runningIndex
      const reversed = [...turn.entries].reverse()
      const currentAssistant = reversed.find((entry) => entry.time.completed === undefined)
      const completedAssistant = reversed.find((entry) => entry.time.completed !== undefined)
      const activeTool = currentAssistant?.content.find((part): part is SessionMessageAssistantTool =>
        part.type === "tool" && (part.state.status === "running" || part.state.status === "streaming"))

      let activity = serverMessage("taskReady", lang)
      if (running) {
        if (status.type === "retry") {
          activity = serverMessage("retryingNow", lang)
        } else if (activeTool) {
          activity = `${serverMessage("usesTool", lang)} ${activeTool.name}`
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
        finalResult: completedAssistant ? this.assistantText(completedAssistant) : "",
        liveText,
        stepsCompleted: turn.steps,
        activeTool: activeTool?.name ?? null,
        // v2 بلا قائمة مهام — الحقول باقية في العقد فارغة
        todos: [],
        completedTodos: 0,
        totalTodos: 0,
        resultFiles: this.collectResultFiles(id, turn.entries, lang),
        startedAt: turn.createdAt,
        completedAt: turn.completedAt,
        updatedAt: turn.updatedAt,
      }
    })

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

    // بصمة الحالة (ETag): نفس مكوّنات بصمة الجمود لكن بنوع الحالة الفعّالة،
    // فأي تغيير مرئي يغيّرها والعميل يوفّر إعادة التحميل (304) لما مفيش جديد.
    const version = [status.type, sharedTail].join("|")

    return { status, requests, questions, queued: queue.length, version }
  }

  private assistantText(entry: SessionMessageAssistant): string {
    return entry.content
      .filter((part): part is Extract<SessionMessageAssistant["content"][number], { type: "text" }> =>
        part.type === "text" && part.text.trim().length > 0)
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
  }

  // ملفات النتيجة من محتوى v2: مرفقات file داخل الأدوات المكتملة، وملفات
  // الـ snapshot للرسالة (بديل patch في v1). الـ uri بصيغة file:// يُحوَّل
  // لمسار، وhttp(s) يُترك رابطًا.
  private filePathFromUri(uri: string): { path: string; url: string } {
    const trimmed = (uri || "").trim()
    if (/^file:\/\//i.test(trimmed)) {
      try {
        return { path: resolve(decodeURIComponent(trimmed.replace(/^file:\/\/\/?/i, ""))), url: "" }
      } catch {
        return { path: "", url: "" }
      }
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return { path: "", url: trimmed }
    }
    return { path: trimmed, url: "" }
  }

  private collectResultFiles(
    sessionId: string,
    messages: SessionMessageAssistant[],
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
      for (const part of entry.content) {
        if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) {
          continue
        }
        const content = part.state.status === "completed" || part.state.status === "error"
          ? part.state.content
          : []
        for (const item of content ?? []) {
          if (item.type !== "file") {
            continue
          }
          const { path, url } = this.filePathFromUri(item.uri)
          const name = item.name || (path ? fileNameFromPath(path, fileFallback) : fileNameFromPath(url, fileFallback))
          pushFile({ id: `${part.id}:${item.uri}`, name, mime: item.mime || mimeFromName(name), path, url, source: "attachment" })
        }
      }
      for (const filePath of entry.snapshot?.files ?? []) {
        if (typeof filePath !== "string" || !filePath.trim()) {
          continue
        }
        const name = fileNameFromPath(filePath, fileFallback)
        pushFile({
          id: `${entry.id}:${filePath}`,
          name,
          mime: mimeFromName(name),
          path: filePath,
          url: "",
          source: "output",
        })
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

  // ستريم قراءة ملف نتيجة: تحقق + stat، والقراءة الفعلية بالـ stream
  // عشان ملف 25MB ميتحملش كله في الذاكرة مع كل تحميل موبايل متزامن
  async openResultFile(sessionId: string, requestedPath: string): Promise<{ filename: string; mime: string; size: number; stream: NodeJS.ReadableStream }> {
    const trimmed = (requestedPath || "").trim()
    if (!trimmed || trimmed.length > 1024) {
      throw new Error("Invalid file path")
    }

    const sessionDir = await this.sessionDirectory(sessionId)
    const absolutePath = isAbsolute(trimmed) ? resolve(trimmed) : resolve(sessionDir, trimmed)
    // حد التنزيل هو مجلد الجلسة نفسها بدل جذر عام واحد — يدعم تعدد
    // المشاريع ويمنع الخروج منه.
    const workspaceRoot = resolve(sessionDir)
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
      const { createReadStream } = await import("node:fs")
      const filename = pathBasename(absolutePath)
      return { filename, mime: mimeFromName(filename), size: fileStat.size, stream: createReadStream(absolutePath) }
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
    // سقف زمني بدل الانتظار الأبدي: لو OpenCode معلّق والـ HTTP ما استقرّش،
    // الـ catch في pumpQueue يعيد الطلب أو يسقطه بعد MAX_PROMPT_ATTEMPTS،
    // بدل ما runningSessions يتجمّد والكارت يفضل "شغّال" للأبد.
    // v2 يقبل النص فقط في prompt — الوكيل والموديل يُضبطان على الجلسة
    // أولًا (كما كان v1 يفعل ضمنيًا مع كل طلب).
    await withTimeout(
      (async () => {
        if (item.agent) {
          await this.requireClient().session.switchAgent({ sessionID: id, agent: item.agent })
        }
        if (item.model?.providerID && item.model?.modelID) {
          await this.requireClient().session.switchModel({
            sessionID: id,
            model: {
              id: item.model.modelID,
              providerID: item.model.providerID,
              ...(item.model.variant ? { variant: item.model.variant } : {}),
            },
          })
        }
        await this.requireClient().session.prompt({ sessionID: id, text: item.text })
      })(),
      PROMPT_DISPATCH_TIMEOUT_MS,
      "Prompt dispatch",
    )

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
    try {
      const summary = await this.requireClient().session.get({ sessionID: sessionId })
      currentTitle = summary.title || ""
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
      const userCount = history.filter((entry) => entry.type === "user").length
      if (userCount > 1) {
        return
      }
    } catch {
      // If history is unavailable, still apply the fallback title.
    }

    await this.requireClient().session.update({ sessionID: sessionId, title: fallback })
  }

  // الإيقاف اليدوي بيوقف الطلب الشغّال وبيشيل كل الطلبات اللي مستنية في الطابور.
  async abort(id: string): Promise<{ aborted: boolean; cleared: number }> {
    const cleared = this.promptQueues.get(id)?.length ?? 0
    this.promptQueues.delete(id)
    this.runningSessions.delete(id)
    this.skippingSessions.delete(id)
    const { interrupted } = await this.requireClient().session.interrupt({ sessionID: id })
    return { aborted: interrupted, cleared }
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
      skipped = (await this.requireClient().session.interrupt({ sessionID: id })).interrupted
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
      await this.requireClient().session.interrupt({ sessionID: id })
    } finally {
      this.skippingSessions.delete(id)
      started = this.pumpQueue(id)
    }
    return { started, remaining: left() }
  }

  // v2 بلا خريطة حالات: `session.active` يرجّع الشغال فعلًا فقط، والباقي
  // خامل حكمًا. نبني نفس الخريطة من قائمة جلسات المجلد + النشطين.
  private async runningSessionIds(): Promise<Set<string>> {
    try {
      const active = await this.requireClient().session.active()
      return new Set(Object.keys(active))
    } catch {
      return new Set(this.busySessions)
    }
  }

  async statuses(): Promise<Record<string, SessionStatus>> {
    // polls الـ ٤ ثواني من كذا عميل/مصدر لحظيًا تشترك في نتيجة واحدة
    return this.dedup("statuses", async () => {
      const statuses = await this.rawStatuses()
      for (const [sessionId, status] of Object.entries(statuses)) {
        statuses[sessionId] = this.effectiveStatus(sessionId, status)
      }
      return statuses
    })
  }

  // الحالة الخام من OpenCode من غير تعديل الطابور — الـ watchdog محتاجها عشان
  // يفرّق بين "خلص فعلًا" و"خلص مؤقتًا وعندنا طلبات مستنية".
  private async rawStatuses(): Promise<Record<string, SessionStatus>> {
    const [sessions, running] = await Promise.all([
      this.listDirectorySessions(this.selectedProjectDirectory).catch(() => [] as SessionInfo[]),
      this.runningSessionIds(),
    ])
    // `session.active` flags every Task subtask as running on its own, so a
    // root conversation looks idle while its own subtasks work. The running
    // set is mapped back onto the roots the sidebar actually lists, and the
    // children stay out of the map: the contract is one entry per
    // conversation, exactly like /api/session.
    const { roots, rootOf } = sessionRoots(sessions)
    const runningRoots = new Set<string>()
    for (const id of running) {
      runningRoots.add(rootOf.get(id) ?? id)
    }
    const statuses: Record<string, SessionStatus> = {}
    for (const rootId of roots) {
      statuses[rootId] = runningRoots.has(rootId) ? { type: "busy" } : { type: "idle" }
    }
    return statuses
  }

  async activity(lang: ServerLang = "ar"): Promise<ActiveSession[]> {
    const cached = this.activityCache
    if (cached && cached.lang === lang && cached.expiresAt > Date.now()) {
      return cached.value
    }
    // الطلبات المتزامنة من كذا عميل تشترك في نفس الحساب بدل N× fan-out
    return this.dedup(`activity:${lang}`, async () => {
      const value = await this.computeActivity(lang)
      this.activityCache = { expiresAt: Date.now() + ACTIVITY_CACHE_MS, lang, value }
      return value
    })
  }

  // المحادثات الشغالة حاليًا في كل المشاريع — عشان تظهر قدام المستخدم
  // من غير ما يفتح قائمة المشاريع ويدوّر بنفسه
  private async computeActivity(lang: ServerLang = "ar"): Promise<ActiveSession[]> {
    // v2 يكشف الشغال مباشرة عبر session.active — بلا fan-out لكل directory
    // كما في v1. القائمة الشاملة من النداء نفسه.
    const [sessions, running] = await Promise.all([
      this.listAllSessions().catch(() => [] as SessionInfo[]),
      this.runningSessionIds(),
    ])
    if (sessions.length === 0) {
      return []
    }

    // This poll is the source of truth, so use it to reconcile busySessions: when
    // the event stream loses the idle event (dropped stream, locked screen), those
    // sessions stay flagged working in every project forever.
    for (const session of sessions) {
      if (!running.has(session.id)) {
        this.busySessions.delete(session.id)
      }
    }

    // Task subtasks come back in this very list as child sessions, and
    // `session.active` reports each one as running on its own. Counting them
    // would show one conversation as five active rows, so every id collapses
    // onto its root conversation first — both the running poll and the event
    // flags, or a subtask that only the event stream saw would vanish.
    const { roots, rootOf } = sessionRoots(sessions)
    const busyRootIds = new Set<string>()
    for (const id of running) {
      busyRootIds.add(rootOf.get(id) ?? id)
    }
    for (const id of this.busySessions) {
      busyRootIds.add(rootOf.get(id) ?? id)
    }

    const byId = new Map(sessions.map((session) => [session.id, session]))
    const items: ActiveSession[] = []
    for (const rootId of roots) {
      const session = byId.get(rootId)
      const directory = session?.location.directory
      if (!session || !directory) {
        continue
      }
      const raw: SessionStatus = busyRootIds.has(rootId) ? { type: "busy" } : { type: "idle" }
      // نفس حكم /session/status: آخر ردّ خلص فعلًا = جاهزة، حتى لو OpenCode
      // واقف على busy والـ idle ضاع
      const status = this.effectiveStatus(rootId, raw)
      // الـ event stream كمصدر احتياطي: لو حالة الجلسة مش متاحة لسبب ما
      // لكن شفناها شغالة من الأحداث المباشرة
      const busy = status.type === "busy" || status.type === "retry" || this.busySessions.has(rootId)
      if (!busy) {
        continue
      }
      const projectName = folderName(directory)
      items.push({
        id: rootId,
        title: stripMobileSuffix(session.title || "") || serverMessage("newConversation", lang),
        directory,
        worktree: directory,
        projectName,
        status,
        updatedAt: session.time.updated,
      })
    }
    return items.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  // مشاريع محادثات معيّنة بالـ ids — بيتستعملوا لنسب المثبّتات القديمة اللي
  // ماتسجّلتش لها مسار لمشروعها. طلب واحد مهما كان العدد، وأي فشل (أو جلسة
  // مش موجودة) بيرجّعها مش موجودة والمثبّتة بتفضل متسجّلة زي ما هي.
  async sessionProjects(ids: string[]): Promise<Map<string, { worktree: string; projectName: string }>> {
    const wanted = new Set(ids.filter(Boolean))
    const found = new Map<string, { worktree: string; projectName: string }>()
    if (wanted.size === 0) {
      return found
    }
    const sessions = await this.listAllSessions().catch(() => [] as SessionInfo[])
    for (const session of sessions) {
      if (!wanted.has(session.id)) {
        continue
      }
      const directory = session.location.directory
      if (!directory) {
        continue
      }
      const projectName = folderName(directory)
      found.set(session.id, { worktree: directory, projectName })
    }
    return found
  }

  // كتالوج الموديلات + خريطة variants من نداء واحد: القائمة بطيئة
  // ومتتكررة، فالكاش المشترك يمنع الجلب المزدوج (كتالوج + variants).
  private async modelCatalog(): Promise<{ map: Map<string, string[]>; items: Array<{
    id: string
    modelID: string
    providerID: string
    name: string
    cost: Array<{ input: number; output: number; cache: { read: number; write: number } }>
    enabled: boolean
    status: string
    variants: string[] | undefined
  }> }> {
    const directory = this.selectedProjectDirectory
    const cached = this.variantsCache
    if (cached && cached.directory === directory && cached.expiresAt > Date.now()) {
      return { map: cached.map, items: cached.items }
    }
    const map = new Map<string, string[]>()
    const items: Array<{
      id: string
      modelID: string
      providerID: string
      name: string
      cost: Array<{ input: number; output: number; cache: { read: number; write: number } }>
      enabled: boolean
      status: string
      variants: string[] | undefined
    }> = []
    try {
      const response = await this.requireClient().model.list({ location: this.location(directory) })
      for (const model of response.data) {
        const ids = variantIds(model.variants)
        if (ids) {
          map.set(`${model.providerID}/${model.modelID}`, ids)
        }
        items.push({
          id: model.modelID,
          modelID: model.modelID,
          providerID: model.providerID,
          name: model.name || model.modelID,
          cost: model.cost.map((tier) => ({
            input: tier.input,
            output: tier.output,
            cache: { read: tier.cache.read, write: tier.cache.write },
          })),
          enabled: model.enabled,
          status: model.status,
          variants: variantIds(model.variants),
        })
      }
      this.variantsCache = { directory, expiresAt: Date.now() + VARIANTS_CACHE_MS, map, items }
    } catch (error) {
      console.error("model catalog failed", errorMessage(error))
    }
    return { map, items }
  }

  async models(): Promise<ModelInfo[]> {
    const directory = this.selectedProjectDirectory
    const cached = this.modelsCache
    if (cached && cached.directory === directory && cached.expiresAt > Date.now()) {
      return cached.value
    }
    return this.dedup(`models:${directory}`, async () => {
      const value = await this.computeModels()
      this.modelsCache = { expiresAt: Date.now() + MODELS_CACHE_MS, directory, value }
      return value
    })
  }

  private async computeModels(): Promise<ModelInfo[]> {
    const { map: variantMap, items: catalog } = await this.modelCatalog()
    // الـ variants تُرتَّب بترتيب معروف (من الأقل للأعلى) عشان العرض يبقى ثابت.
    const withVariants = (infos: ModelInfo[]): ModelInfo[] => infos.map((info) => {
      const fromProvider = info.variants && info.variants.length > 0 ? info.variants : variantMap.get(`${info.providerID}/${info.id}`)
      const variants = fromProvider && fromProvider.length > 0 ? sortVariants(fromProvider) : undefined
      return variants ? { ...info, variants } : info
    })

    // النشطة فقط من الـ providers (activation بدل disabled في v1)
    let activeProviders: Set<string> | null = null
    try {
      const providers = await this.requireClient().provider.list({ location: this.location() })
      activeProviders = new Set(
        providers.data.filter((provider) => provider.activation !== "disabled").map((provider) => provider.id),
      )
    } catch (error) {
      console.error("provider list failed, showing catalog without provider filter", errorMessage(error))
    }

    return withVariants(
      catalog
        .filter((model) => !activeProviders || activeProviders.has(model.providerID))
        .map((model) => ({
          id: model.id,
          providerID: model.providerID,
          name: model.name,
          free: model.cost.length > 0 && model.cost.every((tier) => isFreeCost(tier.input, tier.output, tier.cache.read, tier.cache.write)),
          enabled: model.enabled,
          status: model.status,
          variants: model.variants,
        }) satisfies ModelInfo)
        .sort((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id)),
    )
  }

  async sessionModel(id: string): Promise<{ model: SessionModelRef | null; defaultModel: SessionModelRef | null }> {
    let model: SessionModelRef | null = null
    try {
      const session = await this.requireClient().session.get({ sessionID: id })
      const ref = session.model
      if (ref) {
        model = { providerID: ref.providerID, modelID: ref.id, ...(ref.variant ? { variant: ref.variant } : {}) }
      }
    } catch (error) {
      console.error("session get model failed", errorMessage(error))
    }

    let defaultModel: SessionModelRef | null = null
    try {
      const entries = await this.requireClient().config.get({ location: this.location() })
      for (const entry of entries) {
        if (entry.type !== "document") {
          continue
        }
        const parsed = parseModelString(typeof entry.info.model === "string" ? entry.info.model : undefined)
        if (parsed) {
          defaultModel = parsed
          break
        }
      }
    } catch {
      // تجاهل — الـ default اختياري
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
    await this.requireClient().session.switchModel({
      sessionID: id,
      model: { id: cleanModel, providerID: cleanProvider, ...(cleanVariant ? { variant: cleanVariant } : {}) },
    })
    return { providerID: cleanProvider, modelID: cleanModel, ...(cleanVariant ? { variant: cleanVariant } : {}) }
  }

  // v2 يستبدل الأسئلة باستمارات (forms): كل حقل سؤال، وخياراته options،
  // والـ multiselect هو الـ multiple. العنوان title يُعرض فوق الحقول.
  private mapFormRequest(form: FormInfo): ConversationQuestionRequest {
    return {
      id: form.id,
      sessionID: form.sessionID,
      questions: form.fields.map((field) => {
        const kind = field as { title?: string; key: string; description?: string; options?: Array<{ value: string; label: string; description?: string }>; custom?: boolean }
        return {
          question: typeof kind.title === "string" && kind.title ? kind.title : form.title,
          header: kind.key,
          options: Array.isArray(kind.options)
            ? kind.options.map((option) => ({ label: option.label || option.value, description: option.description || "" }))
            : [],
          multiple: field.type === "multiselect",
          custom: kind.custom === true,
        }
      }),
    }
  }

  private normalizeFormAnswers(form: FormInfo, answers: unknown): Record<string, string | number | boolean | string[]> {
    if (!Array.isArray(answers) || answers.length !== form.fields.length) {
      throw new Error("Answers do not match questions")
    }
    const normalized: Record<string, string | number | boolean | string[]> = {}
    form.fields.forEach((field, index) => {
      const selected = answers[index]
      const values = Array.isArray(selected)
        ? [...new Set(selected.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))]
        : []
      if (field.type === "multiselect") {
        if (values.length === 0) {
          throw new Error("Select at least one option")
        }
        normalized[field.key] = values
        return
      }
      if (field.type === "boolean") {
        const raw = Array.isArray(selected) ? selected[0] : selected
        normalized[field.key] = raw === true || raw === "true"
        return
      }
      if (values.length !== 1 || !values[0]) {
        throw new Error("Select one option")
      }
      normalized[field.key] = values[0] as string
    })
    return normalized
  }

  // قوائم الأسئلة بتتقرأ مع كل poll للـ requests: كاش قصير لكل جلسة
  // يمتص التكرار، وبيتبطل مع أحداث الاستمارات أو بعد الرد/الرفض مباشرة
  private async listForms(sessionId: string): Promise<FormInfo[]> {
    const cached = this.questionsCache.get(sessionId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
    return this.dedup(`questions:${sessionId}`, async () => {
      const value = await this.requireClient().session.form.list({ sessionID: sessionId })
      this.questionsCache.set(sessionId, { expiresAt: Date.now() + QUESTIONS_CACHE_MS, value })
      return value
    })
  }

  async sessionQuestions(id: string): Promise<ConversationQuestionRequest[]> {
    const forms = await this.listForms(id)
    return forms.map((form) => this.mapFormRequest(form))
  }

  async replyQuestion(sessionId: string, requestId: string, answers: unknown): Promise<boolean> {
    const forms = await this.listForms(sessionId)
    const form = forms.find((candidate) => candidate.id === requestId)
    if (!form || form.sessionID !== sessionId) {
      throw new Error("Question not found")
    }
    const answer = this.normalizeFormAnswers(form, answers)
    await this.requireClient().session.form.reply({ sessionID: sessionId, formID: requestId, answer })
    // الرد غيّر حالة الأسئلة — ابطل الكاش فورًا عشان الـ poll الجاي يشوفها
    this.questionsCache.delete(sessionId)
    return true
  }

  async rejectQuestion(sessionId: string, requestId: string): Promise<boolean> {
    const forms = await this.listForms(sessionId)
    const form = forms.find((candidate) => candidate.id === requestId)
    if (!form || form.sessionID !== sessionId) {
      throw new Error("Question not found")
    }
    await this.requireClient().session.form.cancel({ sessionID: sessionId, formID: requestId })
    this.questionsCache.delete(sessionId)
    return true
  }

  async diff(id: string): Promise<FileDiffInfo[]> {
    const files = await this.requireClient().session.diff({ sessionID: id })
    return files.map((file) => ({
      file: file.file,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
    }))
  }

  // حالة git للمشروع الحالي: الملفات المتغيّرة + اسم الفرع.
  // لو المشروع مش مستودع git، بنرجّع available=false بدل ما نرمي خطأ.
  async gitChanges(): Promise<GitChanges> {
    const location = this.location()

    let statusFiles: Array<{ file: string; additions: number; deletions: number; status: "added" | "deleted" | "modified" }>
    try {
      const response = await this.requireClient().vcs.status({ location })
      statusFiles = response.data
    } catch {
      return { branch: "", available: false, files: [] }
    }

    let branch = ""
    try {
      const info = await this.requireClient().vcs.get({ location })
      const current = info.data.branch.current
      if (typeof current === "string") {
        branch = current
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
    await this.requireClient().permission.reply({ sessionID: id, requestID: permissionId, decision: response })

    this.pendingPermissions.delete(permissionId)
    return true
  }

  permissions(): EnginePermission[] {
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
    this.inflight.clear()
    this.questionsCache.clear()
    this.activityCache = null
    this.modelsCache = null
    this.pendingPermissions.clear()
    this.busySessions.clear()
    this.finishedRuns.clear()
    this.client = null
    this.listeners.clear()
  }
}
