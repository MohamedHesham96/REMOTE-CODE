import { describe, expect, it } from "vitest"
import { resolve } from "node:path"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client"
import { collectResultFiles } from "./result-files.js"

const project = resolve("repo")

function tool(name: string, state: Record<string, unknown> = {}): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: `t-${name}`,
    name,
    state: { status: "completed", ...state },
    time: { created: 0 },
  } as unknown as SessionMessageAssistantTool
}

function assistant(content: SessionMessageAssistant["content"], snapshot?: { files?: string[] }): SessionMessageAssistant {
  return {
    id: "msg",
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "opencode" },
    time: { created: 0 },
    content,
    ...(snapshot ? { snapshot } : {}),
  } as unknown as SessionMessageAssistant
}

// القاعدة: ملفات النتيجة لازم تظهر من نداءات الأدوات حتى لو المشروع بدون Git
// (بدون snapshot)، وبنفس الوقت ما نتسرّبش قراءات read/grep كملفات ناتجة.
describe("collectResultFiles", () => {
  it("collects files written by the write tool without a git snapshot", () => {
    const absolute = resolve(project, "kids-memory-game.html")
    const files = collectResultFiles("ses1", [assistant([tool("write", { input: { path: absolute } })])], "en", project)
    expect(files).toHaveLength(1)
    expect(files[0]?.name).toBe("kids-memory-game.html")
    expect(files[0]?.downloadUrl).toContain(encodeURIComponent(absolute))
  })

  it("ignores read and grep tool paths", () => {
    const entries = [
      assistant([
        tool("read", { input: { path: resolve(project, "a.ts") } }),
        tool("grep", { input: { path: resolve(project, "b.ts") } }),
      ]),
    ]
    expect(collectResultFiles("ses1", entries, "en", project)).toEqual([])
  })

  it("uses editor metadata files and skips deleted ones", () => {
    const entries = [
      assistant([
        tool("edit", {
          input: { path: resolve(project, "src/a.ts") },
          metadata: {
            files: [
              { file: "src/a.ts", status: "modified" },
              { file: "src/gone.ts", status: "deleted" },
            ],
          },
        }),
      ]),
    ]
    const files = collectResultFiles("ses1", entries, "en", project)
    expect(files.map((file) => file.name)).toEqual(["a.ts"])
  })

  it("deduplicates the same file coming from a snapshot and a tool input", () => {
    const absolute = resolve(project, "final files", "couples-game.html")
    const entries = [
      assistant([tool("write", { input: { path: absolute } })], { files: ["final files/couples-game.html"] }),
    ]
    expect(collectResultFiles("ses1", entries, "en", project)).toHaveLength(1)
  })

  it("keeps file attachments exposed by tool output", () => {
    const entries = [
      assistant([tool("read", { content: [{ type: "file", uri: "https://example.com/x.png", name: "x.png", mime: "image/png" }] })])
    ]
    const files = collectResultFiles("ses1", entries, "en", project)
    expect(files).toHaveLength(1)
    expect(files[0]?.downloadUrl).toBe("https://example.com/x.png")
  })

  it("drops written files outside the project so links are never broken", () => {
    const entries = [assistant([tool("write", { input: { path: resolve(project, "..", "tmp", "helper.js") } })])]
    expect(collectResultFiles("ses1", entries, "en", project)).toEqual([])
  })

  it("still reads git snapshot files when the tool exposes nothing", () => {
    const entries = [assistant([], { files: ["dist/app.js"] })]
    const files = collectResultFiles("ses1", entries, "en", project)
    expect(files.map((file) => file.name)).toEqual(["app.js"])
  })
})
