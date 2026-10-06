import { describe, expect, it } from "vitest"
import { appendClipboardText } from "./composer-text"

describe("appendClipboardText", () => {
  it("يحط النص زي ما هو لما المسودة تكون فاضية", () => {
    expect(appendClipboardText("", "الجملة")).toBe("الجملة")
  })

  // علة الحقل الفاضي: كروم بيرجّع "\n" لحقل فيه <br> وحده. لازم النص يحلّ
  // مكان الفراغ بدل ما ينزل سطر جديد تحته.
  it("يتجاهل المسودة اللي فيها أسطر فاضية بس", () => {
    expect(appendClipboardText("\n", "الجملة")).toBe("الجملة")
    expect(appendClipboardText("\n\n", "الجملة")).toBe("الجملة")
    expect(appendClipboardText("  \n  ", "الجملة")).toBe("الجملة")
  })

  it("يفصل بمسافة لما المسودة فيها نص", () => {
    expect(appendClipboardText("اكتب هنا", "الجملة")).toBe("اكتب هنا الجملة")
  })

  it("ما يكرّرش المسافة لو آخر المسودة مسافة", () => {
    expect(appendClipboardText("اكتب هنا ", "الجملة")).toBe("اكتب هنا الجملة")
    expect(appendClipboardText("اكتب هنا\n", "الجملة")).toBe("اكتب هنا\nالجملة")
  })
})
