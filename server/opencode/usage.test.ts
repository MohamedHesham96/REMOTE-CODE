import { describe, expect, it } from "vitest"
import type { SessionMessageAssistant } from "@opencode/client"
import { sessionUsage, sumUsage } from "./usage.js"

function assistant(overrides: Partial<SessionMessageAssistant> & { id?: string } = {}): SessionMessageAssistant {
  return {
    id: "msg_1",
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: 1_000, completed: 1_500 },
    content: [],
    ...overrides,
  } as unknown as SessionMessageAssistant
}

function tokens(input: number, output: number, reasoning = 0, cacheRead = 0, cacheWrite = 0) {
  return { input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } }
}

describe("sumUsage", () => {
  it("sums the engine formula (input + output + reasoning + cache)", () => {
    const usage = sumUsage([
      assistant({ id: "a", tokens: tokens(100, 40, 5, 10, 2), cost: 0.01 }),
      assistant({ id: "b", tokens: tokens(200, 60), cost: 0.02 }),
    ])
    expect(usage.tokens).toEqual({
      input: 300,
      output: 100,
      reasoning: 5,
      cacheRead: 10,
      cacheWrite: 2,
      total: 417,
    })
    expect(usage.cost).toBeCloseTo(0.03)
  })

  it("counts each message once even when the engine returns it twice", () => {
    const message = assistant({ id: "dup", tokens: tokens(10, 5), cost: 0.5 })
    const usage = sumUsage([message, message, assistant({ id: "dup", tokens: tokens(10, 5), cost: 0.5 })])
    expect(usage.tokens?.total).toBe(15)
    expect(usage.cost).toBe(0.5)
  })

  it("reports tokens as unavailable instead of zero when there is no data", () => {
    const usage = sumUsage([assistant({ id: "a" }), assistant({ id: "b" })])
    expect(usage.tokens).toBeNull()
    expect(usage.cost).toBeNull()
  })

  it("keeps a real zero cost from a free model", () => {
    const usage = sumUsage([assistant({ id: "a", tokens: tokens(10, 5), cost: 0 })])
    expect(usage.tokens?.total).toBe(15)
    expect(usage.cost).toBe(0)
  })

  it("withholds the total cost when any token-bearing message has no cost", () => {
    const usage = sumUsage([
      assistant({ id: "a", tokens: tokens(10, 5), cost: 0.2 }),
      assistant({ id: "b", tokens: tokens(20, 5) }),
    ])
    expect(usage.tokens?.total).toBe(40)
    expect(usage.cost).toBeNull()
  })

  it("ignores non-finite costs", () => {
    const usage = sumUsage([assistant({ id: "a", tokens: tokens(10, 5), cost: Number.NaN })])
    expect(usage.cost).toBeNull()
  })
})

describe("sessionUsage", () => {
  it("aggregates turns, counts requests, and sums per-request durations", () => {
    const usage = sessionUsage([
      {
        createdAt: 1_000,
        updatedAt: 2_100,
        completedAt: 2_000,
        entries: [assistant({ id: "a", tokens: tokens(100, 40, 0, 10), cost: 0.1 })],
      },
      {
        createdAt: 3_000,
        updatedAt: 4_500,
        completedAt: 5_000,
        entries: [assistant({ id: "b", tokens: tokens(200, 60), cost: 0.2 })],
      },
    ])
    expect(usage.requests).toBe(2)
    expect(usage.durationMs).toBe((2_000 - 1_000) + (5_000 - 3_000))
    expect(usage.tokens?.input).toBe(300)
    expect(usage.tokens?.total).toBe(410)
    expect(usage.cost).toBeCloseTo(0.3)
  })

  it("does not count the same message twice across turns", () => {
    const shared = assistant({ id: "shared", tokens: tokens(50, 25), cost: 0.1 })
    const usage = sessionUsage([
      { createdAt: 0, updatedAt: 1_000, completedAt: 1_000, entries: [shared] },
      { createdAt: 1_000, updatedAt: 2_000, completedAt: 2_000, entries: [shared] },
    ])
    expect(usage.tokens?.total).toBe(75)
    expect(usage.cost).toBeCloseTo(0.1)
  })

  it("uses the running turn's last update for the duration when it has not completed", () => {
    const usage = sessionUsage([
      { createdAt: 5_000, updatedAt: 7_500, completedAt: 0, entries: [] },
    ])
    expect(usage.durationMs).toBe(2_500)
    expect(usage.tokens).toBeNull()
  })
})
