import { describe, expect, it } from "vitest"
import { strings } from "../i18n"
import type { SessionUsage } from "../types"
import { formatCost, formatDuration, formatTokenCount, sameRequestUsage, sameSessionUsage } from "./usage"

function usage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    tokens: {
      input: 100,
      output: 50,
      reasoning: 5,
      cacheRead: 10,
      cacheWrite: 2,
      total: 167,
    },
    cost: 0.42,
    requests: 3,
    durationMs: 872_000,
    ...overrides,
  }
}

describe("formatTokenCount", () => {
  it("keeps small counts and compacts thousands and millions", () => {
    expect(formatTokenCount(0)).toBe("0")
    expect(formatTokenCount(999)).toBe("999")
    expect(formatTokenCount(12_400)).toBe("12.4K")
    expect(formatTokenCount(51_100)).toBe("51.1K")
    expect(formatTokenCount(1_250_000)).toBe("1.3M")
  })
})

describe("formatCost", () => {
  it("shows a real zero but never invents one for unknown values", () => {
    expect(formatCost(0)).toBe("$0.00")
    expect(formatCost(0.42)).toBe("$0.42")
    expect(formatCost(0.0042)).toBe("$0.0042")
  })
})

describe("formatDuration", () => {
  it("formats durations with the interface units in both languages", () => {
    expect(formatDuration(872_000, strings.ar)).toBe("14 د 32 ث")
    expect(formatDuration(872_000, strings.en)).toBe("14 m 32 s")
    expect(formatDuration(45_000, strings.ar)).toBe("45 ث")
    expect(formatDuration(3_600_000, strings.en)).toBe("1 h 0 m")
  })
})

describe("usage equality", () => {
  it("treats identical usage as equal and any difference as changed", () => {
    expect(sameRequestUsage(undefined, undefined)).toBe(true)
    expect(sameRequestUsage(usage(), usage())).toBe(true)
    expect(sameRequestUsage(usage(), usage({ cost: null }))).toBe(false)
    expect(sameRequestUsage(usage(), { tokens: null, cost: 0.42 })).toBe(false)
  })

  it("compares the session counters as well", () => {
    expect(sameSessionUsage(usage(), usage())).toBe(true)
    expect(sameSessionUsage(usage(), usage({ requests: 4 }))).toBe(false)
    expect(sameSessionUsage(usage(), usage({ durationMs: 1 }))).toBe(false)
    expect(sameSessionUsage(null, null)).toBe(true)
    expect(sameSessionUsage(null, usage())).toBe(false)
  })
})
