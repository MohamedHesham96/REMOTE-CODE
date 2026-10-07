import type { OpenCodeEvent } from "@opencode/client"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { OpenCodeService } from "./opencode.js"
import { serverMessage } from "./i18n.js"

const SESSION = "ses_test"
const DIRECTORY = process.cwd()

interface FakeClient {
  dispatched: string[]
  deliveries: string[]
  promptFiles: Array<Array<Record<string, unknown>>>
  abortCalls: number
  messages: Array<Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
  switchCalls: Array<Record<string, unknown>>
  session: Record<string, unknown>
  message: Record<string, unknown>
  permission: Record<string, unknown>
}

function sessionSummary(id: string, directory: string): Record<string, unknown> {
  return {
    id,
    title: "",
    projectID: "prj_test",
    location: { directory },
    time: { created: 1, updated: 2 },
  }
}

function createFakeClient(raw: { running: boolean }): FakeClient {
  const fake: FakeClient = {
    dispatched: [],
    deliveries: [],
    promptFiles: [],
    abortCalls: 0,
    messages: [],
    sessions: [sessionSummary(SESSION, DIRECTORY)],
    switchCalls: [],
    session: {},
    message: {},
    permission: {},
  }
  fake.session = {
    prompt: (options: { text?: string; delivery?: string; files?: Array<Record<string, unknown>> }) => {
      fake.dispatched.push(options.text ?? "")
      fake.deliveries.push(options.delivery ?? "")
      fake.promptFiles.push(options.files ?? [])
      return Promise.resolve({ id: "inbox_1", sessionID: SESSION })
    },
    interrupt: () => {
      fake.abortCalls += 1
      return Promise.resolve({ interrupted: true })
    },
    active: () => Promise.resolve(raw.running ? { [SESSION]: { type: "running" } } : {}),
    list: (options?: { directory?: string }) => Promise.resolve({
      data: options?.directory ? fake.sessions : [...fake.sessions],
      cursor: {},
    }),
    remove: () => Promise.resolve(undefined),
    get: () => Promise.resolve(sessionSummary(SESSION, DIRECTORY)),
    update: () => Promise.resolve(undefined),
    switchAgent: (options: { agent?: string }) => {
      fake.switchCalls.push({ agent: options.agent })
      return Promise.resolve(undefined)
    },
    switchModel: (options: { model?: Record<string, unknown> }) => {
      fake.switchCalls.push(options.model ?? {})
      return Promise.resolve(undefined)
    },
    form: {
      list: () => Promise.resolve([]),
      reply: () => Promise.resolve(undefined),
      cancel: () => Promise.resolve(undefined),
    },
  }
  fake.message = {
    list: () => Promise.resolve({ data: fake.messages, cursor: {} }),
  }
  fake.permission = {
    reply: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
  }
  return fake
}

function textPart(text: string): Record<string, unknown> {
  return { type: "text", text }
}

function userMessage(id: string, text: string, created: number, files?: Array<Record<string, unknown>>): Record<string, unknown> {
  return { id, type: "user", time: { created }, text, ...(files ? { files } : {}) }
}

function assistantMessage(id: string, text: string, created: number, completed?: number): Record<string, unknown> {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { id: "space-bunny-free", providerID: "opencode" },
    time: { created, ...(completed === undefined ? {} : { completed }) },
    content: text ? [textPart(text)] : [],
  }
}

interface Internals {
  client: unknown
  trackEvent: (event: OpenCodeEvent) => void
  busySessions: Set<string>
  runningSessions: Set<string>
  idlePolls: Map<string, number>
  startQueueWatchdog: () => void
  variantsCache: unknown
  modelsCache: unknown
  staticCatalogCache: unknown
}

// الكتالوج العام يُجلب عبر fetch — الوضع الافتراضي "بلا نت" حتى لا تلمس
// الاختبارات الشبكة أبدًا، واختبارات الدمج تُعيد التثبيت بنفسها.
beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createService() {
  const raw = { running: false }
  const fake = createFakeClient(raw)
  const service = new OpenCodeService({ projectDirectory: DIRECTORY })
  const internals = service as unknown as Internals
  internals.client = fake

  return {
    service,
    fake,
    raw,
    busySessions: internals.busySessions,
    runningSessions: internals.runningSessions,
    internals,
    emit: (event: OpenCodeEvent) => internals.trackEvent(event),
  }
}

function idleEvent(): OpenCodeEvent {
  return { type: "session.idle", data: { sessionID: SESSION } } as unknown as OpenCodeEvent
}

function busyEvent(): OpenCodeEvent {
  return { type: "session.status", data: { sessionID: SESSION, status: { type: "busy" } } } as unknown as OpenCodeEvent
}

function errorEvent(): OpenCodeEvent {
  return { type: "session.execution.failed", data: { sessionID: SESSION } } as unknown as OpenCodeEvent
}

function successEvent(): OpenCodeEvent {
  return { type: "session.execution.succeeded", data: { sessionID: SESSION } } as unknown as OpenCodeEvent
}

function interruptedEvent(): OpenCodeEvent {
  return { type: "session.execution.interrupted", data: { sessionID: SESSION, reason: "user" } } as unknown as OpenCodeEvent
}

