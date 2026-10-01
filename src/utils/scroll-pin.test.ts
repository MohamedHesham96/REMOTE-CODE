import { describe, expect, it } from "vitest"
import { nextScrollPinState, SCROLL_PIN_MAX_FRAMES, SCROLL_PIN_STABLE_FRAMES } from "./scroll-pin"

// بيشغّل قياسات متتالية: أول قياس بيفتح الحالة والباقي بيمرّر اللي بعده.
// settledAfter = ترتيب أول قياس خلّى التثبيت (null) أو -1 لو خلصش.
function drive(heights: number[]): { last: number; settledAfter: number } {
  let state = nextScrollPinState(null, heights[0] ?? 0)
  let settledAfter = state === null ? 0 : -1
  let last = state === null ? -1 : state.stableFrames
  for (let index = 1; index < heights.length; index += 1) {
    state = nextScrollPinState(state, heights[index] ?? 0)
    if (state === null) {
      if (settledAfter === -1) {
        settledAfter = index
      }
      continue
    }
    last = state.stableFrames
  }
  return { last, settledAfter }
}

describe("nextScrollPinState", () => {
  it("أول قياس بيفتح حالة جديدة من غير إطارات مستقرة", () => {
    expect(nextScrollPinState(null, 1200)).toEqual({ stableFrames: 0, lastHeight: 1200, frames: 1 })
  })

  it("طول ما المحتوى بيكبر مفيش استقرار", () => {
    const result = drive([1000, 1000, 1800, 1800, 2600, 2600, 2600, 2600])
    expect(result.settledAfter).toBe(-1)
    expect(result.last).toBe(3)
  })

  it("المحتوى المستقر بيخلّي التثبيت يخلص", () => {
    const result = drive([900, 900, 900, 900, 900, 900, 900])
    expect(result.settledAfter).toBe(SCROLL_PIN_STABLE_FRAMES)
  })

  it("طول غير معروف (العنصر لسه مش متركّب) ما بيستقرش", () => {
    const result = drive(Array.from({ length: 12 }, () => Number.NaN))
    expect(result.settledAfter).toBe(-1)
    expect(result.last).toBe(0)
  })

  it("ميزانية الإطارات بتوقف التثبيت حتى لو المحتوى بيكبر طول الوقت", () => {
    const heights = Array.from({ length: SCROLL_PIN_MAX_FRAMES + 10 }, (_value, index) => 1000 + index)
    expect(drive(heights).settledAfter).toBe(SCROLL_PIN_MAX_FRAMES - 1)
  })
})
