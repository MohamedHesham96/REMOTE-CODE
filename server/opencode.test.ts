import type { Event, Message, Part, SessionStatus } from "@opencode-ai/sdk"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { OpenCodeService } from "./opencode.js"

vi.mock("./desktop-projects.js", () => ({
  collectDesktopProjectDirectories: (): string[] => [],
  desktopDatabasePath: (): string => "",
}))

const SESSION = "ses_test"

interface FakeClient {
  dispatched: string[]
  abortCalls: number
  messages: Array<{ info: Message; parts: Part[] }>
  session: Record<string, unknown>
}

function createFakeClient(raw: { status: SessionStatus }): FakeClient {
  const fake: FakeClient = {
    dispatched: [],
    abortCalls: 0,
    messages: [],
    session: {
      promptAsync: (options: { body: { parts?: Array<{ text?: string }> } }) => {
        fake.dispatched.push(options.body.parts?.[0]?.text ?? "")
        return Promise.resolve({ data: {} })
      },
      abort: () => {
        fake.abortCalls += 1
        return Promise.resolve({ data: true })
      },
      status: () => Promise.resolve({ data: { [SESSION]: raw.status } }),
      messages: () => Promise.resolve({ data: fake.messages }),
      todo: () => Promise.resolve({ data: [] }),
      list: () => Promise.resolve({ data: [] }),
      update: () => Promise.resolve({ data: {} }),
      delete: () => Promise.resolve({ data: true }),
    },
  }
  return fake
}

function textPart(text: string): Part {
  return { id: `prt_${text}`, type: "text", text } as unknown as Part
}

function userMessage(id: string, text: string, created: number): { info: Message; parts: Part[] } {
  return {
    info: { id, role: "user", sessionID: SESSION, time: { created } } as unknown as Message,
    parts: [textPart(text)],
  }
}

function assistantMessage(id: string, text: string, created: number, completed?: number): { info: Message; parts: Part[] } {
  return {
    info: {
      id,
      role: "assistant",
      sessionID: SESSION,
      time: { created, ...(completed === undefined ? {} : { completed }) },
    } as unknown as Message,
    parts: [textPart(text)],
  }
}

interface Internals {
  clientFor: (directory?: string) => unknown
  globalClient: unknown
  trackEvent: (event: Event) => void
  busySessions: Set<string>
  runningSessions: Set<string>
  idlePolls: Map<string, number>
  startQueueWatchdog: () => void
  variantsCache: unknown
}

function createService() {
  const raw = { status: { type: "idle" } as SessionStatus }
  const fake = createFakeClient(raw)
  const service = new OpenCodeService({ projectDirectory: process.cwd(), username: "test", port: 0 })
  const internals = service as unknown as Internals
  internals.clientFor = () => fake
  internals.globalClient = { question: { list: () => Promise.resolve({ data: [] }) } }

  return {
    service,
    fake,
    raw,
    busySessions: internals.busySessions,
    runningSessions: internals.runningSessions,
    internals,
    emit: (event: Event) => internals.trackEvent(event),
  }
}

function idleEvent(): Event {
  return { type: "session.idle", properties: { sessionID: SESSION } } as unknown as Event
}

function busyEvent(): Event {
  return { type: "session.status", properties: { sessionID: SESSION, status: { type: "busy" } } } as unknown as Event
}