describe("parallel request queue", () => {
  it("dispatches the first request and keeps the rest queued", async () => {
    const { service, fake } = createService()

    await expect(service.prompt(SESSION, "الأول")).resolves.toEqual({ queued: false })
    await expect(service.prompt(SESSION, "التاني")).resolves.toEqual({ queued: true })
    await expect(service.prompt(SESSION, "التالت")).resolves.toEqual({ queued: true })

    expect(fake.dispatched).toEqual(["الأول"])
    expect(service.hasPendingWork(SESSION)).toBe(true)
  })

  it("يمرّر المرفقات مع الطلب كـ files بصيغة OpenCode", async () => {
    const { service, fake } = createService()

    await service.prompt(SESSION, "شوف الصورة", undefined, undefined, [
      { uri: "data:image/png;base64,AAAA", name: "photo.png" },
    ])

    expect(fake.promptFiles).toEqual([[{ uri: "data:image/png;base64,AAAA", name: "photo.png" }]])
  })

  it("الطلب بلا مرفقات مايبعتش files", async () => {
    const { service, fake } = createService()

    await service.prompt(SESSION, "نص فقط")

    expect(fake.promptFiles).toEqual([[]])
  })

  it("sends the queued requests in order once the session goes idle", async () => {
    const { service, fake, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")
    await service.prompt(SESSION, "التالت")

    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني"])

    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني", "التالت"])

    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني", "التالت"])
    expect(service.hasPendingWork(SESSION)).toBe(false)
  })

  it("keeps reporting the session as busy while requests are still waiting", async () => {
    const { service, raw, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")

    // OpenCode بيبعت idle مؤقت بين الطلبين — الواجهة لازم تفضل تشوف "شغّال"
    raw.running = false
    await expect(service.statuses()).resolves.toMatchObject({ [SESSION]: { type: "busy" } })

    emit(idleEvent())
    raw.running = false
    await expect(service.statuses()).resolves.toMatchObject({ [SESSION]: { type: "busy" } })
  })

  it("exposes queued requests as cards and clears them on abort", async () => {
    const { service, fake, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")

    const beforeAbort = await service.requests(SESSION)
    expect(beforeAbort.requests.map((request) => [request.prompt, request.state])).toEqual([["التاني", "queued"]])
    expect(beforeAbort.queued).toBe(1)

    await expect(service.abort(SESSION)).resolves.toEqual({ aborted: true, cleared: 1 })
    expect(fake.abortCalls).toBe(1)
    expect(service.hasPendingWork(SESSION)).toBe(false)

    emit(idleEvent())
    const afterAbort = await service.requests(SESSION)
    expect(afterAbort.requests).toEqual([])
    expect(afterAbort.queued).toBe(0)
  })

  it("removes a single queued request and keeps the rest in order", async () => {
    const { service, fake, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")
    await service.prompt(SESSION, "التالت")
    await service.prompt(SESSION, "الرابع")
    emit(idleEvent())

    const before = await service.requests(SESSION)
    expect(before.requests.map((request) => request.prompt)).toEqual(["التالت", "الرابع"])
    const target = before.requests[0]!.id

    // الواجهة بتبعته بالبادئة — لازم يتشال من الطابور من غير ما يمسّ اللي شغّال
    expect(service.removeQueued(SESSION, target)).toEqual({ removed: true, remaining: 1 })
    expect(service.removeQueued(SESSION, target)).toEqual({ removed: false, remaining: 1 })
    expect(fake.abortCalls).toBe(0)
    expect(fake.dispatched).toEqual(["الأول", "التاني"])

    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني", "الرابع"])
  })

  it("skips the running request and lets the queue continue", async () => {
    const { service, fake } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")
    await service.prompt(SESSION, "التالت")

    await expect(service.skip(SESSION)).resolves.toEqual({ skipped: true, remaining: 1 })
    expect(fake.abortCalls).toBe(1)
    // الطلب اللي بعده اتبعت على طول من غير ما الطابور يتمسح
    expect(fake.dispatched).toEqual(["الأول", "التاني"])
    expect(service.hasPendingWork(SESSION)).toBe(true)
  })

  it("does not send the next request from the idle of the skipped one", async () => {
    const { service, fake, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")

    const skipping = service.skip(SESSION)
    // الـ idle بيوصل قبل ما يخلص الإيقاف — لازم ما تبعتش طلب وانت لسه بتوقف
    emit(idleEvent())
    await skipping

    expect(fake.dispatched).toEqual(["الأول", "التاني"])
    // الـ idle القديم اللي وصل بعدين ما يبعثش تاني
    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني"])
  })

  it("ignores a skip when nothing is running", async () => {
    const { service, fake } = createService()

    await expect(service.skip(SESSION)).resolves.toEqual({ skipped: false, remaining: 0 })
    expect(fake.abortCalls).toBe(0)
  })

  // المحرك بيقفل رسالة الطلب المُتخطّى كأنها خلصت (time.completed بيتسجّل)،
  // فمن غير العلامة اللي بنسجّلها لحظة التخطّي كان الطلب يبان "تمت".
  it("reports a skipped request as skipped instead of done", async () => {
    const { service, fake } = createService()
    fake.messages = [userMessage("msg_u1", "الطلب", 1_000)]

    await service.prompt(SESSION, "الطلب")
    await service.skip(SESSION)

    // بعد الإيقاف المحرك قفل الرسالة: الرد بقى مكتمل عند المحرك.
    fake.messages = [
      userMessage("msg_u1", "الطلب", 1_000),
      assistantMessage("msg_a1", "نتيجة جزئية", 1_100, 1_200),
    ]

    const result = await service.requests(SESSION)
    expect(result.requests[0]?.state).toBe("skipped")
  })

  it("steers a queued request into the running task without stopping it", async () => {
    const { service, fake, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")
    await service.prompt(SESSION, "التالت")

    // آخر طلب في الطابور عايز يتنفّذ حالًا — بيتحقن جوه المهمة الشغّالة
    // كتوجيه (steer) فبيتشال من الطابور من غير ما نوقف OpenCode
    await expect(service.runQueued(SESSION, "queued:q3")).resolves.toEqual({ started: false, steered: true, queued: false, remaining: 1 })
    expect(fake.abortCalls).toBe(0)
    expect(fake.dispatched).toEqual(["الأول", "التالت"])
    expect(fake.deliveries).toEqual(["", "steer"])

    // اللي فضل في الطابور (التاني) بيتنفّذ لما المهمة الحالية تخلص
    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التالت", "التاني"])
  })

  it("steers a queued request immediately and leaves nothing for the next idle", async () => {
    const { service, fake, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")

    await expect(service.runQueued(SESSION, "queued:q2")).resolves.toEqual({ started: false, steered: true, queued: false, remaining: 0 })
    expect(fake.dispatched).toEqual(["الأول", "التاني"])
    expect(fake.deliveries).toEqual(["", "steer"])

    // الطابور فضل فاضي — الـ idle مش هيبعت حاجة تاني
    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني"])
    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني"])
  })

  it("falls back to the queue when the steer is rejected mid-run", async () => {
    const { service, fake, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")

    // السيرفر رفض الحقن جوه المهمة الشغّالة: الطلب ما يضيعش ويرجع للطابور
    const original = fake.session.prompt as (options: { text?: string; delivery?: string }) => Promise<unknown>
    fake.session.prompt = () => Promise.reject(new Error("cannot steer"))
    await expect(service.runQueued(SESSION, "queued:q2")).resolves.toEqual({ started: false, steered: false, queued: true, remaining: 1 })
    expect(fake.abortCalls).toBe(0)
    expect(fake.dispatched).toEqual(["الأول"])

    fake.session.prompt = original
    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني"])
  })

  it("ignores run-now for a request that is not queued", async () => {
    const { service, fake } = createService()

    await service.prompt(SESSION, "الأول")
    await expect(service.runQueued(SESSION, "queued:q1")).resolves.toEqual({ started: false, steered: false, queued: false, remaining: 0 })
    expect(fake.abortCalls).toBe(0)
    expect(fake.dispatched).toEqual(["الأول"])
  })
})

describe("stale busy status", () => {
  it("stops showing a finished request as running when OpenCode is stuck on busy", async () => {
    const { service, fake, raw } = createService()

    fake.messages = [
      userMessage("msg_u1", "الطلب", 1_000),
      assistantMessage("msg_a1", "النتيجة", 1_100, 1_200),
    ]
    // OpenCode لسه بيقول "شغّال" والـ idle ضاع — الكارت لازم يخلص مش يفضل يدور
    raw.running = true

    const result = await service.requests(SESSION)
    expect(result.status).toEqual({ type: "idle" })
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]?.state).toBe("done")
    expect(result.requests[0]?.finalResult).toBe("النتيجة")
  })

  it("keeps the finished request busy while another one is still queued", async () => {
    const { service, fake, raw } = createService()

    fake.messages = [
      userMessage("msg_u1", "الأول", 1_000),
      assistantMessage("msg_a1", "نتيجة الأول", 1_100, 1_200),
    ]
    raw.running = true
    await service.prompt(SESSION, "التاني")
    await service.prompt(SESSION, "التالت")

    // الطلب الأول خلص فعلًا، بس فيه طلبات مستنية وراه — ما نبيّنش "خلص" لسه
    const result = await service.requests(SESSION)
    expect(result.status).toEqual({ type: "busy" })
    expect(result.requests.map((request) => request.state)).toEqual(["running", "queued"])
  })

  it("keeps a request that is still open as running", async () => {
    const { service, fake, raw } = createService()

    fake.messages = [
      userMessage("msg_u1", "الطلب", 1_000),
      assistantMessage("msg_a1", "شغال", 1_100),
    ]
    raw.running = true

    const result = await service.requests(SESSION)
    expect(result.status).toEqual({ type: "busy" })
    expect(result.requests.map((request) => request.state)).toEqual(["running"])
  })

  it("does not treat an intermediate step as finished while the next step is open", async () => {
    const { service, fake, raw } = createService()

    // خطوة وسيطة اتقفلت (completed) واللي بعدها لسه مفتوحة — المهمة شغالة مش خالصة
    fake.messages = [
      userMessage("msg_u1", "الطلب", 1_000),
      assistantMessage("msg_a1", "خطوة أولى", 1_100, 1_200),
      assistantMessage("msg_a2", "شغال في التانية", 1_300),
    ]
    raw.running = true

    const result = await service.requests(SESSION)
    expect(result.status).toEqual({ type: "busy" })
    expect(result.requests.map((request) => request.state)).toEqual(["running"])
  })

  it("does not treat a just-finished message as stale while updates are still fresh", async () => {
    const { service, fake, raw } = createService()

    // الفجوة بين رسالتين قصيرة (تحديث حديث) — لسه مش دليل إن الـ busy معلق
    const now = Date.now()
    fake.messages = [
      userMessage("msg_u1", "الطلب", now - 2_000),
      assistantMessage("msg_a1", "خطوة", now - 1_000, now - 500),
    ]
    raw.running = true

    const result = await service.requests(SESSION)
    expect(result.status).toEqual({ type: "busy" })
    expect(result.requests.map((request) => request.state)).toEqual(["running"])
  })

  it("releases the busy flag when OpenCode reports an error instead of going idle", async () => {
    const { emit, busySessions } = createService()

    emit(busyEvent())
    expect(busySessions.has(SESSION)).toBe(true)

    // الخطأ بيقفل الشغل من غير idle بعدها — الجلسة كانت هتفضل شغّال للأبد
    emit(errorEvent())
    expect(busySessions.has(SESSION)).toBe(false)
  })

  // النجاح كمان بيقفل الشغل من غير ما يضمن وصول idle، فنفس المعالجة مطلوبة
  // وإلا المحادثة تفضل شايلة علامة "شغّال" في السايدبار وقائمة النشطة.
  it("releases the busy flag when the run succeeds without a following idle", async () => {
    const { emit, busySessions, runningSessions } = createService()

    emit(busyEvent())
    runningSessions.add(SESSION)
    expect(busySessions.has(SESSION)).toBe(true)

    emit(successEvent())
    expect(busySessions.has(SESSION)).toBe(false)
    expect(runningSessions.has(SESSION)).toBe(false)
  })

  it("releases the busy flag when the run is interrupted", async () => {
    const { emit, busySessions, runningSessions } = createService()

    emit(busyEvent())
    runningSessions.add(SESSION)

    emit(interruptedEvent())
    expect(busySessions.has(SESSION)).toBe(false)
    expect(runningSessions.has(SESSION)).toBe(false)
  })

  it("stops showing a finished request as running while OpenCode stays busy", async () => {
    const { service, fake, raw, runningSessions } = createService()

    fake.messages = [
      userMessage("msg_u1", "الطلب", 1_000),
      assistantMessage("msg_a1", "النتيجة", 1_100, 1_200),
    ]
    await service.prompt(SESSION, "الطلب")
    expect(runningSessions.has(SESSION)).toBe(true)
    // Task خلصت على الديسكتوب، بس OpenCode واقف على busy والـ idle ضاع
    raw.running = true

    const result = await service.requests(SESSION)
    expect(runningSessions.has(SESSION)).toBe(false)
    expect(result.status).toEqual({ type: "idle" })
    expect(result.requests[0]?.state).toBe("done")
  })

  it("releases a session stuck as running when its idle event was lost", async () => {
    vi.useFakeTimers()
    try {
      const { service, raw, internals, runningSessions } = createService()

      // الطلب اتبعث قبل ما السيرفر يقفل (فلج "شغّال" اتسيب وراه) وسيرفر OpenCode
      // بيقوله idle — من غير حد يوصّلنا حدث الـ idle
      internals.runningSessions.add(SESSION)
      raw.running = false

      internals.startQueueWatchdog()
      // أول poll مش كفاية — طلب لسه بيلفّ حالته لـ busy مينفعش يتحرّك من أول مرة
      await vi.advanceTimersByTimeAsync(5000)
      expect(runningSessions.has(SESSION)).toBe(true)

      // تاني poll بيأكد إن الجلسة idle فعلًا
      await vi.advanceTimersByTimeAsync(5000)
      expect(runningSessions.has(SESSION)).toBe(false)
      expect(service.hasPendingWork(SESSION)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("model variety levels", () => {
  // v2 يرجّع الـ variants array [{ id, ... }] في كتالوج الموديلات مباشرة.
  function variantService(variantIds: string[] | undefined, switchCalls: Array<Record<string, unknown>> = []) {
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: {
        model: { list: () => Promise<unknown> }
        provider: { list: () => Promise<unknown> }
        session: { switchModel: (options: { model: Record<string, unknown> }) => Promise<unknown> }
      }
    }
    internals.client = {
      model: {
        list: () => Promise.resolve({
          data: [{
            id: "opencode/space-bunny-free",
            modelID: "space-bunny-free",
            providerID: "opencode",
            name: "Space Bunny Free",
            cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
            enabled: true,
            status: "active",
            variants: (variantIds ?? []).map((id) => ({ id })),
          }],
        }),
      },
      provider: {
        list: () => Promise.resolve({ data: [{ id: "opencode", activation: "enabled" }] }),
      },
      session: {
        switchModel: (options: { model: Record<string, unknown> }) => {
          switchCalls.push(options.model)
          return Promise.resolve(undefined)
        },
      },
    }
    // نمنع الكاش من leaking بين التستات
    internals.variantsCache = null
    return { service, switchCalls }
  }

  it("reads variants from the model catalog array", async () => {
    const { service } = variantService(["high", "low"])

    const models = await service.models()

    expect(models[0]?.variants).toEqual(["low", "high"])
  })

  it("orders the levels from lowest to highest", async () => {
    const { service } = variantService(["max", "xhigh", "high", "medium", "low"])

    const models = await service.models()

    expect(models[0]?.variants).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  it("switches the session model to the chosen level", async () => {
    const { service, switchCalls } = variantService(["low", "high", "max"])

    await expect(service.switchSessionModel(SESSION, "opencode", "space-bunny-free", "max")).resolves.toEqual({
      providerID: "opencode",
      modelID: "space-bunny-free",
      variant: "max",
    })
    expect(switchCalls[0]).toEqual({ id: "space-bunny-free", providerID: "opencode", variant: "max" })
  })

  it("clears the level when the default chip is picked", async () => {
    const { service, switchCalls } = variantService(["low", "high"])

    await expect(service.switchSessionModel(SESSION, "opencode", "space-bunny-free", "")).resolves.toEqual({
      providerID: "opencode",
      modelID: "space-bunny-free",
    })
    expect(switchCalls[0]).toEqual({ id: "space-bunny-free", providerID: "opencode" })
  })

  it("rejects a level the model does not declare", async () => {
    const { service } = variantService(["low", "high"])

    await expect(service.switchSessionModel(SESSION, "opencode", "space-bunny-free", "ultra")).rejects.toThrow(/variant not found/i)
  })

  it("leaves models without declared levels alone", async () => {
    const { service } = variantService(undefined)

    const models = await service.models()

    expect(models[0]?.variants).toBeUndefined()
  })
})

describe("static model catalog merge", () => {
  // المحرك الحي يقدّم نموذجًا واحدًا، والكتالوج العام يضيف موفرًا جديدًا
  // مع تكرار لنفس النموذج الحي — الحيّ يكسب والمعطّل يُلحق للعرض فقط.
  function mergedService(staticPayload: unknown) {
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: {
        model: { list: () => Promise<unknown> }
        provider: { list: () => Promise<unknown> }
        session: { switchModel: () => Promise<unknown> }
      }
    }
    internals.client = {
      model: {
        list: () => Promise.resolve({
          data: [{
            id: "opencode/space-bunny-free",
            modelID: "space-bunny-free",
            providerID: "opencode",
            name: "Space Bunny Free",
            cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
            enabled: true,
            status: "active",
            variants: [],
          }],
        }),
      },
      provider: {
        list: () => Promise.resolve({ data: [{ id: "opencode", activation: "enabled" }] }),
      },
      session: {
        switchModel: () => Promise.resolve(undefined),
      },
    }
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, json: () => Promise.resolve(staticPayload) }))
    // نمنع الكاش من leaking بين التستات
    internals.variantsCache = null
    internals.modelsCache = null
    internals.staticCatalogCache = null
    return { service }
  }

  const payload = {
    acme: {
      id: "acme",
      models: {
        coder: { name: "Acme Coder", cost: { input: 1, output: 2 } },
      },
    },
    opencode: {
      id: "opencode",
      models: {
        "space-bunny-free": { name: "Stale Name" },
        "extra-free": { name: "Extra Free", cost: { input: 0, output: 0 } },
      },
    },
  }

  it("appends catalog models the engine does not serve, disabled for display", async () => {
    const { service } = mergedService(payload)

    const models = await service.models()

    expect(models).toEqual([
      { id: "coder", providerID: "acme", name: "Acme Coder", free: false, enabled: false, status: undefined, variants: undefined },
      { id: "extra-free", providerID: "opencode", name: "Extra Free", free: true, enabled: false, status: undefined, variants: undefined },
      expect.objectContaining({ id: "space-bunny-free", providerID: "opencode", enabled: true, name: "Space Bunny Free" }),
    ])
  })

  it("accepts a catalog-only model so the provider can be connected later", async () => {
    const { service } = mergedService(payload)

    await expect(service.switchSessionModel(SESSION, "acme", "coder", "")).resolves.toEqual({
      providerID: "acme",
      modelID: "coder",
    })
  })

  it("reports an unknown model as needing a provider connection", async () => {
    const { service } = mergedService(payload)

    await expect(service.switchSessionModel(SESSION, "acme", "missing", "")).rejects.toThrow(
      /MODEL_PROVIDER_NOT_CONNECTED/,
    )
  })

  it("falls back to engine models when the catalog is unreachable", async () => {
    const { service } = mergedService(payload)
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")))

    const models = await service.models()

    expect(models).toHaveLength(1)
    expect(models[0]?.id).toBe("space-bunny-free")
  })
})

describe("response caching and dedup", () => {
  function activityService(counts: { list: number; active: number }) {
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: {
        session: {
          list: () => Promise<unknown>
          active: () => Promise<unknown>
        }
      }
    }
    internals.client = {
      session: {
        list: () => {
          counts.list += 1
          return Promise.resolve({ data: [], cursor: {} })
        },
        active: () => {
          counts.active += 1
          return Promise.resolve({})
        },
      },
    }
    return { service, internals }
  }

  it("serves activity from the short cache and dedups concurrent calls", async () => {
    const counts = { list: 0, active: 0 }
    const { service } = activityService(counts)

    // طلبان متزامنان = حساب واحد فقط (in-flight dedup)
    const [first, second] = await Promise.all([service.activity("ar"), service.activity("ar")])
    expect(first).toEqual([])
    expect(second).toEqual([])
    expect(counts.list).toBe(1)

    // طلب ثالث خلال الـ TTL = من الكاش من غير upstream جديد
    await service.activity("ar")
    expect(counts.list).toBe(1)
  })

  it("invalidates the activity cache on session lifecycle events", async () => {
    const counts = { list: 0, active: 0 }
    const { service, internals } = activityService(counts)

    await service.activity("ar")
    expect(counts.list).toBe(1)

    internals.trackEvent({ type: "session.status", data: { sessionID: SESSION, status: { type: "busy" } } } as unknown as OpenCodeEvent)
    await service.activity("ar")
    expect(counts.list).toBe(2)
  })

  it("caches the model catalog between calls", async () => {
    let modelCalls = 0
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: {
        model: { list: () => Promise<unknown> }
        provider: { list: () => Promise<unknown> }
      }
    }
    internals.client = {
      model: {
        list: () => {
          modelCalls += 1
          return Promise.resolve({
            data: [{
              id: "opencode/space-bunny-free",
              modelID: "space-bunny-free",
              providerID: "opencode",
              name: "Space Bunny Free",
              cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
              enabled: true,
              status: "active",
              variants: [{ id: "low" }],
            }],
          })
        },
      },
      provider: {
        list: () => Promise.resolve({ data: [{ id: "opencode", activation: "enabled" }] }),
      },
    }
    internals.variantsCache = null

    const first = await service.models()
    const second = await service.models()
    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(modelCalls).toBe(1)
  })

  it("caches question lists and invalidates them on form events", async () => {
    let listCalls = 0
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: { session: { form: { list: () => Promise<unknown> } } }
    }
    internals.client = {
      session: {
        form: {
          list: () => {
            listCalls += 1
            return Promise.resolve([])
          },
        },
      },
    }

    await service.sessionQuestions(SESSION)
    await service.sessionQuestions(SESSION)
    expect(listCalls).toBe(1)

    // الجلسة جوه data.form زي ما SDK v2 بيبعت فعلًا في form.created
    internals.trackEvent({ type: "form.created", data: { form: { id: "form_1", sessionID: SESSION } } } as unknown as OpenCodeEvent)
    await service.sessionQuestions(SESSION)
    expect(listCalls).toBe(2)
  })

  it("does not cache an in-flight list that started before a form event", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined
    let listCalls = 0
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: { session: { form: { list: () => Promise<unknown> } } }
    }
    internals.client = {
      session: {
        form: {
          list: () => {
            listCalls += 1
            if (listCalls === 1) {
              return new Promise((resolve) => { resolveFirst = resolve })
            }
            return Promise.resolve([{ id: "form_1", sessionID: SESSION, title: "Q", fields: [] }])
          },
        },
      },
    }

    // poll بدأ قبل ما الاستمارة تتوجد ولسه معلّق
    const first = service.sessionQuestions(SESSION)
    // الاستمارة اتنشأت — لازم الإبطال يشيل الكاش والنداء الجاري معًا
    internals.trackEvent({ type: "form.created", data: { form: { id: "form_1", sessionID: SESSION } } } as unknown as OpenCodeEvent)
    // طلب جديد يبدأ قبل رجوع القديم، والقديم ممنوع يستبدل وعده أو كاشه.
    const afterPromise = service.sessionQuestions(SESSION)
    // النداء القديم خلص فاضي
    resolveFirst([])
    await first

    // النداء اللي العميل بيعمله بعد الحدث لازم يشوف الاستمارة لا النتيجة القديمة
    const after = await afterPromise
    expect(after.map((question) => question.id)).toEqual(["form_1"])
    expect(listCalls).toBe(2)
  })

  it("bounds cached question lists across previously opened sessions", async () => {
    let listCalls = 0
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: { session: { form: { list: () => Promise<unknown> } } }
      questionsCache: Map<string, unknown>
    }
    internals.client = {
      session: {
        form: {
          list: () => {
            listCalls += 1
            return Promise.resolve([])
          },
        },
      },
    }

    for (let index = 0; index < 65; index += 1) {
      await service.sessionQuestions(`session-${index}`)
    }

    expect(internals.questionsCache.size).toBe(64)
    expect(internals.questionsCache.has("session-0")).toBe(false)
    await service.sessionQuestions("session-0")
    expect(listCalls).toBe(66)
  })
})

describe("session cleanup and state version", () => {
  it("cleans up all session state on delete", async () => {
    const { service, busySessions, runningSessions, internals } = createService()
    // لا نلمس نظام الملفات الحقيقي في التست — السلوك المطلوب هو التنظيف فقط
    ;(service as unknown as Record<string, unknown>).persistMobileSessions = async () => undefined
    busySessions.add(SESSION)
    runningSessions.add(SESSION)
    internals.idlePolls.set(SESSION, 2)
    ;(service as unknown as { finishedRuns: Set<string> }).finishedRuns.add(SESSION)

    await expect(service.deleteSession(SESSION)).resolves.toBe(true)

    expect(busySessions.has(SESSION)).toBe(false)
    expect(runningSessions.has(SESSION)).toBe(false)
    expect(internals.idlePolls.has(SESSION)).toBe(false)
    expect((service as unknown as { finishedRuns: Set<string> }).finishedRuns.has(SESSION)).toBe(false)
  })

  it("exposes a state version that changes with new content", async () => {
    const { service, fake } = createService()

    const empty = await service.requests(SESSION)
    expect(typeof empty.version).toBe("string")

    fake.messages = [
      userMessage("msg_u1", "الطلب", 1_000),
      assistantMessage("msg_a1", "النتيجة", 1_100, 1_200),
    ]
    const filled = await service.requests(SESSION)
    expect(filled.version).not.toBe(empty.version)

    // نفس المحتوى = نفس البصمة (تسمح بـ 304 وتوفّر إعادة التحميل)
    const again = await service.requests(SESSION)
    expect(again.version).toBe(filled.version)

    // نمو النص الحي نفسه يغيّر البصمة حتى لو الأوقات ثابتة
    fake.messages = [
      userMessage("msg_u1", "الطلب", 1_000),
      assistantMessage("msg_a1", "النتيجة النهائية الكاملة بعد اكتمال كل الخطوات", 1_100, 1_200),
    ]
    const grown = await service.requests(SESSION)
    expect(grown.version).not.toBe(filled.version)
  })

  it("lists the tools the task used and refreshes the version when they change", async () => {
    const { service, fake } = createService()

    function toolMessage(parts: Array<Record<string, unknown>>): Record<string, unknown> {
      return {
        id: "msg_a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "opencode" },
        time: { created: 1_100 },
        content: parts,
      }
    }

    fake.messages = [
      userMessage("msg_u1", "ابحث", 1_000),
      toolMessage([
        { type: "tool", id: "call_1", name: "grep", state: { status: "completed" }, time: { created: 1_150, completed: 1_200 } },
      ]),
    ]
    const first = await service.requests(SESSION)
    expect(first.requests[0]?.usedTools).toEqual([serverMessage("activitySearchingFiles", "ar")])

    // نفس الزمن ونفس النص، بس أداة جديدة ظهرت. بصمة الـ ETag لازم تتغير
    // وإلا السيرفر رد 304 والواجهة تفضل على قائمة "المستخدم" القديمة.
    fake.messages = [
      userMessage("msg_u1", "ابحث", 1_000),
      toolMessage([
        { type: "tool", id: "call_1", name: "grep", state: { status: "completed" }, time: { created: 1_150, completed: 1_200 } },
        { type: "tool", id: "call_2", name: "edit", state: { status: "running" }, time: { created: 1_250 } },
      ]),
    ]
    const second = await service.requests(SESSION)
    expect(second.requests[0]?.usedTools).toEqual([
      serverMessage("activitySearchingFiles", "ar"),
      serverMessage("activityApplyingChanges", "ar"),
    ])
    expect(second.version).not.toBe(first.version)
  })

  it("streams result files from disk with their real size", async () => {
    const { service } = createService()
    // القائمة فاضية في الـ fake فالمسار يتحلّل تحت projectDirectory (cwd)
    await mkdir(resolve(process.cwd(), "data"), { recursive: true })
    const name = `data/.perf-test-${Date.now()}.txt`
    const absolute = resolve(process.cwd(), name)
    await writeFile(absolute, "hello-stream")
    try {
      const file = await service.openResultFile("missing-session", name)
      expect(file.filename).toBe(name.split("/").pop())
      expect(file.size).toBe(12)
      const chunks: Buffer[] = []
      for await (const chunk of file.stream as unknown as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      expect(Buffer.concat(chunks).toString("utf8")).toBe("hello-stream")
    } finally {
      await unlink(absolute)
    }
  })
})

describe("project list filtering", () => {
  it("يخفي الجذور والنسبي ويبقي المشاريع الحقيقية", async () => {
    const service = new OpenCodeService({ projectDirectory: "E:/mSales/app" })
    const internals = service as unknown as {
      client: {
        project: { list: () => Promise<unknown[]> }
        session: { list: () => Promise<{ data: unknown[]; cursor: object }> }
      }
    }
    internals.client = {
      project: {
        list: () => Promise.resolve([
          { id: "p1", name: "app" },
          { id: "junk", name: "junk" },
        ]),
      },
      session: {
        list: () => Promise.resolve({
          data: [
            {
              id: "ses_1",
              title: "app",
              projectID: "p1",
              location: { directory: "E:/mSales/app2" },
              time: { created: 2, updated: 3 },
            },
            {
              id: "ses_2",
              title: "junk",
              projectID: "junk",
              location: { directory: "E:" },
              time: { created: 2, updated: 3 },
            },
          ],
          cursor: {},
        }),
      },
    }
    const projects = await service.projects()
    expect(projects.map((project) => project.worktree).sort()).toEqual(["E:/mSales/app", "E:/mSales/app2"])
  })

  it("يعرض مشروعًا مسجَّلًا لا يحمل أي جلسة", async () => {
    const service = new OpenCodeService({ projectDirectory: "E:/mSales/app" })
    const internals = service as unknown as {
      client: {
        project: { list: () => Promise<unknown[]> }
        session: { list: () => Promise<{ data: unknown[]; cursor: object }> }
      }
    }
    internals.client = {
      project: {
        list: () => Promise.resolve([
          { id: "p1", canonical: "E:/mSales/app", name: "app", time: { created: 10, updated: 20, active: 0 } },
          // بلا جلسات: هو المطلوب أن يظهر
          { id: "p2", canonical: "E:/work/fresh", name: "fresh", time: { created: 30, updated: 40, active: 0 } },
          // بادئة مخفية: عمل مؤقت لا مشروع
          { id: "p3", canonical: "E:/work/.opencode/tmp", time: { created: 50, updated: 60, active: 0 } },
          // جذر قرص: لا يظهر
          { id: "p4", canonical: "E:/", time: { created: 70, updated: 80, active: 0 } },
        ]),
      },
      session: {
        list: () => Promise.resolve({ data: [], cursor: {} }),
      },
    }

    const projects = await service.projects()
    expect(projects.map((project) => project.worktree)).toEqual(["E:/work/fresh", "E:/mSales/app"])
  })

  it("keeps configured and session projects when project.list throws synchronously", async () => {
    const service = new OpenCodeService({ projectDirectory: "E:/mSales/app" })
    const internals = service as unknown as {
      client: {
        project: { list: () => Promise<unknown[]> }
        session: { list: () => Promise<{ data: unknown[]; cursor: object }> }
      }
    }
    internals.client = {
      project: {
        list: () => { throw new Error("project registry unavailable") },
      },
      session: {
        list: () => Promise.resolve({
          data: [{
            id: "ses_1",
            title: "app",
            projectID: "p1",
            location: { directory: "E:/work/existing" },
            time: { created: 1, updated: 2 },
          }],
          cursor: {},
        }),
      },
    }

    const projects = await service.projects()

    expect(projects.map((project) => project.worktree).sort()).toEqual(["E:/mSales/app", "E:/work/existing"])
  })

  it("يستخدم اسم المشروع المسجَّل ودمج زمنه مع الجلسات", async () => {
    const service = new OpenCodeService({ projectDirectory: "E:/mSales/app" })
    const internals = service as unknown as {
      client: {
        project: { list: () => Promise<unknown[]> }
        session: { list: () => Promise<{ data: unknown[]; cursor: object }> }
      }
    }
    internals.client = {
      project: {
        list: () => Promise.resolve([
          { id: "p1", canonical: "E:/mSales/app", name: "mSales App", time: { created: 1, updated: 5, active: 0 } },
        ]),
      },
      session: {
        list: () => Promise.resolve({
          data: [{
            id: "ses_1",
            title: "app",
            projectID: "p1",
            location: { directory: "E:/mSales/app" },
            time: { created: 2, updated: 99 },
          }],
          cursor: {},
        }),
      },
    }

    const projects = await service.projects()
    expect(projects).toEqual([{
      id: "E:/mSales/app",
      worktree: "E:/mSales/app",
      name: "mSales App",
      time: { created: 1, updated: 99 },
    }])
  })
})

describe("canonical project directory", () => {
  it("يوحّد المسار القانوني عند الاختيار والإنشاء", async () => {
    const created: Array<Record<string, unknown>> = []
    const service = new OpenCodeService({ projectDirectory: "E:/mSales/app" })
    const internals = service as unknown as {
      selectedProjectDirectory: string
      client: {
        project: { list: () => Promise<unknown[]> }
        session: {
          list: () => Promise<{ data: unknown[]; cursor: object }>
          create: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
        }
      }
    }
    internals.client = {
      project: {
        // المحرك يعرف المشروع بصيغة ويندوز القانونية (شرطة مائلة عكسية)
        list: () => Promise.resolve([
          { id: "p1", canonical: "E:\\mSales\\app", name: "app", time: { created: 1, updated: 2, active: 0 } },
        ]),
      },
      session: {
        list: () => Promise.resolve({ data: [], cursor: {} }),
        create: (input) => {
          created.push(input)
          return Promise.resolve(sessionSummary("ses_new", "E:\\mSales\\app"))
        },
      },
    }

    // المشروع المُعدّ مكتوب بصيغة مختلفة (سلاش)، والاختيار لازم يرجّعه قانونيًا
    await service.selectProject("E:\\mSales\\app")
    expect(internals.selectedProjectDirectory).toBe("E:\\mSales\\app")

    await service.createSession()
    expect(created[0]).toMatchObject({ location: { directory: "E:\\mSales\\app" } })
  })
})

describe("v2 session shapes", () => {
  it("maps session list items to the stable wire format", async () => {
    const { service } = createService()

    const sessions = await service.sessions()
    expect(sessions).toEqual([{
      id: SESSION,
      title: "",
      directory: DIRECTORY,
      time: { created: 1, updated: 2 },
    } satisfies { id: string; title: string; directory: string; time: { created: number; updated: number } }])
  })

  it("creates sessions with a location and renames through get", async () => {
    const created: Array<Record<string, unknown>> = []
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: {
        session: {
          create: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
          update: (input: Record<string, unknown>) => Promise<unknown>
          get: () => Promise<Record<string, unknown>>
        }
      }
    }
    internals.client = {
      session: {
        create: (input: Record<string, unknown>) => {
          created.push(input)
          return Promise.resolve({ ...sessionSummary("ses_new", DIRECTORY), title: input["title"] ?? "" })
        },
        update: () => Promise.resolve(undefined),
        get: () => Promise.resolve({ ...sessionSummary("ses_new", DIRECTORY), title: "اسم جديد" }),
      },
    }

    const session = await service.createSession("اسم جديد")
    expect(session.title).toBe("اسم جديد")
    expect(created[0]).toMatchObject({ title: "اسم جديد", location: { directory: DIRECTORY } })

    const renamed = await service.updateSession("ses_new", "اسم أحدث")
    expect(renamed.title).toBe("اسم جديد")
  })

  it("replies to a form with keyed answers", async () => {
    const replied: Array<Record<string, unknown>> = []
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: { session: { form: {
        list: () => Promise<unknown[]>
        reply: (input: Record<string, unknown>) => Promise<unknown>
        cancel: (input: Record<string, unknown>) => Promise<unknown>
      } } }
    }
    internals.client = {
      session: {
        form: {
          list: () => Promise.resolve([{
            id: "form_1",
            sessionID: SESSION,
            title: "اختر",
            fields: [
              { key: "color", type: "string", title: "اللون", options: [{ value: "red", label: "أحمر", description: "" }] },
              {
                key: "extras",
                type: "multiselect",
                title: "إضافات",
                options: [{ value: "a", label: "أ", description: "" }, { value: "b", label: "ب", description: "" }],
              },
            ],
          }]),
          reply: (input: Record<string, unknown>) => {
            replied.push(input)
            return Promise.resolve(undefined)
          },
          cancel: () => Promise.resolve(undefined),
        },
      },
    }

    const questions = await service.sessionQuestions(SESSION)
    expect(questions[0]?.questions.map((question) => question.question)).toEqual(["اللون", "إضافات"])
    expect(questions[0]?.questions[1]?.multiple).toBe(true)

    await expect(service.replyQuestion(SESSION, "form_1", [["red"], ["a", "b"]])).resolves.toBe(true)
    expect(replied[0]).toEqual({ sessionID: SESSION, formID: "form_1", answer: { color: "red", extras: ["a", "b"] } })
  })

  it("tracks permission requests from v2 events", async () => {
    const { service, emit } = createService()

    emit({
      type: "permission.asked",
      data: { id: "perm_1", sessionID: SESSION, action: "shell", resources: ["rm -rf"], message: "" },
    } as unknown as OpenCodeEvent)
    expect(service.permissions()).toEqual([{
      id: "perm_1",
      sessionID: SESSION,
      title: "shell",
      pattern: "rm -rf",
    }])

    emit({ type: "permission.replied", data: { sessionID: SESSION, requestID: "perm_1" } } as unknown as OpenCodeEvent)
    expect(service.permissions()).toEqual([])
  })

  it("collects tool file outputs from v2 message content", async () => {
    const { service, fake } = createService()

    fake.messages = [
      userMessage("msg_u1", "ابنِ التقرير", 1_000),
      {
        id: "msg_a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "opencode" },
        time: { created: 1_100, completed: 1_200 },
        content: [
          { type: "text", text: "تم" },
          {
            type: "tool",
            id: "call_1",
            name: "write",
            state: {
              status: "completed",
              input: {},
              content: [{ type: "file", uri: "file:///tmp/report.pdf", mime: "application/pdf", name: "report.pdf" }],
            },
            time: { created: 1_150, completed: 1_200 },
          },
        ],
      },
    ]

    const history = await service.history(SESSION)
    expect(history[0]?.files.map((file) => file.name)).toEqual(["report.pdf"])
    expect(history[0]?.finalResult).toBe("تم")
  })

  it("surfaces the user's prompt attachments on the request", async () => {
    const { service, fake } = createService()

    fake.messages = [
      userMessage("msg_u1", "شوف الصورة", 1_000, [
        { data: "", mime: "image/png", source: { type: "uri", uri: "data:image/png;base64,AAA" }, name: "screen.png" },
        { data: "QkFTRTY0", mime: "application/pdf", source: { type: "inline" } },
      ]),
      assistantMessage("msg_a1", "تم", 1_100, 1_200),
    ]

    const result = await service.requests(SESSION)
    expect(result.requests[0]?.attachments).toEqual([
      { name: "screen.png", mime: "image/png", uri: "data:image/png;base64,AAA" },
      { name: "attachment", mime: "application/pdf", uri: "data:application/pdf;base64,QkFTRTY0" },
    ])
  })
})

// العطل الأصلي: مهمة Task بتفتح جلسات ابن، و`session.active` بيرجّع كل واحدة
// "running" لوحدها. قبل الإصلاح محادثة واحدة على أربع مهام فرعية كانت بتعدّ
// خمس محادثات نشطة في العدّاد وفي القائمة الجانبية. الجذر هو وحدة العرض.
describe("subtask sessions collapse onto their root", () => {
  const ROOT = "ses_root"
  const KIDS = ["ses_kid_a", "ses_kid_b", "ses_kid_c", "ses_kid_d"]
  // `noUncheckedIndexedAccess` مفعّل في tsconfig السيرفر، فـ `KIDS[0]` نوعه
  // `string | undefined`. الدالة دي بتغلّف الفهرس في guard واحد بدل cast
  // متكرّر في كل سطر اختبار.
  function KID(index: number): string {
    const id = KIDS[index]
    if (id === undefined) {
      throw new Error(`لا توجد مهمة فرعية عند ${index}`)
    }
    return id
  }

  function subtaskService(runningIds: string[]) {
    const listed: Array<Record<string, unknown>> = [
      { ...sessionSummary(ROOT, DIRECTORY), title: "المحادثة الأم" },
      ...KIDS.map((id) => ({ ...sessionSummary(id, DIRECTORY), title: `مهمة ${id}`, parentID: ROOT })),
    ]
    const active: Record<string, unknown> = {}
    for (const id of runningIds) {
      active[id] = { type: "running" }
    }
    const service = new OpenCodeService({ projectDirectory: DIRECTORY })
    const internals = service as unknown as Internals & {
      client: {
        session: {
          list: () => Promise<{ data: Array<Record<string, unknown>>; cursor: object }>
          active: () => Promise<unknown>
        }
      }
    }
    internals.client = {
      session: {
        list: () => Promise.resolve({ data: listed, cursor: {} }),
        active: () => Promise.resolve(active),
      },
    }
    return { service, internals }
  }

  it("يعدّ المحادثة الأم مرة واحدة مهما اشتغلت من مهامها الفرعية", async () => {
    const { service } = subtaskService([ROOT, ...KIDS])

    const items = await service.activity("ar")
    expect(items.map((item) => item.id)).toEqual([ROOT])
    expect(items[0]?.title).toBe("المحادثة الأم")
  })

  it("يعدّ المهمة الأم شغالة حتى لو شغّالتها ابنها", async () => {
    // المحادثة الأم نفسها idle في الـ poll، والمهام الفرعية هي الشغالة
    const { service } = subtaskService(KIDS)

    await expect(service.statuses()).resolves.toEqual({ [ROOT]: { type: "busy" } })
  })

  it("يخفي المهام الفرعية من قائمة محادثات المشروع", async () => {
    const { service } = subtaskService([])

    const sessions = await service.sessions()
    expect(sessions.map((session) => session.id)).toEqual([ROOT])
  })

  // صوت الإتمام كان بيتشغّل مع كل مهمة فرعية تخلص، لأن حالة كل جلسة بتبعت
  // على الـ id بتاعها والعميل بيعامل المهمة كمحادثة مستقلة. الخريطة دي بتربط
  // كل مهمة بأمها عشان الحالة تنسب للجذر.
  it("ينسب المهمة الفرعية لمحادثتها الأم من حدث الإنشاء", () => {
    const { service, internals } = subtaskService([])

    internals.trackEvent({ type: "session.created", data: { sessionID: KID(0), parentID: ROOT } } as unknown as OpenCodeEvent)

    expect(service.conversationOf(KID(0))).toBe(ROOT)
    expect(service.conversationOf(ROOT)).toBe(ROOT)
  })

  it("ينسب المهمة جوه مهمة على نفس المحادثة الأم", () => {
    const { service, internals } = subtaskService([])

    internals.trackEvent({ type: "session.created", data: { sessionID: "ses_mid", parentID: ROOT } } as unknown as OpenCodeEvent)
    internals.trackEvent({ type: "session.created", data: { sessionID: "ses_leaf", parentID: "ses_mid" } } as unknown as OpenCodeEvent)

    expect(service.conversationOf("ses_leaf")).toBe(ROOT)
  })

  // المهمة اللي فاتتها أحداث الإنشاء (اتعملت قبل ما السيرفر يتصل) لازم
  // ترجع لنسبتها من قائمة الجلسات زي أول مرة.
  it("ينسب المهمة من قائمة الجلسات لما فاتتها أحداث الإنشاء", async () => {
    const { service } = subtaskService([])

    await service.statuses()

    expect(service.conversationOf(KID(1))).toBe(ROOT)
  })

  it("يعتبر المحادثة شغّالة لو مهمة فرعية من مهامها شغّالة", () => {
    const { service, internals } = subtaskService([])

    internals.trackEvent({ type: "session.created", data: { sessionID: KID(0), parentID: ROOT } } as unknown as OpenCodeEvent)
    internals.trackEvent({ type: "session.status", data: { sessionID: KID(0), status: { type: "busy" } } } as unknown as OpenCodeEvent)

    expect(service.conversationBusy(ROOT)).toBe(true)
    expect(service.conversationBusy(KID(0))).toBe(true)
  })

  it("يخلّي المحادثة خاملة بعد خلوص آخر مهمة فرعية", () => {
    const { service, internals } = subtaskService([])

    for (const kid of KIDS) {
      internals.trackEvent({ type: "session.created", data: { sessionID: kid, parentID: ROOT } } as unknown as OpenCodeEvent)
      internals.trackEvent({ type: "session.status", data: { sessionID: kid, status: { type: "busy" } } } as unknown as OpenCodeEvent)
    }
    internals.trackEvent({ type: "session.idle", data: { sessionID: KID(0) } } as unknown as OpenCodeEvent)
    // أول مهمة خلصت والتانية لسه شغّالة ⇒ المحادثة الأم لسه شغّالة
    expect(service.conversationBusy(ROOT)).toBe(true)

    for (const kid of KIDS.slice(1)) {
      internals.trackEvent({ type: "session.idle", data: { sessionID: kid } } as unknown as OpenCodeEvent)
    }
    expect(service.conversationBusy(ROOT)).toBe(false)
  })

  it("ينسى الجلسة المحذوفة من خريطة الجذور", () => {
    const { service, internals } = subtaskService([])

    internals.trackEvent({ type: "session.created", data: { sessionID: KID(0), parentID: ROOT } } as unknown as OpenCodeEvent)
    internals.trackEvent({ type: "session.deleted", data: { sessionID: KID(0) } } as unknown as OpenCodeEvent)

    expect(service.conversationOf(KID(0))).toBe(KID(0))
  })
})
