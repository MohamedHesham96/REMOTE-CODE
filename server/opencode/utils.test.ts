import { homedir } from "node:os"
import { describe, expect, it } from "vitest"
import {
  hasHiddenSegment,
  isAbsoluteProjectPath,
  isFilesystemRoot,
  isListableProjectDirectory,
} from "./utils.js"

// فحص الشكل نصّي خالص: يعمل بثبات على وندوز ولينكس لأنه لا يعتمد IO ولا
// واجهة المسارات الخاصة بالمنصة، فتُختبر صيغ وندوز حتى من لينكس.
describe("isAbsoluteProjectPath", () => {
  it("يقبل المطلق اليونكسي والوندوزي والشبكي", () => {
    expect(isAbsoluteProjectPath("/srv/one")).toBe(true)
    expect(isAbsoluteProjectPath("E:/mSales/app")).toBe(true)
    expect(isAbsoluteProjectPath("E:\\mSales\\app")).toBe(true)
    expect(isAbsoluteProjectPath("\\\\server\\share")).toBe(true)
  })

  it("يرفض النسبي والنسبي للقرص والفارغ", () => {
    expect(isAbsoluteProjectPath("Workshop")).toBe(false)
    expect(isAbsoluteProjectPath("mSales - Project - 2026")).toBe(false)
    expect(isAbsoluteProjectPath("E:")).toBe(false)
    expect(isAbsoluteProjectPath("")).toBe(false)
    expect(isAbsoluteProjectPath("   ")).toBe(false)
  })
})

describe("isFilesystemRoot", () => {
  it("يكشف جذر يونكس وجذور أقراص وندوز", () => {
    expect(isFilesystemRoot("/")).toBe(true)
    expect(isFilesystemRoot("E:\\")).toBe(true)
    expect(isFilesystemRoot("E:/")).toBe(true)
    expect(isFilesystemRoot("c:")).toBe(true)
  })

  it("لا يخلط المجلد الحقيقي بالجذر", () => {
    expect(isFilesystemRoot("E:/mSales")).toBe(false)
    expect(isFilesystemRoot("/srv")).toBe(false)
  })
})

describe("hasHiddenSegment", () => {
  it("يكشف أعشاش الـ worktree المؤقتة", () => {
    expect(hasHiddenSegment("E:/app/.claude/worktrees/x")).toBe(true)
    expect(hasHiddenSegment("/srv/.git/config")).toBe(true)
  })

  it("يترك المسارات العادية", () => {
    expect(hasHiddenSegment("E:/mSales/app")).toBe(false)
    expect(hasHiddenSegment("/srv/one")).toBe(false)
  })
})

describe("isListableProjectDirectory", () => {
  it("يرفض غير النص والبيت بأي صيغة شرطات", () => {
    expect(isListableProjectDirectory(undefined, homedir())).toBe(false)
    expect(isListableProjectDirectory(42, homedir())).toBe(false)
    expect(isListableProjectDirectory(homedir(), homedir())).toBe(false)
    expect(isListableProjectDirectory(homedir().replace(/\\/g, "/"), homedir())).toBe(false)
  })

  it("يقبل المجلد المطلق العادي", () => {
    expect(isListableProjectDirectory("E:/mSales/app", homedir())).toBe(true)
    expect(isListableProjectDirectory("/srv/one", homedir())).toBe(true)
  })
})
