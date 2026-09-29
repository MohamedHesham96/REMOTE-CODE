import { describe, expect, it } from "vitest"
import { consoleLang } from "./i18n.js"

// لغة الكونسول تُقرأ من APP_LANG فقط — بلا أي اعتماد على الطلبات.
describe("consoleLang", () => {
  it("defaults to Arabic", () => {
    expect(consoleLang({})).toBe("ar")
    expect(consoleLang({ APP_LANG: "" })).toBe("ar")
    expect(consoleLang({ APP_LANG: "ar" })).toBe("ar")
    expect(consoleLang({ APP_LANG: "fr" })).toBe("ar")
  })

  it("switches to English", () => {
    expect(consoleLang({ APP_LANG: "en" })).toBe("en")
    expect(consoleLang({ APP_LANG: "EN" })).toBe("en")
    expect(consoleLang({ APP_LANG: "en-US" })).toBe("en")
  })
})
