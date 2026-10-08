import { afterEach, describe, expect, it, vi } from "vitest"
import { acquireMic, currentMicOwner, releaseMic, subscribeMic } from "./mic-lock"

// السجل حالة عامة على مستوى الوحدة: كل اختبار بينضّف التوكنات اللي خدها عشان
// مايسيبش ملكية معلّقة تغيّر نتيجة اللي بعده.

const first = Symbol("first")
const second = Symbol("second")

afterEach(() => {
  releaseMic(first)
  releaseMic(second)
})

describe("mic-lock", () => {
  it("يتتبع صاحب الميكروفون الحالي", () => {
    expect(currentMicOwner()).toBeNull()
    acquireMic(first)
    expect(currentMicOwner()).toBe(first)
    releaseMic(first)
    expect(currentMicOwner()).toBeNull()
  })

  it("مايفلتش الملكية من توكن مش صاحبها", () => {
    acquireMic(first)
    releaseMic(second)
    expect(currentMicOwner()).toBe(first)
  })

  it("بيعيد الاستحواذ لنفس التوكن من غير إشعار مكرر", () => {
    acquireMic(first)
    const listener = vi.fn()
    const unsubscribe = subscribeMic(listener)
    acquireMic(first)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("بيبلّغ المستمعين بالاستحواذ والإفراج", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMic(listener)
    acquireMic(first)
    releaseMic(first)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it("بيوقف الإشعار بعد إلغاء الاشتراك", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMic(listener)
    unsubscribe()
    acquireMic(first)
    expect(listener).not.toHaveBeenCalled()
  })
})