function errorEvent(): Event {
  return { type: "session.error", properties: { sessionID: SESSION, error: { name: "UnknownError" } } } as unknown as Event
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
    raw.status = { type: "idle" }
    await expect(service.statuses()).resolves.toMatchObject({ [SESSION]: { type: "busy" } })

    emit(idleEvent())
    raw.status = { type: "idle" }
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

  it("runs a queued request now by stopping the running one", async () => {
    const { service, fake } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")
    await service.prompt(SESSION, "التالت")

    // آخر طلب في الطابور هو اللي عايز ينفّذ حالًا
    await expect(service.runQueued(SESSION, "queued:q3")).resolves.toEqual({ started: true, remaining: 1 })
    // اللي كان شغّال اتوقّف، والمطلوب اتبعّ قبل أي طلب تاني مستني
    expect(fake.abortCalls).toBe(1)
    expect(fake.dispatched).toEqual(["الأول", "التالت"])
  })

  it("does not send twice from the idle of the request it stopped for run-now", async () => {
    const { service, fake, emit } = createService()

    await service.prompt(SESSION, "الأول")
    await service.prompt(SESSION, "التاني")

    const running = service.runQueued(SESSION, "queued:q2")
    // الـ idle بيوصل قبل ما يخلص الإيقاف — لازم ما تبعتش طلب وانت لسه بتوقف
    emit(idleEvent())
    await running

    expect(fake.dispatched).toEqual(["الأول", "التاني"])
    emit(idleEvent())
    expect(fake.dispatched).toEqual(["الأول", "التاني"])
  })

  it("ignores run-now for a request that is not queued", async () => {
    const { service, fake } = createService()

    await service.prompt(SESSION, "الأول")
    await expect(service.runQueued(SESSION, "queued:q1")).resolves.toEqual({ started: false, remaining: 0 })
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
    raw.status = { type: "busy" }

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
    raw.status = { type: "busy" }
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
    raw.status = { type: "busy" }

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
    raw.status = { type: "busy" }

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
    raw.status = { type: "busy" }

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

  it("stops showing a finished request as running while OpenCode stays busy", async () => {
    const { service, fake, raw, runningSessions } = createService()

    fake.messages = [
      userMessage("msg_u1", "الطلب", 1_000),
      assistantMessage("msg_a1", "النتيجة", 1_100, 1_200),
    ]
    await service.prompt(SESSION, "الطلب")
    expect(runningSessions.has(SESSION)).toBe(true)
    // Task خلصت على الديسكتوب، بس OpenCode واقف على busy والـ idle ضاع
    raw.status = { type: "busy" }

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
      raw.status = { type: "idle" }

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
  // OpenCode بيرجّع الـ variants في /config/providers كـ object map:
  // { low: { reasoningEffort: "low" }, high: { ... } }
  function variantService(variants: unknown, switchCalls: Array<Record<string, unknown>> = []) {
    const service = new OpenCodeService({ projectDirectory: process.cwd(), username: "test", port: 0 })
    const internals = service as unknown as Internals
    internals.globalClient = {
      config: {
        providers: () => Promise.resolve({
          data: {
            providers: [{
              id: "opencode",
              models: {
                "space-bunny-free": {
                  name: "Space Bunny Free",
                  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                  variants,
                },
              },
            }],
          },
        }),
      },
      v2: {
        model: { list: () => Promise.resolve({ data: [] }) },
        session: {
          switchModel: (options: { model: Record<string, unknown> }) => {
            switchCalls.push(options.model)
            return Promise.resolve({ data: {} })
          },
        },
      },
    }
    // نمنع الكاش من leaking بين التستات
    internals.variantsCache = null
    return { service, switchCalls }
  }

  it("reads variants from the config providers object map", async () => {
    const { service } = variantService({ high: { reasoningEffort: "high" }, low: { reasoningEffort: "low" } })

    const models = await service.models()

    expect(models[0]?.variants).toEqual(["low", "high"])
  })

  it("orders the levels from lowest to highest", async () => {
    const { service } = variantService({ max: {}, xhigh: {}, high: {}, medium: {}, low: {} })

    const models = await service.models()

    expect(models[0]?.variants).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  it("switches the session model to the chosen level", async () => {
    const { service, switchCalls } = variantService({ low: {}, high: {}, max: {} })

    await expect(service.switchSessionModel(SESSION, "opencode", "space-bunny-free", "max")).resolves.toEqual({
      providerID: "opencode",
      modelID: "space-bunny-free",
      variant: "max",
    })
    expect(switchCalls[0]).toEqual({ id: "space-bunny-free", providerID: "opencode", variant: "max" })
  })

  it("clears the level when the default chip is picked", async () => {
    const { service, switchCalls } = variantService({ low: {}, high: {} })

    await expect(service.switchSessionModel(SESSION, "opencode", "space-bunny-free", "")).resolves.toEqual({
      providerID: "opencode",
      modelID: "space-bunny-free",
    })
    expect(switchCalls[0]).toEqual({ id: "space-bunny-free", providerID: "opencode" })
  })

  it("rejects a level the model does not declare", async () => {
    const { service } = variantService({ low: {}, high: {} })

    await expect(service.switchSessionModel(SESSION, "opencode", "space-bunny-free", "ultra")).rejects.toThrow(/variant not found/i)
  })

  it("leaves models without declared levels alone", async () => {
    const { service } = variantService(undefined)

    const models = await service.models()

    expect(models[0]?.variants).toBeUndefined()
  })
})

describe("response caching and dedup", () => {
  function activityService(counts: { list: number; status: number }) {
    const service = new OpenCodeService({ projectDirectory: process.cwd(), username: "test", port: 0 })
    const internals = service as unknown as Internals
    internals.globalClient = {
      experimental: {
        session: {
          list: () => {
            counts.list += 1
            return Promise.resolve({ data: [] })
          },
        },
      },
      question: { list: () => Promise.resolve({ data: [] }) },
    }
    internals.clientFor = () => ({
      session: {
        status: () => {
          counts.status += 1
          return Promise.resolve({ data: {} })
        },
      },
    })
    return { service, internals }
  }

  it("serves activity from the short cache and dedups concurrent calls", async () => {
    const counts = { list: 0, status: 0 }
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
    const counts = { list: 0, status: 0 }
    const { service, internals } = activityService(counts)

    await service.activity("ar")
    expect(counts.list).toBe(1)

    internals.trackEvent({ type: "session.status", properties: { sessionID: SESSION, status: { type: "busy" } } } as unknown as Event)
    await service.activity("ar")
    expect(counts.list).toBe(2)
  })

  it("caches the model catalog between calls", async () => {
    let providerCalls = 0
    const service = new OpenCodeService({ projectDirectory: process.cwd(), username: "test", port: 0 })
    const internals = service as unknown as Internals
    internals.globalClient = {
      config: {
        providers: () => {
          providerCalls += 1
          return Promise.resolve({
            data: {
              providers: [{
                id: "opencode",
                models: {
                  "space-bunny-free": {
                    name: "Space Bunny Free",
                    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                    variants: { low: {} },
                  },
                },
              }],
            },
          })
        },
      },
      v2: { model: { list: () => Promise.resolve({ data: [] }) } },
    }
    internals.variantsCache = null

    const first = await service.models()
    const second = await service.models()
    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(providerCalls).toBe(1)
  })

  it("caches question lists and invalidates them on question events", async () => {
    let listCalls = 0
    const service = new OpenCodeService({ projectDirectory: process.cwd(), username: "test", port: 0 })
    const internals = service as unknown as Internals
    internals.globalClient = {
      question: {
        list: () => {
          listCalls += 1
          return Promise.resolve({ data: [] })
        },
      },
    }

    await service.sessionQuestions(SESSION)
    await service.sessionQuestions(SESSION)
    expect(listCalls).toBe(1)

    internals.trackEvent({ type: "question.asked", properties: { sessionID: SESSION } } as unknown as Event)
    await service.sessionQuestions(SESSION)
    expect(listCalls).toBe(2)
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
    // الاستيراد موك أعلى الملف حتى لا يقرأ التست قاعدة الديسكتوب الحقيقية
    const service = new OpenCodeService({ projectDirectory: "E:/mSales/app", username: "test", port: 0 })
    const internals = service as unknown as {
      baseClient: { project: { list: () => Promise<{ data: unknown[] }> } }
      globalClient: { experimental: { session: { list: () => Promise<{ data: unknown[] }> } } }
    }
    internals.baseClient = {
      project: {
        list: () => Promise.resolve({
          data: [
            { id: "p1", worktree: "E:/mSales/app", time: { created: 1 } },
            { id: "junk-root", worktree: "/", time: { created: 1 } },
            { id: "junk-drive", worktree: "E:\\", time: { created: 1 } },
            { id: "junk-relative", worktree: "Workshop", time: { created: 1 } },
            { id: "junk-home", worktree: homedir(), time: { created: 1 } },
          ],
        }),
      },
    }
    internals.globalClient = {
      experimental: {
        session: {
          list: () => Promise.resolve({
            data: [
              { directory: "E:/mSales/app2", time: { created: 2 } },
              { directory: "E:", time: { created: 2 } },
            ],
          }),
        },
      },
    }
    const projects = await service.projects()
    expect(projects.map((project) => project.worktree).sort()).toEqual(["E:/mSales/app", "E:/mSales/app2"])
  })
})
