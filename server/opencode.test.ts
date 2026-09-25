import type { Event, Message, Part, SessionStatus } from "@opencode-ai/sdk"
import { describe, expect, it } from "vitest"
import { OpenCodeService } from "./opencode.js"

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

  it("releases the busy flag when OpenCode reports an error instead of going idle", async () => {
    const { emit, busySessions } = createService()

    emit(busyEvent())
    expect(busySessions.has(SESSION)).toBe(true)

    // الخطأ بيقفل الشغل من غير idle بعدها — الجلسة كانت هتفضل شغّال للأبد
    emit(errorEvent())
    expect(busySessions.has(SESSION)).toBe(false)
  })
})
