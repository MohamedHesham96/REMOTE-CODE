import { existsSync, readFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename as pathBasename, isAbsolute, resolve } from "node:path"
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client"
import { Service } from "@opencode/client/service"
import type {
  FormInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode/client"
import { setTimeout as sleep } from "node:timers/promises"
import { ensureLocalEndpoint } from "./opencode/service-launch.js"
import { findActiveTool, toolActivity, toolSignature, usedToolActivities } from "./opencode/activity.js"
import { unpushedCommitCount } from "./opencode/git-ahead.js"
import { collectResultFiles } from "./opencode/result-files.js"
import { consoleLang, serverMessage, type ServerLang } from "./i18n.js"
import type {
  ActiveSession,
  ConversationQuestionRequest,
  EnginePermission,
  GitChanges,
  HistoryTurn,
  ModelInfo,
  Project,
  PromptAttachment,
  RequestAttachment,
  RequestState,
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
  MAX_TRACKED_ROOTS,
  mimeFromName,
  MODELS_CACHE_MS,
  parseModelString,
  parseStaticCatalog,
  parseCliVersion,
  PROMPT_DISPATCH_TIMEOUT_MS,
  QUEUED_ID_PREFIX,
  queuedItemId,
  QUESTIONS_CACHE_MS,
  sessionRoots,
  sortVariants,
  STATIC_CATALOG_CACHE_MS,
  STALE_BUSY_GRACE_MS,
  STATIC_CATALOG_RETRY_MS,
  STATIC_CATALOG_TIMEOUT_MS,
  STATIC_CATALOG_URL,
  stripMobileSuffix,
  titleFromUserText,
  variantIds,
  VARIANTS_CACHE_MS,
  withTimeout,
} from "./opencode/utils.js"

// نص مُرمَّز داخلي مش نص للمستخدم — الراوت بيمرّره لـ serverMessage
// ليترجم حسب لغة الطلب، فـ opencode.ts ما فيهوش نصوص مترجمة.
// الترجمة مكانها server/i18n.ts مع باقي رسائل العقد.
const MODEL_PROVIDER_NOT_CONNECTED = "MODEL_PROVIDER_NOT_CONNECTED"
const MAX_CACHED_QUESTION_SESSIONS = 64

interface MobileSessionFile {
  sessions: string[]
}

type EventListener = (event: OpenCodeEvent) => void | Promise<void>

interface QueuedPrompt {
  id: string
  text: string
  agent?: string
  model?: SessionModelRef
  // مرفقات الطلب (صور/ملفات) بتروح مع الـ prompt نفسه لحظة تنفيذه
  attachments?: PromptAttachment[]
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
  // مرفقات رسالة المستخدم (الصور/الملفات) — بتتخزّن عشان الواجهة تعرضها في
  // الطلب، لأن المحرك بيحفظها على رسالة المستخدم نفسها.
  attachments: RequestAttachment[]
}

export class OpenCodeService {
  private client: OpenCodeClient | null = null
  private selectedProjectDirectory: string
  private selectedProjectId: string | null = null
  private readonly abortController = new AbortController()
  private readonly listeners = new Set<EventListener>()
  private readonly busySessions = new Set<string>()
  // جذر كل جلسة ابن: مهمة Task بتيجي كجلسة جديدة ومعها `parentID` على
  // السلك، فنقدر نعرف أمها من لحظة وجودها من غير ما نستنى استعلام. الخريطة
  // بتتمسح بـ `session.deleted` بس — فلو مهام فرعية اتعملت من بعد ما
  // اتصلنا (أو ضاعت منها أحداث) قايمة الجلسات بترجّعها وترنسدها تاني.
  private readonly rootBySession = new Map<string, string>()
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
  // الطوابق اللي المستخدم تخطّاها بإيده، لكل جلسة. المحرك بيقفل رسالة الطلب
  // المُتخطّى كأنها خلصت (time.completed بيتسجّل)، فبدون التتبّع ده كان الطلب
  // يبان "تمت" بينما هو ما خلصش. مفتاحها الجلسة والقيمة معرّفات طوابق المستخدم.
  private readonly skippedTurns = new Map<string, Set<string>>()
  private promptSeq = 0
  private queueWatchdog: NodeJS.Timeout | null = null
  private readonly pendingPermissions = new Map<string, EnginePermission>()
  // عدّاد زيادات الأذونات: أي add/delete بيرفعها ببطء. ده نسخة بسيطة لكنها
  // كافية للـ ETag لأن الإضافات/الإزافات نادرة. الزيادات الكبيرة (مثلاً
  // 10 إضافات في ثانية) بتنتج ETag مختلف في كل واحدة، وده مرغوب — العميل
  // يحدّث فورًا ولا يخدم ببيانات قديمة.
  private permissionsVersion = 0
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
      capabilities: { input: string[] }
    }>
  } | null = null
  // إلغاء تكرار الطلبات المتزامنة: نفس المورد المطلوب لحظيًا يشارك promise واحدة
  private readonly inflight = new Map<string, Promise<unknown>>()
  // كاش النشاط قصير المدى ( Issue: fan-out كل ٤ ثواني لكل عميل )
  private activityCache: { expiresAt: number; lang: ServerLang; value: ActiveSession[] } | null = null
  // كاش الموديلات الكامل + قوائم الأسئلة لكل جلسة
  private modelsCache: { expiresAt: number; directory: string; value: ModelInfo[] } | null = null
  // كتالوج models.dev العام — بلا directory لأنه مستقل عن المشروع
  private staticCatalogCache: { expiresAt: number; value: ModelInfo[] } | null = null
  // حدّ أقصى لقوائم الاستمارات المحتفظ بها حتى لا تتراكم مع فتح محادثات كثيرة.
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

  // المسار اللي بنمرّره للمحرك لازم يطابق الصيغة القانونية (canonical) المسجّلة
  // عنده؛ وإلا الجلسة تتخزّن بمفتاح مسار مختلف (`\` مقابل `/` أو حالة حرف
  // القرص على ويندوز) فتفضل موجودة في نفس القاعدة لكن مخفية من قوائم العميل
  // الآخر (الديسكتوب) لأن مطابقة المسار حساسة للشكل. بنرجّع canonical لو
  // المشروع مسجّل، وإلا المسار كما هو قبل أول تسجيل.
  private async canonicalDirectory(directory: string): Promise<string> {
    try {
      const registered = await this.requireClient().project.list()
      const match = registered.find((project) => directoryKey(project.canonical) === directoryKey(directory))
      return match?.canonical ?? directory
    } catch {
      // فشل السجل يبقي المسار كما هو — أفضل من تعطيل الإنشاء
      return directory
    }
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
    // المسار الافتراضي (`OPENCODE_PROJECT_DIR`) يُوحّد مع الصيغة القانونية
    // للمحرك فور الاتصال، فأي نداء لاحق — قوائم المشاريع/الجلسات والإنشاء
    // والإعداد — يستخدم نفس المفتاح بدل نسخة شكلية مختلفة تخفي الجلسات عن
    // العملاء الآخرين (نفس علة مطابقة المسار على ويندوز).
    this.selectedProjectDirectory = await this.canonicalDirectory(this.selectedProjectDirectory)
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
          await Promise.all(Array.from(this.listeners, (listener) => listener(event)))
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
      || eventType === "session.execution.started"
      || eventType === "session.execution.succeeded"
      || eventType === "session.execution.interrupted"
      || eventType === "session.execution.failed"
      || eventType === "session.created"
      || eventType === "session.renamed"
      || eventType === "session.moved"
      || eventType === "session.deleted"
    ) {
      this.activityCache = null
    }
    // مهمة Task بتفتح جلسة ابن ومعها `parentID` — وده أرخص وأسرع مصدر
    // لخريطة الجذور: الحدث نفسه بييجي قبل أي حالة شغل بتاعة الجلسة دي،
    // فنعرف أمها من غير ما نستنى استعلام قوائم الجلسات.
    if (eventType === "session.created") {
      const created = event.data as { sessionID?: unknown; parentID?: unknown } | undefined
      if (typeof created?.sessionID === "string" && typeof created.parentID === "string") {
        this.rememberRoot(created.sessionID, created.parentID)
      }
    }

    if (eventType === "session.deleted") {
      const deleted = event.data as { sessionID?: unknown } | undefined
      if (typeof deleted?.sessionID === "string") {
        this.rootBySession.delete(deleted.sessionID)
      }
    }

    // أحداث الاستمارات (أسئلة المستخدم) تبطل كاش أسئلة جلستها والنداء الجاري
    // كذلك. `form.created` بيحط الجلسة جوه `data.form` مش فوق، فلازم نقراها
    // من المكانين وإلا الإبطال يقع على الكاش كله ويخلّي النداء القديم يعيد
    // تخزين نتيجة فاضية بعد الإبطال.
    if (eventType === "form.created" || eventType === "form.replied" || eventType === "form.cancelled") {
      const data = event.data as { sessionID?: unknown; form?: { sessionID?: unknown } } | undefined
      const sessionId = typeof data?.sessionID === "string"
        ? data.sessionID
        : typeof data?.form?.sessionID === "string" ? data.form.sessionID : undefined
      this.invalidateQuestions(sessionId)
    }
    if (eventType === "permission.asked") {
      const data = event.data as unknown as { id: string; sessionID: string; action: string; resources: string[]; message?: unknown }
      this.pendingPermissions.set(data.id, {
        id: data.id,
        sessionID: data.sessionID,
        title: typeof data.message === "string" && data.message.trim() ? data.message : data.action,
        pattern: data.resources.join(", "),
      })
      this.permissionsVersion += 1
    }

    if (eventType === "permission.replied") {
      const replied = event.data as unknown as { requestID: string }
      if (this.pendingPermissions.delete(replied.requestID)) {
        this.permissionsVersion += 1
      }
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

    if (
      eventType === "session.execution.failed"
      || eventType === "session.execution.succeeded"
      || eventType === "session.execution.interrupted"
    ) {
      // نهاية التنفيذ (فشل أو نجاح أو إيقاف) بتقفل الشغل من غير ما يضمن وصول
      // حدث idle بعدها، فبنحرّر الجلسة هنا بالظبط زي حدث الـ idle: من غيرها
      // كانت تفضل متسجّلة "شغّال" في قائمة المحادثات النشطة، والطابور يستنى
      // الـ watchdog بدل ما يبعت الطلب اللي بعده فورًا.
      const finished = event.data as unknown as { sessionID?: string }
      const sessionId = finished.sessionID
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

  // نفس خريطة `sessionRoots` بتتسجّل عندنا كمان، عشان جسر الأحداث ياخد
  // خريطة الجذور من نفس المصدر: مهمة فرعية اتعملت قبل ما السيرفر يتصل
  // (أو ضاع منها حدث الإنشاء) ماتبقاش جذر لنفسها فيتحوّل صوت الإتمام
  // لمحادثة مستقلة. مهمة جو مهمة `sessionRoots` بتجمعها على نفس الجذر
  // فبنخزّن الجذر النهائي مباشرةً.
  private rememberRoots(rootOf: Map<string, string>): void {
    for (const [sessionId, root] of rootOf) {
      if (sessionId !== root) {
        this.rememberRoot(sessionId, root)
      }
    }
  }

  private rememberRoot(sessionId: string, root: string): void {
    // إعادة الكتابة بتحدّث ترتيب الإدراج فالعنصر المتحرّك بيفضل حيّ —
    // فالسقف بيمسح المهمة الأقدم اللي عمرها ما اتشالت بـ session.deleted.
    if (this.rootBySession.size >= MAX_TRACKED_ROOTS && !this.rootBySession.has(sessionId)) {
      const oldest = this.rootBySession.keys().next()
      if (!oldest.done) {
        this.rootBySession.delete(oldest.value)
      }
    }
    this.rootBySession.set(sessionId, root)
  }

  // جذر أي جلسة: هي نفسها لو محادثة، أو محادثتها الأم لو مهمة فرعية.
  // الصعود بيتكرّر (مهمة جو مهمة) مع حدّ ضد الحلقات، بنفس منطق sessionRoots.
  conversationOf(sessionId: string): string {
    let root = sessionId
    const seen = new Set<string>([root])
    let parent = this.rootBySession.get(root)
    while (parent && !seen.has(parent)) {
      seen.add(parent)
      root = parent
      parent = this.rootBySession.get(root)
    }
    return root
  }

  // فيه أي جلسة في شجرة الجذر دي شغّالة حالًا؟ الجذر نفسه أو أي مهمة فرعية
  // من مهامه. لازم الشغل يكون على مستوى المحادثة لا الجلسة: مهمة فرعية
  // بتخلص ما تعنيش إن المحادثة خلصت طول ما تانية شغّالة.
  conversationBusy(sessionId: string): boolean {
    const root = this.conversationOf(sessionId)
    if (this.busySessions.has(root)) {
      return true
    }
    for (const busy of this.busySessions) {
      if (this.conversationOf(busy) === root) {
        return true
      }
    }
    return false
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
    const [registered, sessions] = await Promise.all([
      (async () => {
        try {
          return await this.requireClient().project.list()
        } catch {
          return []
        }
      })(),
      this.listAllSessions().catch(() => [] as SessionInfo[]),
    ])
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

  // بياخد قائمة المشاريع الجاهزة اختياريًا عشان /api/project ما يحسبش
  // `projects()` مرتين في نفس الطلب (كل نداء بيقرأ السجل وكل الجلسات). القيمة
  // الجاهزة هي نفسها اللي كان هيرجّعها `projects()` — فالناتج متطابق.
  async selectedProject(prefetched?: Project[]): Promise<Project | null> {
    if (!this.selectedProjectId && this.selectedProjectDirectory === this.options.projectDirectory) {
      return null
    }
    const projects = prefetched ?? await this.projects()
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
    // مع كل نداء — فلا تسجيل ولا تبديل على مستوى المحرك. ونحوّل المسار
    // لصيغته القانونية عشان الجلسات الجديدة تتخزّن بمفتاح يطابق باقي العملاء.
    this.selectedProjectId = project.id
    this.selectedProjectDirectory = await this.canonicalDirectory(project.worktree)
    return project
  }

  // الجذور وحدها: مهمة Task جلسات ابن بتتجمّع في محادثتها الأم، والمستخدم
  // بيشوف محادثة واحدة مش خمس — نفس اللي بيعمله الديسكتوب (`!e.parentID`).
  async sessions(): Promise<Session[]> {
    const listed = await this.listDirectorySessions(this.selectedProjectDirectory)
    const { roots, rootOf } = sessionRoots(listed)
    this.rememberRoots(rootOf)
    const rootIds = new Set(roots)
    return listed.filter((session) => rootIds.has(session.id)).map((session) => this.toSession(session))
  }

  async createSession(title?: string, mobile = false): Promise<Session> {
    // Create without a custom title when the title is empty/default so that
    // OpenCode's native auto-title (based on the first message) can run,
    // just like on desktop. A custom title would make native generation skip.
    const cleanTitle = stripMobileSuffix((title || "").trim())
    const useTitle = cleanTitle && !isDefaultTitle(cleanTitle) ? cleanTitle : undefined
    // نحسم المسار القانوني هنا كذلك: لو فشل التوحيد عند الاتصال (سجل متعطّل
    // لحظيًا) تبقى الجلسة الأولى الجديدة هي فرصة التصحيح قبل الكتابة.
    const directory = await this.canonicalDirectory(this.selectedProjectDirectory)
    this.selectedProjectDirectory = directory
    const created = await this.requireClient().session.create({
      ...(useTitle ? { title: useTitle } : {}),
      location: this.location(directory),
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
    this.skippedTurns.delete(id)
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
          attachments: this.turnAttachments(entry),
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

  // مرفقات رسالة المستخدم بصيغة الواجهة. `uri` جاهز للعرض: المصدر `uri`
  // (رابط data:) بيُستخدم كما هو، والمصدر `inline` (base64 خام) نبني منه
  // data URI من النوع المخزّن. الاسم بييجي من `name` وإلا من آخر مقطع في
  // الرابط، واسم احتياطي ثابت لو مفيش أي منهما عشان الصف ميطلعش فاضيًا.
  private turnAttachments(entry: SessionMessageUser): RequestAttachment[] {
    const attachments: RequestAttachment[] = []
    for (const file of entry.files ?? []) {
      const mime = (file.mime || "application/octet-stream").trim()
      const uri = file.source.type === "uri"
        ? file.source.uri
        : `data:${mime};base64,${file.data}`
      const fromUri = file.source.type === "uri" ? fileNameFromPath(file.source.uri, "") : ""
      const name = (file.name || fromUri || "attachment").trim()
      attachments.push({ name, mime, uri })
    }
    return attachments
  }

  async history(id: string, lang: ServerLang = "ar"): Promise<HistoryTurn[]> {
    const turns = this.turns(await this.messages(id))

    const withIndex = turns.map((turn, position) => ({
      id: turn.id || `turn-${position + 1}`,
      index: position + 1,
      prompt: turn.prompt,
      finalResult: turn.texts.join("\n\n"),
      createdAt: turn.createdAt,
      steps: turn.steps,
      files: collectResultFiles(id, turn.entries, lang, this.selectedProjectDirectory),
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
    // طوابق اتخطّاها المستخدم في الجلسة دي — بتُعرض حالتها "متخطّى" بدل "تمت".
    const skippedForSession = this.skippedTurns.get(id)
    // بصمة التقدّم: أي حراك مرئي (رسالة/إتمام/نص/طابور/سؤال) يغيّرها.
    // الطول التراكمي للنصوص يلتقط نمو الـ live text حتى لو الأوقات لم تتغير.
    // الطابور الفاضي شرط الأهلية: رسائل المستخدم ملكه فممنوع المساس بها هنا.
    // والسؤال/الإذن المعلّق انتظار مشروع للمستخدم (كارت ظاهر) مش جمود.
    // (v2 بلا قائمة مهام، فلا todos في البصمة ولا في الكروت.)
    const turnSig = turns
      .map((turn) => {
        let textLength = 0
        for (const text of turn.texts) {
          textLength += text.length
        }
        return `${turn.updatedAt}:${turn.completedAt}:${textLength}:${toolSignature(turn.entries)}`
      })
      .join(";")
    const sharedTail = [
      turns.length,
      turnSig,
      queue.map((item) => item.id).join(","),
      questions.map((question) => question.id).join(","),
      // التخطّي جزء من بصمة الحالة: علامة الطلب المتخطّى بتظهر لحظة الإيقاف،
      // فبدونها الـ ETag ما كانش يتغيّر والكارت يفضل يخدم بيانات قديمة.
      [...(skippedForSession ?? [])].join(","),
    ].join("|")
    let waitingOnUser = questions.length > 0
    if (!waitingOnUser) {
      for (const permission of this.pendingPermissions.values()) {
        if (permission.sessionID === id) {
          waitingOnUser = true
          break
        }
      }
    }
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
      let currentAssistant: SessionMessageAssistant | undefined
      let completedAssistant: SessionMessageAssistant | undefined
      for (let entryIndex = turn.entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
        const entry = turn.entries[entryIndex]
        if (!entry) {
          continue
        }
        if (entry.time.completed === undefined && !currentAssistant) {
          currentAssistant = entry
        } else if (entry.time.completed !== undefined && !completedAssistant) {
          completedAssistant = entry
        }
        if (currentAssistant && completedAssistant) {
          break
        }
      }
      const activeTool = findActiveTool(currentAssistant)

      let activity = serverMessage("taskReady", lang)
      if (running) {
        if (status.type === "retry") {
          activity = serverMessage("retryingNow", lang)
        } else if (activeTool) {
          activity = toolActivity(activeTool, lang)
        } else {
          activity = serverMessage("workingOnTask", lang)
        }
      }

      // طلب اتوقف في نصه (إيدوي أو خطأ): مقدّم رسائل بس مفيش ولا رد مكتمل.
      // والمتخطّى قرار المستخدم: بيتقدّم على "تمت" لأن المحرك بيقفل رسالته
      // كأنها خلصت فعلًا، والتمييز هنا هو الفرق بين خلوص حقيقي وتخطٍّ مقصود.
      const state: RequestState = running
        ? "running"
        : skippedForSession?.has(turn.id)
          ? "skipped"
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
        usedTools: usedToolActivities(turn.entries, lang),
        resultFiles: collectResultFiles(id, turn.entries, lang, this.selectedProjectDirectory),
        attachments: turn.attachments,
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
        usedTools: [],
        resultFiles: [],
        attachments: (item.attachments ?? []).map((attachment) => ({
          name: attachment.name || "attachment",
          mime: attachment.uri.startsWith("data:") ? attachment.uri.slice(5).split(/[;,]/)[0] || "application/octet-stream" : mimeFromName(attachment.name || "", "application/octet-stream"),
          uri: attachment.uri,
        })),
        startedAt: item.queuedAt,
        completedAt: 0,
        updatedAt: item.queuedAt,
      })
    }

    // حكم الجمود المُثبت (كاشف الجمود شاف بصمة ثابتة فوق BUSY_STALL_MS) —
    // بيتبعت للعميل صريح عشان يعرض "متجمّدة" بدل ما يستنتج الجمود من
    // صمت. effectiveStatus فوق بيحوّل busy لـ idle لما الجلسة محرّرة بالجمود،
    // فبدون الحقل ده المهمة المجمّدة كانت هتبان "خلصت" مش "واقفة".
    const stalled = this.stalledSessions.has(id)

    // بصمة الحالة (ETag): نفس مكوّنات بصمة الجمود لكن بنوع الحالة الفعّالة،
    // فأي تغيير مرئي يغيّرها والعميل يوفّر إعادة التحميل (304) لما مفيش جديد.
    // حكم الجمود جزء من البصمة: ثباته على busy مع نفي التقدّم هو اللي
    // يخلي الكارت يقلب لـ "متجمّدة" من غير ما ينتظر تغيّر تاني.
    const version = [status.type, stalled ? "stalled" : "live", sharedTail].join("|")

    return { status, requests, questions, queued: queue.length, stalled, version }
  }

  private assistantText(entry: SessionMessageAssistant): string {
    return entry.content
      .filter((part): part is Extract<SessionMessageAssistant["content"][number], { type: "text" }> =>
        part.type === "text" && part.text.trim().length > 0)
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
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
  async prompt(id: string, text: string, agent?: string, model?: SessionModelRef, attachments?: PromptAttachment[]): Promise<{ queued: boolean }> {
    const item: QueuedPrompt = {
      id: `q${++this.promptSeq}`,
      text,
      ...(agent ? { agent } : {}),
      ...(model?.providerID && model?.modelID ? { model } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
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

  // `delivery` بيحدد مصير الرسالة عند OpenCode: "steer" بيحقنها جوه التنفيذ
  // الجاري فبيقراها في نفس المهمة من غير مقاطعة، و"queue" بيسيبها في صندوق
  // الجلسة لحد ما الشغل الحالي يخلص. غيابه = السلوك الافتراضي للسيرفر (اللي
  // بنعتمد عليه لطابورنا المحلي: بنبعت طلب واحد بس وكل واحد مستقل).
  private async dispatchPrompt(id: string, item: QueuedPrompt, delivery?: "steer" | "queue"): Promise<void> {
    // سقف زمني بدل الانتظار الأبدي: لو OpenCode معلّق والـ HTTP ما استقرّش،
    // الـ catch في pumpQueue يعيد الطلب أو يسقطه بعد MAX_PROMPT_ATTEMPTS،
    // بدل ما runningSessions يتجمّد والكارت يفضل "شغّال" للأبد.
    // v2 يقبل النص فقط في prompt — الوكيل والموديل يُضبطان على الجلسة
    // أولًا (كما كان v1 يفعل ضمنيًا مع كل طلب). المرفقات بتروح مع النص في
    // نفس النداء كـ `files` بصيغة OpenCode (رابط data: مضمّن + اسم).
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
        const files = item.attachments?.map((attachment) => ({
          uri: attachment.uri,
          ...(attachment.name ? { name: attachment.name } : {}),
        }))
        await this.requireClient().session.prompt({
          sessionID: id,
          text: item.text,
          ...(files && files.length > 0 ? { files } : {}),
          ...(delivery ? { delivery } : {}),
        })
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
    // الطلب اللي هيتخطّى هو آخر طابق في رسائل المحرك (المستنيين في طابورنا
    // إحنا مش رسائل عنده)، فنسجّل معرّفه قبل الإيقاف عشان نفضل نعرضه "متخطّى"
    // بدل "تمت" بعد ما المحرك يقفل رسالته.
    const skippedTurnId = await this.openTurnId(id)
    let skipped = false
    try {
      skipped = (await this.requireClient().session.interrupt({ sessionID: id })).interrupted
    } finally {
      if (skipped && skippedTurnId) {
        this.rememberSkippedTurn(id, skippedTurnId)
      }
      this.skippingSessions.delete(id)
      this.pumpQueue(id)
    }
    // بعد ما الطلب اللي بعده اتبعث، فـ remaining بتعد اللي فاضل في الطابور فعلًا
    return { skipped, remaining: this.promptQueues.get(id)?.length ?? 0 }
  }

  // معرّف آخر طابق (طلب مستخدم) في الجلسة، أو null لو تعذّر الجلب. بيتنادى
  // لحظة التخطّي قبل ما الإيقاف يقفل الطابق المفتوح.
  private async openTurnId(sessionId: string): Promise<string | null> {
    try {
      const turns = this.turns(await this.messages(sessionId))
      return turns[turns.length - 1]?.id ?? null
    } catch {
      return null
    }
  }

  private rememberSkippedTurn(sessionId: string, turnId: string): void {
    const existing = this.skippedTurns.get(sessionId)
    if (existing) {
      existing.add(turnId)
      return
    }
    this.skippedTurns.set(sessionId, new Set([turnId]))
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

  // تنفيذ طلب مستني حالًا من غير مقاطعة الشغل الجاري: لو فيه مهمة شغّالة
  // بنحقن الطلب جواها كتوجيه (steer) فيقراه OpenCode في نفس المهمة؛ ولو
  // مفيش حاجة شغّالة بنبعته على طول من الطابور. الزرار ده ما يوقفش OpenCode
  // أبدًا — الفرق الوحيد إن المستني بيتحوّل "شغل جوه المهمة الحالية" أو
  // "المهمة اللي بعدها".
  async runQueued(id: string, requestId: string): Promise<{ started: boolean; steered: boolean; queued: boolean; remaining: number }> {
    const queue = this.promptQueues.get(id)
    const target = queuedItemId(requestId)
    const index = queue ? queue.findIndex((item) => item.id === target) : -1
    const item = index < 0 ? undefined : queue?.splice(index, 1)[0]
    if (!queue || !item) {
      return { started: false, steered: false, queued: false, remaining: queue?.length ?? 0 }
    }
    const left = (): number => this.promptQueues.get(id)?.length ?? 0

    // "شغّال" = إما طلب بعتناه وإحنا مستنيين الـ idle، أو OpenCode نفسه busy
    // (مهمة اتبدأت من برّه، زي تطبيق الديسكتوب). الاتنين معناهم إن فيه تنفيذ
    // جاري ينفع نحقن جواه.
    if (!this.runningSessions.has(id) && !this.busySessions.has(id)) {
      // مفيش حاجة شغّالة — بنرجّعه أول الطابور وبنبعته على طول
      queue.unshift(item)
      this.promptQueues.set(id, queue)
      const started = this.pumpQueue(id)
      return { started, steered: false, queued: !started, remaining: left() }
    }

    try {
      await this.dispatchPrompt(id, item, "steer")
      // الحقن نشاط جديد ⇒ أحكام "خلص"/"اتجمّد" القديمة بقت ملغية
      this.finishedRuns.delete(id)
      this.stalledSessions.delete(id)
      this.stallWatches.delete(id)
      return { started: false, steered: true, queued: false, remaining: left() }
    } catch (error) {
      // السيرفر رفض الحقن وسط الشغل: منضيعش الطلب — بنرجّعه أول الطابور
      // فيتنفّذ أول ما المهمة الحالية تخلص بدل ما يروح في رسالة خطأ.
      console.error("Unable to steer the queued prompt", errorMessage(error))
      const pending = this.promptQueues.get(id) ?? []
      pending.unshift(item)
      this.promptQueues.set(id, pending)
      return { started: false, steered: false, queued: true, remaining: pending.length }
    }
  }

  // v2 بلا خريطة حالات: `session.active` يرجّع الشغال فعلًا فقط، والباقي
  // خامل حكمًا. نبني نفس الخريطة من قائمة جلسات المجلد + النشطين.
  private async runningSessionIds(): Promise<Set<string>> {
    // نداء session.active واحد بيتطلب من statuses و activity و requests في نفس
    // اللحظة (كل poll ليه مسار)، فبنتشارك نتيجة واحدة بدل N نداءات متطابقة.
    return this.dedup("running-sessions", async () => {
      try {
        const active = await this.requireClient().session.active()
        return new Set(Object.keys(active))
      } catch {
        return new Set(this.busySessions)
      }
    })
  }

  async statuses(): Promise<Record<string, SessionStatus>> {
    // polls الـ ٤ ثواني من كذا عميل/مصدر لحظيًا تشترك في نتيجة واحدة
    return this.dedup("statuses", async () => {
      // نسخة قبل التعديل: rawStatuses بقى مشتركًا (dedup) مع مسارات تانية
      // بتقرا الحالة الخام، فتعديله في مكانه كان هيغيّر حالتها بالغلط.
      const statuses = { ...await this.rawStatuses() }
      for (const [sessionId, status] of Object.entries(statuses)) {
        statuses[sessionId] = this.effectiveStatus(sessionId, status)
      }
      return statuses
    })
  }

  // الحالة الخام من OpenCode من غير تعديل الطابور — الـ watchdog محتاجها عشان
  // يفرّق بين "خلص فعلًا" و"خلص مؤقتًا وعندنا طلبات مستنية".
  // الغلاف بيلغي تكرار النداءات المتزامنة: /requests و /status و /activity
  // كلهم بيقروا نفس الحالة في نفس اللحظة، فنتشارك لقطة واحدة بدل نداءات متطابقة.
  // المفتاح مربوط بالمجلد عشان تبديل المشروع ما يخلطش لقطتين مختلفتين.
  private async rawStatuses(): Promise<Record<string, SessionStatus>> {
    return this.dedup(`raw-statuses:${this.selectedProjectDirectory}`, () => this.computeRawStatuses())
  }

  private async computeRawStatuses(): Promise<Record<string, SessionStatus>> {
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
    this.rememberRoots(rootOf)
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
    this.rememberRoots(rootOf)
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
    capabilities: { input: string[] }
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
      capabilities: { input: string[] }
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
          // نموذج المحرك بيوفر القدرات دايمًا، لكن نتحوّط للكتالوجات القديمة
          capabilities: { input: model.capabilities?.input ?? [] },
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
      const [live, catalog] = await Promise.all([this.computeModels(), this.staticCatalog()])
      const value = this.mergeStaticCatalog(live, catalog)
      this.modelsCache = { expiresAt: Date.now() + MODELS_CACHE_MS, directory, value }
      return value
    })
  }

  // دمج الكتالوج العام فوق نماذج المحرك: الحيّ أولًا (وموجوده يكسب عند
  // التكرار)، والزائد من الكتالوج يُلحق معطّلًا لأنه لا يعمل قبل ربط موفره.
  private mergeStaticCatalog(live: ModelInfo[], catalog: ModelInfo[]): ModelInfo[] {
    if (catalog.length === 0) {
      return live
    }
    const seen = new Set(live.map((model) => `${model.providerID}/${model.id}`))
    const extra = catalog.filter((model) => {
      const key = `${model.providerID}/${model.id}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    return [...live, ...extra].sort((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id))
  }

  // الكتالوج العام من models.dev — يُعرض حتى قبل ربط أي موفر. أي فشل
  // (انقطاع النت) يرجّع آخر صورة أو قائمة فارغة، فتظهر نماذج المحرك وحدها.
  private async staticCatalog(): Promise<ModelInfo[]> {
    const cached = this.staticCatalogCache
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
    try {
      const response = await withTimeout(
        fetch(STATIC_CATALOG_URL, { headers: { accept: "application/json" } }),
        STATIC_CATALOG_TIMEOUT_MS,
        "static model catalog",
      )
      if (!response.ok) {
        throw new Error(`static catalog responded ${response.status}`)
      }
      const value = parseStaticCatalog(await response.json() as unknown)
      this.staticCatalogCache = { expiresAt: Date.now() + STATIC_CATALOG_CACHE_MS, value }
      return value
    } catch (error) {
      console.error("static model catalog failed, showing engine models only", errorMessage(error))
      // فشل مؤقت — إعادة المحاولة بعد مهلة قصيرة لا مع كل طلب
      this.staticCatalogCache = { expiresAt: Date.now() + STATIC_CATALOG_RETRY_MS, value: cached?.value ?? [] }
      return cached?.value ?? []
    }
  }

  private async computeModels(): Promise<ModelInfo[]> {
    const { map: variantMap, items: catalog } = await this.modelCatalog()
    // الـ variants تُرتَّب بترتيب معروف (من الأقل للأعلى) عشان العرض يبقى ثابت.
    const withVariants = (infos: ModelInfo[]): ModelInfo[] => infos.map((info) => {
      const fromProvider = info.variants && info.variants.length > 0 ? info.variants : variantMap.get(`${info.providerID}/${info.id}`)
      const variants = fromProvider && fromProvider.length > 0 ? sortVariants(fromProvider) : undefined
      return variants ? { ...info, variants } : info
    })

    // كل الكتالوج يتعرض كما هو من opencode — بلا ترشيح حسب الموفر أو
    // حالة التفعيل. الترشيح كان يخفي القائمة كلها لما لا يوجد موفر مفعّل،
    // والمطلوب عرض كل النماذج والاختيار للمستخدم.
    return withVariants(
      catalog
        .map((model) => ({
          id: model.id,
          providerID: model.providerID,
          name: model.name,
          free: model.cost.length > 0 && model.cost.every((tier) => isFreeCost(tier.input, tier.output, tier.cache.read, tier.cache.write)),
          enabled: model.enabled,
          status: model.status,
          variants: model.variants,
          capabilities: model.capabilities,
        }) satisfies ModelInfo)
        .sort((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id)),
    )
  }

  async sessionModel(id: string): Promise<{ model: SessionModelRef | null; defaultModel: SessionModelRef | null }> {
    const [model, defaultModel] = await Promise.all([
      (async (): Promise<SessionModelRef | null> => {
        try {
          const session = await this.requireClient().session.get({ sessionID: id })
          const ref = session.model
          return ref ? { providerID: ref.providerID, modelID: ref.id, ...(ref.variant ? { variant: ref.variant } : {}) } : null
        } catch (error) {
          console.error("session get model failed", errorMessage(error))
          return null
        }
      })(),
      (async (): Promise<SessionModelRef | null> => {
        try {
          const entries = await this.requireClient().config.get({ location: this.location() })
          for (const entry of entries) {
            if (entry.type !== "document") {
              continue
            }
            const parsed = parseModelString(typeof entry.info.model === "string" ? entry.info.model : undefined)
            if (parsed) {
              return parsed
            }
          }
        } catch {
          // تجاهل — الـ default اختياري
        }
        return null
      })(),
    ])
    return { model, defaultModel }
  }

  async switchSessionModel(id: string, providerID: string, modelID: string, variant?: string): Promise<SessionModelRef> {
    const cleanProvider = (providerID || "").trim()
    const cleanModel = (modelID || "").trim()
    if (!cleanProvider || !cleanModel) {
      throw new Error("Model is required")
    }
    // التحقق يقبل الكتالوج العام كمان (models()) مش نماذج المحرك بس —
    // نموذج الكتالوج مربوط بمزوّد لسه مش متوصل، فمحتاج رسالة تربط بدل
    // "Model not found" اللي كانت بتظهر كأن الاختيار نفسه غلط
    const available = await this.models()
    const match = available.find((candidate) => candidate.providerID === cleanProvider && candidate.id === cleanModel)
    if (!match) {
      throw new Error(MODEL_PROVIDER_NOT_CONNECTED)
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
  // إبطال كاش الأسئلة لجلسة (أو الكل لما الجلسة مش معروفة): بيمسح الكاش
  // والنداء الجاري معًا، وبيزوّد عدّاد الإبطال اللي بيمنع أي نتيجة بدأت قبله
  // إنها تتخزّن. من غير مسح الـ in-flight، نداء poll بدأ قبل إنشاء الاستمارة
  // بيرجّع [] ويعيد تخزينها بعد الإبطال، فيفضل السؤال مخفي لحد refresh.
  private invalidateQuestions(sessionId?: string): void {
    if (sessionId) {
      this.questionsCache.delete(sessionId)
      this.inflight.delete(`questions:${sessionId}`)
      return
    }
    this.questionsCache.clear()
    for (const key of [...this.inflight.keys()]) {
      if (key.startsWith("questions:")) {
        this.inflight.delete(key)
      }
    }
  }

  private async listForms(sessionId: string): Promise<FormInfo[]> {
    const cached = this.questionsCache.get(sessionId)
    if (cached && cached.expiresAt > Date.now()) {
      this.questionsCache.delete(sessionId)
      this.questionsCache.set(sessionId, cached)
      return cached.value
    }
    if (cached) {
      this.questionsCache.delete(sessionId)
    }
    const key = `questions:${sessionId}`
    const existing = this.inflight.get(key)
    if (existing) {
      return existing as Promise<FormInfo[]>
    }
    const task = this.requireClient().session.form.list({ sessionID: sessionId })
      .then((value) => {
        // الإبطال يزيل هذا الوعد من الخريطة؛ لا تُخزَّن نتيجة طلب بدأ قبله.
        if (this.inflight.get(key) === task) {
          if (!this.questionsCache.has(sessionId) && this.questionsCache.size >= MAX_CACHED_QUESTION_SESSIONS) {
            const oldest = this.questionsCache.keys().next()
            if (!oldest.done) {
              this.questionsCache.delete(oldest.value)
            }
          }
          this.questionsCache.set(sessionId, { expiresAt: Date.now() + QUESTIONS_CACHE_MS, value })
        }
        return value
      })
      .finally(() => {
        if (this.inflight.get(key) === task) {
          this.inflight.delete(key)
        }
      })
    this.inflight.set(key, task)
    return task
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
    // الرد غيّر حالة الأسئلة — ابطل الكاش والنداء الجاري فورًا عشان الـ poll الجاي يشوفها
    this.invalidateQuestions(sessionId)
    return true
  }

  async rejectQuestion(sessionId: string, requestId: string): Promise<boolean> {
    const forms = await this.listForms(sessionId)
    const form = forms.find((candidate) => candidate.id === requestId)
    if (!form || form.sessionID !== sessionId) {
      throw new Error("Question not found")
    }
    await this.requireClient().session.form.cancel({ sessionID: sessionId, formID: requestId })
    this.invalidateQuestions(sessionId)
    return true
  }

  // حالة git للمشروع الحالي: الملفات المتغيّرة + اسم الفرع.
  // لو المشروع مش مستودع git، بنرجّع available=false بدل ما نرمي خطأ.
  // حساب git للفولدر الجاري — غلاف dedup وبعده التصميم الأصلي زي ما هو.
  // /api/git/changes بيتنادى من فتح الدرج + الـ icon + visibility + الـ SSE،
  // والنداءات المتزامنة بتتشارك نفس النتيجة بدل N عملية git status/get.
  private async computeGitChanges(): Promise<GitChanges> {
    const location = this.location()

    let statusFiles: Array<{ file: string; additions: number; deletions: number; status: "added" | "deleted" | "modified" }>
    try {
      const response = await this.requireClient().vcs.status({ location })
      statusFiles = response.data
    } catch {
      // مش مستودع git: مفيش commits ولا مفهوم "غير مدفوع" أصلاً
      return { branch: "", available: false, files: [], unpushed: 0 }
    }

    const branchPromise = (async (): Promise<string> => {
      try {
        const info = await this.requireClient().vcs.get({ location })
        return typeof info.data.branch.current === "string" ? info.data.branch.current : ""
      } catch {
        return ""
      }
    })()
    const unpushedPromise = unpushedCommitCount(location.directory)

    const files = (Array.isArray(statusFiles) ? statusFiles : [])
      .filter((file) => typeof file?.file === "string" && file.file.trim().length > 0)
      .map((file) => ({
        path: file.file.replace(/\\/g, "/"),
        status: file.status,
        added: Number.isFinite(file.additions) ? file.additions : 0,
        removed: Number.isFinite(file.deletions) ? file.deletions : 0,
      }))
      .sort((left, right) => left.path.localeCompare(right.path))

    // عدد الـ commits اللي لسه على الفرع المحلي ومش مدفوعة. بيظهر كشارة على
    // زرار commit & push. القراءة المحلية واسم الفرع مستقلان، فبنستنى نتيجتهما
    // معًا بدل جمع زمن النداءين، والفشل يظل صفرًا أو اسم فرع فارغًا.
    const [branch, unpushed] = await Promise.all([branchPromise, unpushedPromise])

    // مشروع مش مستودع git بيرجّع v2 قائمة فاضية و branch فاضي — نميّزه عن
    // مستودع نضيف عشان الواجهة متقولش "الشجرة نضيفة" لمفيش git أصلًا
    return { branch, available: branch !== "" || files.length > 0, files, unpushed }
  }

  async gitChanges(): Promise<GitChanges> {
    // المفتاح مربوط بالمجلد: تبديل المشروع ما يخلطش حالتين مختلفتين
    return this.dedup(`git:${this.selectedProjectDirectory}`, () => this.computeGitChanges())
  }

  async replyPermission(id: string, permissionId: string, response: "once" | "always" | "reject"): Promise<boolean> {
    await this.requireClient().permission.reply({ sessionID: id, requestID: permissionId, decision: response })

    if (this.pendingPermissions.delete(permissionId)) {
      this.permissionsVersion += 1
    }
    return true
  }

  permissions(): EnginePermission[] {
    return [...this.pendingPermissions.values()]
  }

  permissionsVersionValue(): string {
    return this.permissionsVersion.toString()
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
    this.staticCatalogCache = null
    this.pendingPermissions.clear()
    this.busySessions.clear()
    this.finishedRuns.clear()
    this.rootBySession.clear()
    this.client = null
    this.listeners.clear()
  }
}
