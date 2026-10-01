import { describe, expect, it } from "vitest"
import { pingFrame } from "./events.js"

// النبضة لازم تكون حدثًا مسمّى: التعليق (`: ...`) بيستهلكه المتصفح ولا يوصل
// للجافاسكربت، فالاختبار ده بيقفل الباب على الرجوع لتعليق من غير ما نلاحظ.
describe("pingFrame", () => {
  it("is a named SSE event that carries data, not a comment", () => {
    const frame = pingFrame()
    expect(frame.startsWith("event: ping\n")).toBe(true)
    expect(frame).toContain("data: {}")
    expect(frame.endsWith("\n\n")).toBe(true)
    expect(frame.startsWith(":")).toBe(false)
  })
})
