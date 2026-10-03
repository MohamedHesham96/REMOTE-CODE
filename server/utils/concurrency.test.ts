import { describe, expect, it } from "vitest"
import { mapWithConcurrency } from "./concurrency.js"

describe("mapWithConcurrency", () => {
  it("preserves order and caps concurrency", async () => {
    let running = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return value * 10
    })
    expect(results).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBeLessThanOrEqual(2)
  })

  it("handles an empty list and serial execution", async () => {
    await expect(mapWithConcurrency([], 5, async (value: number) => value)).resolves.toEqual([])
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3], 1, async (value) => {
      seen.push(value)
    })
    expect(seen).toEqual([1, 2, 3])
  })
})
