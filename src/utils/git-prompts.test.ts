import { describe, expect, it } from "vitest"
import { commitPrompt, pullPrompt, revertAllPrompt, revertFilePrompt } from "./git-prompts"
import type { GitChangeFile } from "../types"

function file(path: string, status: GitChangeFile["status"]): GitChangeFile {
  return { path, status, added: 1, removed: 0 }
}

describe("git prompts", () => {
  it("names the branch in the commit request only when there is one", () => {
    expect(commitPrompt([file("a.ts", "modified")], "main", "en")).toContain("branch 'main'")
    expect(commitPrompt([file("a.ts", "modified")], "", "en")).not.toContain("branch ''")
  })

  it("keeps the commit-only request local and forbids pushing", () => {
    const prompt = commitPrompt([file("a.ts", "modified")], "main", "en")
    expect(prompt).toContain("without pushing")
    expect(prompt).toContain("branch 'main'")
    expect(prompt).toContain("- a.ts (modified)")
    expect(prompt).toContain("Do not push")
  })

  it("stops at the first conflict on a pull instead of resolving it", () => {
    const prompt = pullPrompt("main", "en")
    expect(prompt).toContain("branch 'main'")
    expect(prompt).toContain("stop and explain it")
    expect(prompt).toContain("Do not commit or push")
  })

  it("omits the branch in a pull when there is none", () => {
    expect(pullPrompt("", "ar")).not.toContain("''")
  })

  it("tells the agent to restore a tracked file instead of deleting it", () => {
    const prompt = revertFilePrompt(file("src/a.ts", "modified"), "en")
    expect(prompt).toContain("src/a.ts")
    expect(prompt).toContain("git restore")
    expect(prompt).not.toContain("delete it from disk")
  })

  it("tells the agent to delete an untracked file because there is nothing to restore", () => {
    const prompt = revertFilePrompt(file("src/new.ts", "added"), "en")
    expect(prompt).toContain("delete it from disk")
    expect(prompt).not.toContain("git restore")
  })

  it("scopes a single-file revert and forbids touching anything else", () => {
    const prompt = revertFilePrompt(file("src/a.ts", "modified"), "ar")
    expect(prompt).toContain("ممنوع تلمس أي ملف تاني")
  })

  it("forbids committing on a full revert", () => {
    const prompt = revertAllPrompt([file("a.ts", "modified"), file("b.ts", "deleted")], "en")
    expect(prompt).toContain("Do not commit or push")
    expect(prompt).toContain("- a.ts (modified)")
    expect(prompt).toContain("- b.ts (deleted)")
  })

  it("caps the file list so a huge working tree does not flood the request", () => {
    const files = Array.from({ length: 120 }, (_unused, index) => file(`f${index}.ts`, "modified"))
    const prompt = revertAllPrompt(files, "en")
    expect(prompt).toContain("- f49.ts (modified)")
    expect(prompt).not.toContain("- f50.ts (modified)")
  })
})
