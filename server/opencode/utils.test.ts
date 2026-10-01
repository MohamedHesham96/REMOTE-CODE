import { homedir } from "node:os"
import { describe, expect, it } from "vitest"
import {
  hasHiddenSegment,
  isAbsoluteProjectPath,
  isFilesystemRoot,
  isListableProjectDirectory,
  parseCliVersion,
  sessionRoots,
  parseStaticCatalog,
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

// صيغة `opencode --version` اختلفت بين v1 (رقم مجرّد) و v2 (اسم + v) — والمقارنة
// الحرفية كانت ترفض تثبيتًا صحيحًا، فالدالة لازم تتعامل مع الصيغتين.
describe("parseCliVersion", () => {
  it("يلتقط الرقم من صيغة v2 و v1", () => {
    expect(parseCliVersion("opencode v2.0.18")).toBe("2.0.18")
    expect(parseCliVersion("1.18.32")).toBe("1.18.32")
    expect(parseCliVersion("v2.1.0\n")).toBe("2.1.0")
  })

  it("يعيد نصًا فارغًا بلا رقم إصدار", () => {
    expect(parseCliVersion("")).toBe("")
    expect(parseCliVersion("command not found")).toBe("")
  })
})

<<<<<<< Updated upstream
// العطل الأصلي: مهمة Task بتفتح جلسات ابن، و`session.active` بيرجّع كل واحدة
// "running" لوحدها، فمحادثة واحدة على أربع مهام فرعية بتعدّ أربع محادثات
// نشطة. الجذر هو وحدة العرض الصح.
describe("sessionRoots", () => {
  it("يرجّع الجذور وحدها من قائمة فيها مهام فرعية", () => {
    const { roots } = sessionRoots([
      { id: "ses_root" },
      { id: "ses_a", parentID: "ses_root" },
      { id: "ses_b", parentID: "ses_root" },
      { id: "ses_other" },
    ])
    expect(roots).toEqual(["ses_root", "ses_other"])
  })

  it("ينسب كل مهمة فرعية للجذر بتاعها", () => {
    const { rootOf } = sessionRoots([
      { id: "ses_root" },
      { id: "ses_a", parentID: "ses_root" },
      { id: "ses_b", parentID: "ses_root" },
    ])
    expect(rootOf.get("ses_root")).toBe("ses_root")
    expect(rootOf.get("ses_a")).toBe("ses_root")
    expect(rootOf.get("ses_b")).toBe("ses_root")
  })

  it("يكمل الصعود لمهمة جوه مهمة", () => {
    const { roots, rootOf } = sessionRoots([
      { id: "ses_root" },
      { id: "ses_mid", parentID: "ses_root" },
      { id: "ses_leaf", parentID: "ses_mid" },
    ])
    expect(roots).toEqual(["ses_root"])
    expect(rootOf.get("ses_leaf")).toBe("ses_root")
  })

  // أب مش موجود في نفس الصفحة (سقف الترقيم) — أحسن نعرض الجلسة كجذر من ما
  // نخفيها خالص عن المستخدم.
  it("يعتبر الجلسة جذرًا لو أبوها مش في القائمة", () => {
    const { roots, rootOf } = sessionRoots([
      { id: "ses_a", parentID: "ses_missing" },
    ])
    expect(roots).toEqual(["ses_a"])
    expect(rootOf.get("ses_a")).toBe("ses_a")
  })

  it("يتوقف عند حلقة بدل ما يعلق", () => {
    const { rootOf } = sessionRoots([
      { id: "ses_a", parentID: "ses_b" },
      { id: "ses_b", parentID: "ses_a" },
    ])
    expect(rootOf.get("ses_a")).toBeDefined()
    expect(rootOf.get("ses_b")).toBeDefined()
  })

  it("يتعامل مع القائمة الفاضية", () => {
    expect(sessionRoots([])).toEqual({ roots: [], rootOf: new Map() })
  })
})

// تحليل كتالوج models.dev العام — دالة خالصة بلا IO، فتُختبر بعينات ثابتة
describe("parseStaticCatalog", () => {
  it("يحوّل الموفرات والنماذج لعناصر عرض معطّلة", () => {
    const items = parseStaticCatalog({
      anthropic: {
        id: "anthropic",
        models: {
          "claude-sonnet-4-5": { name: "Claude Sonnet 4.5", cost: { input: 3, output: 15, cache_read: 0.3 } },
          "free-thing": { name: "Free Thing", cost: { input: 0, output: 0 } },
        },
      },
    })

    expect(items).toEqual([
      { id: "claude-sonnet-4-5", providerID: "anthropic", name: "Claude Sonnet 4.5", free: false, enabled: false },
      { id: "free-thing", providerID: "anthropic", name: "Free Thing", free: true, enabled: false },
    ])
  })

  it("غياب السعر لا يعني المجانية، والاسم الفارغ يسقط على الـ id", () => {
    const items = parseStaticCatalog({
      acme: { models: { coder: {} } },
    })

    expect(items).toEqual([
      { id: "coder", providerID: "acme", name: "coder", free: false, enabled: false },
    ])
  })

  it("يرفض الحمولات التالفة بدل ما يرمي", () => {
    expect(parseStaticCatalog(null)).toEqual([])
    expect(parseStaticCatalog("oops")).toEqual([])
    expect(parseStaticCatalog({ acme: null, broken: { models: null }, empty: {} })).toEqual([])
  })
})
