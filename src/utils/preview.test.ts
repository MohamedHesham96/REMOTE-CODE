import { describe, expect, it } from "vitest"
import { tailPreview } from "./preview"

describe("tailPreview", () => {
  it("returns the whole text when it already fits", () => {
    expect(tailPreview("سطر أول\nسطر تاني", 6, 400)).toBe("سطر أول\nسطر تاني")
  })

  it("keeps only the last lines when there are more than the limit", () => {
    const text = ["l1", "l2", "l3", "l4"].join("\n")
    expect(tailPreview(text, 2, 400)).toBe("l3\nl4")
  })

  // الفقرات الطويلة بلا فواصل أسطر: القصّ بعدد الأسطر وحده كان هيرجّع النص
  // كامل، فميزانية الأحرف هي اللي بتحكم، وبناخدها من الآخر.
  it("caps from the end once the char budget is exceeded", () => {
    const text = "a".repeat(50) + "\n" + "b".repeat(50)
    expect(tailPreview(text, 6, 20)).toBe("b".repeat(20))
  })
})
