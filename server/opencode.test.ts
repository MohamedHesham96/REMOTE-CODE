import type { Event, SessionStatus } from "@opencode-ai/sdk"
import { describe, expect, it } from "vitest"
import { OpenCodeService } from "./opencode.js"

const SESSION = "ses_test"

interface FakeClient {
  dispatched: string[]
  abortCalls: number
  session: Record<string, unknown>
}

function createFakeClient(raw: { status: SessionStatus }): FakeClient {
  const fake: FakeClient = {
    dispatched: [],
    abortCalls: 0,
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
      messages: () => Promise.resolve({ data: [] }),
      todo: () => Promise.resolve({ data: [] }),
      list: () => Promise.resolve({ data: [] }),
      update: () => Promise.resolve({ data: {} }),
      delete: () => Promise.resolve({ data: true }),
    },
  }
  return fake
}

interface Internals {
  clientFor: (directory?: string) => unknown
  globalClient: unknown
  trackEvent: (event: Event) => void
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
    emit: (event: Event) => internals.trackEvent(event),
  }
}

function idleEvent(): Event {
  return { type: "session.idle", properties: { sessionID: SESSION } } as unknown as Event
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
