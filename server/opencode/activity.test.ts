import { describe, expect, it } from "vitest"
import { activityKey } from "./activity.js"

describe("activityKey", () => {
  it("maps read tools to reading files", () => {
    expect(activityKey("read")).toBe("activityReadingFiles")
    expect(activityKey("list")).toBe("activityReadingFiles")
  })

  it("maps search tools to searching the code", () => {
    expect(activityKey("grep")).toBe("activitySearchingFiles")
    expect(activityKey("glob")).toBe("activitySearchingFiles")
  })

  it("maps shell tools to running a command", () => {
    expect(activityKey("bash")).toBe("activityRunningCommand")
  })

  it("maps editors to applying changes", () => {
    expect(activityKey("edit")).toBe("activityApplyingChanges")
    expect(activityKey("write")).toBe("activityApplyingChanges")
    expect(activityKey("apply_patch")).toBe("activityApplyingChanges")
  })

  it("keeps web tools on the web bucket", () => {
    expect(activityKey("webfetch")).toBe("activityBrowsingWeb")
  })

  it("maps sub-tasks to delegation", () => {
    expect(activityKey("task")).toBe("activityDelegating")
  })

  // أسماء الأدوات في المحرك نص حر، وأدوات MCP بتنزل أسماء جديدة. الرجوع
  // لـ null مقصود: المتصل بيعرض الاسم الخام بدل ما يبقى الترجمة فاضية
  // أو الكود يكسر على أول اسم مش معروف.
  it("returns null for an unknown tool so the raw name can be shown", () => {
    expect(activityKey("mcp__acme__deploy")).toBeNull()
  })

  it("ignores casing and provider prefixes", () => {
    expect(activityKey("BASH")).toBe("activityRunningCommand")
    expect(activityKey("acme_read_file")).toBe("activityReadingFiles")
  })
})
