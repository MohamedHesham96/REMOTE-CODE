import { describe, expect, it } from "vitest"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client"
import { serverMessage } from "../i18n.js"
import { activityKey, toolSignature, usedToolActivities } from "./activity.js"

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

function tool(id: string, name: string, status: SessionMessageAssistantTool["state"]["status"]): SessionMessageAssistantTool {
  return { type: "tool", id, name, state: { status }, time: { created: 0 } } as unknown as SessionMessageAssistantTool
}

function assistant(...parts: SessionMessageAssistant["content"]): SessionMessageAssistant {
  return {
    id: "msg",
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "opencode" },
    time: { created: 0 },
    content: parts,
  } as unknown as SessionMessageAssistant
}

// "قائمة المستخدم" في واجهة الديسكتوب: الأدوات اللي المهمة استعملتها فعلًا.
describe("usedToolActivities", () => {
  it("lists executed tools in order and skips the ones still streaming", () => {
    const entries = [
      assistant(tool("t1", "read", "completed"), tool("t2", "bash", "streaming")),
      assistant(tool("t3", "edit", "running")),
    ]
    expect(usedToolActivities(entries, "ar")).toEqual([
      serverMessage("activityReadingFiles", "ar"),
      serverMessage("activityApplyingChanges", "ar"),
    ])
  })

  it("collapses duplicate descriptions so the list stays distinct tools", () => {
    const entries = [assistant(tool("t1", "read", "completed"), tool("t2", "list", "completed"))]
    expect(usedToolActivities(entries, "ar")).toEqual([serverMessage("activityReadingFiles", "ar")])
  })

  it("falls back to the raw tool name for unknown tools", () => {
    const entries = [assistant(tool("t1", "mcp__acme__deploy", "completed"))]
    expect(usedToolActivities(entries, "ar")).toEqual([`${serverMessage("usesTool", "ar")} mcp__acme__deploy`])
  })
})

describe("toolSignature", () => {
  it("changes when a tool appears or changes state", () => {
    expect(toolSignature([])).toBe("")
    const running = toolSignature([assistant(tool("t1", "read", "running"))])
    expect(running).toBe("t1:running")
    const completed = toolSignature([assistant(tool("t1", "read", "completed"))])
    expect(completed).not.toBe(running)
  })
})
