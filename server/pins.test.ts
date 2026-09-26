import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MAX_PINS, parsePinnedConversation, PinService } from "./pins.js"

let dir = ""
let file = ""

function pin(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `title ${id}`,
    created: 1000,
    directory: `/srv/${id}`,
    worktree: "/srv",
    projectName: "srv",
    ...overrides,
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pins-test-"))
  file = join(dir, "pins.json")
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("parsePinnedConversation", () => {
  it("keeps a well formed entry", () => {
    expect(parsePinnedConversation(pin("ses_a"))).toEqual({
      id: "ses_a",
      title: "title ses_a",
      created: 1000,
      directory: "/srv/ses_a",
      worktree: "/srv",
      projectName: "srv",
    })
  })

  it("rejects entries without a usable id", () => {
    expect(() => parsePinnedConversation(null)).toThrow("INVALID_PIN")
    expect(() => parsePinnedConversation({ title: "no id" })).toThrow("INVALID_PIN")
    expect(() => parsePinnedConversation({ id: "   " })).toThrow("INVALID_PIN")
  })

  it("coerces a missing or broken created time to zero", () => {
    expect(parsePinnedConversation({ id: "ses_a" }).created).toBe(0)
    expect(parsePinnedConversation({ id: "ses_a", created: "nope" }).created).toBe(0)
    expect(parsePinnedConversation({ id: "ses_a", created: 12.7 }).created).toBe(12)
  })

  it("trims and truncates oversized text instead of storing it raw", () => {
    const parsed = parsePinnedConversation({ id: " ses_a ", title: "  hello  ", worktree: "x".repeat(5000) })
    expect(parsed.id).toBe("ses_a")
    expect(parsed.title).toBe("hello")
    expect(parsed.worktree).toHaveLength(1024)
  })
})

describe("PinService", () => {
  it("starts empty when the file does not exist", () => {
    expect(new PinService(file).list()).toEqual([])
  })

  it("puts the newest pin first", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    await service.add(pin("ses_b"))
    expect(service.list().map((item) => item.id)).toEqual(["ses_b", "ses_a"])
  })

  it("keeps pins from every project side by side", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { worktree: "/srv/one", projectName: "one" }))
    await service.add(pin("ses_b", { worktree: "/srv/two", projectName: "two" }))
    expect(service.list().map((item) => item.projectName)).toEqual(["two", "one"])
  })

  it("moves a re-pinned conversation to the top and refreshes its data", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { title: "old" }))
    await service.add(pin("ses_b"))
    await service.add(pin("ses_a", { title: "new" }))
    const list = service.list()
    expect(list.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(list[0]?.title).toBe("new")
  })

  it("never duplicates a pin", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    await service.add(pin("ses_a"))
    expect(service.list()).toHaveLength(1)
  })

  it("removes one pin and leaves the rest alone", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    await service.add(pin("ses_b"))
    expect((await service.remove("ses_a")).map((item) => item.id)).toEqual(["ses_b"])
  })

  it("ignores a remove for an id that is not pinned", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    expect((await service.remove("ses_zz")).map((item) => item.id)).toEqual(["ses_a"])
    expect((await service.remove("")).map((item) => item.id)).toEqual(["ses_a"])
  })

  it("forgets a batch of deleted conversations in one call", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    await service.add(pin("ses_b"))
    await service.add(pin("ses_c"))
    expect((await service.forget(["ses_a", "ses_c", "ses_missing"])).map((item) => item.id)).toEqual(["ses_b"])
  })

  it("rejects a forget call without a list", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    expect((await service.forget("ses_a")).map((item) => item.id)).toEqual(["ses_a"])
    expect((await service.forget([])).map((item) => item.id)).toEqual(["ses_a"])
  })

  it("rejects an invalid pin instead of storing a partial entry", async () => {
    const service = new PinService(file)
    await expect(service.add({ title: "no id" })).rejects.toThrow("INVALID_PIN")
    expect(service.list()).toEqual([])
  })

  it("caps the list so the file cannot grow forever", async () => {
    const service = new PinService(file)
    for (let index = 0; index < MAX_PINS + 10; index += 1) {
      await service.add(pin(`ses_${index}`))
    }
    expect(service.list()).toHaveLength(MAX_PINS)
  })

  it("replaces the whole list for a recovering client", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    const next = await service.replace([pin("ses_x"), pin("ses_a"), pin("ses_x")])
    expect(next.map((item) => item.id)).toEqual(["ses_x", "ses_a"])
  })

  it("survives a restart by reloading the file", async () => {
    await new PinService(file).add(pin("ses_a", { projectName: "one" }))
    expect(new PinService(file).list().map((item) => item.id)).toEqual(["ses_a"])
  })

  it("ignores a corrupt file instead of crashing at boot", async () => {
    await writeFile(file, "{not json", "utf8")
    expect(new PinService(file).list()).toEqual([])
  })

  it("drops malformed and duplicate entries when loading a hand-edited file", async () => {
    await writeFile(
      file,
      JSON.stringify({ version: 1, pins: [pin("ses_a"), { title: "no id" }, pin("ses_a"), pin("ses_b")] }),
      "utf8",
    )
    expect(new PinService(file).list().map((item) => item.id)).toEqual(["ses_a", "ses_b"])
  })

  it("writes the stored list to disk so another device can read it", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    const raw = JSON.parse(await readFile(file, "utf8")) as { version: number; pins: Array<{ id: string }> }
    expect(raw.version).toBe(1)
    expect(raw.pins.map((item) => item.id)).toEqual(["ses_a"])
  })
})
