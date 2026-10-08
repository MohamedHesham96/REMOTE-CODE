import { afterEach, describe, expect, it, vi } from "vitest"
import { containsWakePhrase, defaultWakePhrase, effectiveWakePhrase, getSavedWakeWordEnabled, getSavedWakeWordPhrase, isValidWakePhrase, saveWakeWordEnabled, saveWakeWordPhrase } from "./wake-word"

// كلمة التنبيه حساسة للتفاصيل: عبارة قصيرة بتفتح اللوحة بالغلط، وتطبيع ناقص
// بيخلّي العبارة ما تتطابقش مع اختلافات كتابة المحرّك. الاختبارات دي بتثبّت
// القرارين دول.

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  })
}

describe("defaultWakePhrase", () => {
  it("بيرجّع عبارة عربية للواجهة العربية", () => {
    expect(defaultWakePhrase("ar")).toBe("يا ريموت")
  })

  it("بيرجّع عبارة إنجليزية للواجهة الإنجليزية", () => {
    expect(defaultWakePhrase("en")).toBe("hey remote")
  })
})

describe("effectiveWakePhrase", () => {
  it("بيستخدم العبارة المكتوبة بعد التنظيف", () => {
    expect(effectiveWakePhrase("  افتح يا سمسم  ", "ar")).toBe("افتح يا سمسم")
  })

  it("بيرجع للافتراضي لما المكتوب فاضي أو مسافات", () => {
    expect(effectiveWakePhrase("", "ar")).toBe("يا ريموت")
    expect(effectiveWakePhrase("   ", "en")).toBe("hey remote")
  })
})

describe("isValidWakePhrase", () => {
  it("بترفض العبارة الفاضية أو القصيرة", () => {
    expect(isValidWakePhrase("")).toBe(false)
    expect(isValidWakePhrase("   ")).toBe(false)
    expect(isValidWakePhrase("يا")).toBe(false)
    expect(isValidWakePhrase("ab")).toBe(false)
  })

  it("التشكيل مش بيتحسب طول — يا بتفضل قصيرة", () => {
    expect(isValidWakePhrase("يَا")).toBe(false)
  })

  it("بتقبل عبارة من تلات أحرف أو أكتر", () => {
    expect(isValidWakePhrase("ريمو")).toBe(true)
    expect(isValidWakePhrase("يا ريموت")).toBe(true)
    expect(isValidWakePhrase("hey")).toBe(true)
  })
})

describe("containsWakePhrase", () => {
  it("بتلقط العبارة جوه جملة أطول", () => {
    expect(containsWakePhrase("يا ريموت افتح المشروع", "يا ريموت")).toBe(true)
    expect(containsWakePhrase("hey remote open the project", "hey remote")).toBe(true)
  })

  it("بتتجاهل التشكيل واختلاف الهمزات وطريقة الكتابة", () => {
    expect(containsWakePhrase("يَا رِيمُوت", "يا ريموت")).toBe(true)
    expect(containsWakePhrase("أهلا يا ريموت", "اهلا")).toBe(true)
    expect(containsWakePhrase("Hey Remote please", "hey remote")).toBe(true)
  })

  it("بترجع false لما العبارة مش موجودة أو فاضية", () => {
    expect(containsWakePhrase("افتح المشروع", "يا ريموت")).toBe(false)
    expect(containsWakePhrase("أي كلام", "")).toBe(false)
    expect(containsWakePhrase("أي كلام", "   ")).toBe(false)
  })
})

describe("تخزين إعدادات كلمة التنبيه", () => {
  it("بيقرأ ويكتب من التخزين المحلي", () => {
    stubStorage()
    expect(getSavedWakeWordEnabled()).toBe(false)
    saveWakeWordEnabled(true)
    expect(getSavedWakeWordEnabled()).toBe(true)
    saveWakeWordEnabled(false)
    expect(getSavedWakeWordEnabled()).toBe(false)

    expect(getSavedWakeWordPhrase()).toBe("")
    saveWakeWordPhrase("يا ريمو")
    expect(getSavedWakeWordPhrase()).toBe("يا ريمو")
  })

  it("بيرجّع الافتراضي الآمن لما التخزين مش متاح", () => {
    vi.stubGlobal("localStorage", undefined)
    expect(getSavedWakeWordEnabled()).toBe(false)
    expect(getSavedWakeWordPhrase()).toBe("")
  })
})
