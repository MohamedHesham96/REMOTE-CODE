import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_PINS, parsePinnedConversation, pinProjectKey, PinService } from "./pins.js"

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
      projectKey: "/srv",
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

  it("derives the project key from the paths and ignores a client claimed one", () => {
    // العميل ما يقدرش ينسب محادثة لمشروع مش بتاعها: الـ projectKey بيتحسب
    // على السيرفر من المسارات نفسها
    expect(parsePinnedConversation(pin("ses_a", { projectKey: "/srv/evil" })).projectKey).toBe("/srv")
    expect(parsePinnedConversation({ id: "ses_a", worktree: "C:\\Work\\App" }).projectKey).toBe("c:/work/app")
    expect(parsePinnedConversation({ id: "ses_a", directory: "/srv/two" }).projectKey).toBe("/srv/two")
  })

  it("leaves a pin with no path at all unattributed instead of guessing a project", () => {
    expect(parsePinnedConversation({ id: "ses_legacy" }).projectKey).toBe("")
  })
})

describe("pinProjectKey", () => {
  it("prefers the worktree and normalizes the path", () => {
    expect(pinProjectKey("/srv/one/", "/srv/one/nested")).toBe("/srv/one")
    expect(pinProjectKey("", "/srv/two")).toBe("/srv/two")
    expect(pinProjectKey("", "")).toBe("")
    expect(pinProjectKey("C:\\Work\\App", "")).toBe(pinProjectKey("c:/work/app/", ""))
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
    expect(raw.version).toBe(2)
    expect(raw.pins.map((item) => item.id)).toEqual(["ses_a"])
  })
})

describe("pins per project", () => {
  it("lists only the pins of the requested project", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { worktree: "/srv/one", projectName: "one" }))
    await service.add(pin("ses_b", { worktree: "/srv/two", projectName: "two" }))
    await service.add(pin("ses_c", { worktree: "/srv/one", projectName: "one" }))

    expect(service.listForProject("/srv/one").map((item) => item.id)).toEqual(["ses_c", "ses_a"])
    expect(service.listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_b"])
    expect(service.listForProject("/srv/three")).toEqual([])
  })

  it("normalizes the requested project path the same way the pins are stored", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { worktree: "C:\\Work\\App", projectName: "App" }))
    expect(service.listForProject("c:/work/app/").map((item) => item.id)).toEqual(["ses_a"])
    expect(service.listForProject("C:\\Work\\Other")).toEqual([])
  })

  it("shows nothing for an unknown or missing project, so pins never leak sideways", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    expect(service.listForProject("")).toEqual([])
    expect(service.listForProject("   ")).toEqual([])
    expect(service.listForProject(null)).toEqual([])
  })

  it("keeps every project independent when a pin is removed", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { worktree: "/srv/one" }))
    await service.add(pin("ses_b", { worktree: "/srv/two" }))
    await service.remove("ses_a")
    expect(service.listForProject("/srv/one")).toEqual([])
    expect(service.listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_b"])
  })

  it("counts the pins of each project", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { worktree: "/srv/one", projectName: "one" }))
    await service.add(pin("ses_b", { worktree: "/srv/one", projectName: "one" }))
    await service.add(pin("ses_c", { worktree: "/srv/two", projectName: "two" }))
    await service.add({ id: "ses_legacy" })
    expect(service.projects()).toEqual([
      { projectKey: "/srv/one", name: "one", count: 2 },
      { projectKey: "/srv/two", name: "two", count: 1 },
    ])
  })

  it("moves a conversation to another project only if it is pinned again from there", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { worktree: "/srv/one" }))
    // إعادة التثبيت من مشروع تاني بتنسبها للمشروع الجديد على السيرفر
    await service.add(pin("ses_a", { worktree: "/srv/two" }))
    expect(service.listForProject("/srv/one")).toEqual([])
    expect(service.listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_a"])
  })
})

describe("merge instead of replace", () => {
  it("adds the incoming pins without dropping the stored ones", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_server", { worktree: "/srv/one" }))
    const merged = await service.merge([pin("ses_device", { worktree: "/srv/two" })])
    expect(merged.map((item) => item.id)).toEqual(["ses_server", "ses_device"])
  })

  it("keeps the server copy when the same conversation comes from a device", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { title: "server" }))
    const merged = await service.merge([pin("ses_a", { title: "device" }), pin("ses_b")])
    expect(merged.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(merged[0]?.title).toBe("server")
  })

  it("never duplicates a conversation that arrives twice", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    const merged = await service.merge([pin("ses_a"), pin("ses_a"), pin("ses_b"), pin("ses_b")])
    expect(merged.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
  })

  it("ignores malformed incoming entries instead of failing the whole merge", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    const merged = await service.merge([{ title: "no id" }, "ses_legacy", pin("ses_b")])
    expect(merged.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
  })

  it("does not rewrite or broadcast when there is nothing new", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    const listener = vi.fn()
    service.subscribe(listener)
    const before = await readFile(file, "utf8")
    expect((await service.merge([pin("ses_a")])).map((item) => item.id)).toEqual(["ses_a"])
    expect(await readFile(file, "utf8")).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("change broadcast", () => {
  it("notifies subscribers with the new list on every real change", async () => {
    const service = new PinService(file)
    const seen: string[][] = []
    service.subscribe((list) => seen.push(list.map((item) => item.id)))
    await service.add(pin("ses_a"))
    await service.add(pin("ses_b"))
    await service.remove("ses_a")
    await service.forget(["ses_b"])
    expect(seen).toEqual([["ses_a"], ["ses_b", "ses_a"], ["ses_b"], []])
  })

  it("stops notifying after unsubscribe", async () => {
    const service = new PinService(file)
    const listener = vi.fn()
    const off = service.subscribe(listener)
    await service.add(pin("ses_a"))
    off()
    await service.add(pin("ses_b"))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("keeps writing the other subscribers when one of them throws", async () => {
    const service = new PinService(file)
    const good = vi.fn()
    service.subscribe(() => { throw new Error("boom") })
    service.subscribe(good)
    await expect(service.add(pin("ses_a"))).resolves.toHaveLength(1)
    expect(good).toHaveBeenCalledTimes(1)
  })

  it("does not broadcast a no-op pin or unpin", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a"))
    const listener = vi.fn()
    service.subscribe(listener)
    await service.add(pin("ses_a", { title: "title ses_a" }))
    await service.remove("ses_missing")
    await service.forget([])
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("migration from older pin files", () => {
  it("keeps v1 pins and gives each one its project from the stored paths", async () => {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        pins: [
          pin("ses_a", { worktree: "/srv/one", projectName: "one" }),
          pin("ses_b", { worktree: "/srv/two", projectName: "two" }),
        ],
      }),
      "utf8",
    )
    const service = new PinService(file)
    expect(service.list().map((item) => [item.id, item.projectKey])).toEqual([
      ["ses_a", "/srv/one"],
      ["ses_b", "/srv/two"],
    ])
    expect(service.listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_b"])
  })

  it("rewrites the old file in the new shape so it is upgraded only once", async () => {
    await writeFile(file, JSON.stringify({ version: 1, pins: [pin("ses_a")] }), "utf8")
    new PinService(file)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const raw = JSON.parse(await readFile(file, "utf8")) as { version: number; pins: Array<{ projectKey: string }> }
    expect(raw.version).toBe(2)
    expect(raw.pins[0]?.projectKey).toBe("/srv")
  })

  it("keeps an old pin with no path but never shows it in a project", async () => {
    await writeFile(
      file,
      JSON.stringify({ version: 1, pins: [{ id: "ses_legacy", title: "", created: 0, directory: "", worktree: "", projectName: "" }] }),
      "utf8",
    )
    const service = new PinService(file)
    expect(service.list().map((item) => item.id)).toEqual(["ses_legacy"])
    expect(service.unattributed().map((item) => item.id)).toEqual(["ses_legacy"])
    expect(service.listForProject("/srv")).toEqual([])
    expect(service.listForProject("/")).toEqual([])
    expect(service.projects()).toEqual([])
  })

  it("reads a file with no version at all", async () => {
    await writeFile(file, JSON.stringify({ pins: [pin("ses_a")] }), "utf8")
    expect(new PinService(file).list().map((item) => item.id)).toEqual(["ses_a"])
  })
})

describe("attributing pins to their project", () => {
  function resolverFor(known: Record<string, { worktree: string; projectName?: string }>) {
    return vi.fn(async (sessionIds: string[]): Promise<Map<string, { worktree: string; projectName?: string }>> => {
      const found = new Map<string, { worktree: string; projectName?: string }>()
      for (const id of sessionIds) {
        const project = known[id]
        if (project) {
          found.set(id, project)
        }
      }
      return found
    })
  }

  it("asks the resolver for a pin with no project and moves it into place", async () => {
    const service = new PinService(file)
    const resolver = resolverFor({ ses_known: { worktree: "/srv/two", projectName: "two" } })
    service.setProjectResolver(resolver)
    await service.add({ id: "ses_known", title: "legacy", created: 1 })

    await vi.waitFor(() => expect(service.listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_known"]))
    expect(resolver).toHaveBeenCalledWith(["ses_known"])
    expect(service.listForProject("/srv/one")).toEqual([])
    expect(service.unattributed()).toEqual([])
    expect(service.list()[0]).toMatchObject({ worktree: "/srv/two", projectKey: "/srv/two", projectName: "two" })
  })

  it("attributes automatically as soon as such a pin is stored", async () => {
    const service = new PinService(file)
    service.setProjectResolver(resolverFor({ ses_known: { worktree: "/srv/two", projectName: "two" } }))
    await service.add({ id: "ses_known" })
    await vi.waitFor(() => expect(service.listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_known"]))
  })

  it("resolves a whole batch of legacy pins with a single resolver call", async () => {
    // ترقية حقيقية: ملف قديم فيه ids مجرّدة من غير أي مسار
    await writeFile(file, JSON.stringify({ version: 1, pins: [{ id: "ses_a" }, { id: "ses_b" }, { id: "ses_c" }] }), "utf8")
    const service = new PinService(file)
    const resolver = resolverFor({
      ses_a: { worktree: "/srv/one", projectName: "one" },
      ses_c: { worktree: "/srv/two", projectName: "two" },
    })
    service.setProjectResolver(resolver)
    await vi.waitFor(() => expect(service.unattributed()).toHaveLength(1))

    // طلب واحد لكل الدفعة — مش طلب لكل محادثة
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith(["ses_a", "ses_b", "ses_c"])
    expect(service.listForProject("/srv/one").map((item) => item.id)).toEqual(["ses_a"])
    expect(service.listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_c"])
    // اللي OpenCode مش عارفه بيفضل محفوظ بس من غير مشروع
    expect(service.unattributed().map((item) => item.id)).toEqual(["ses_b"])
  })

  it("keeps retrying after the resolver fails once", async () => {
    const service = new PinService(file)
    await service.add({ id: "ses_known" })
    expect(service.unattributed()).toHaveLength(1)
    // أول مرة: OpenCode لسه مش متصل فبتفشل من غير ما نضيّع حاجة
    service.setProjectResolver(async () => { throw new Error("opencode down") })
    await vi.waitFor(() => expect(service.unattributed()).toHaveLength(1))
    // إعادة الاتصال: نفس الحالة بتتنسب من أول محاولة جديدة
    service.setProjectResolver(resolverFor({ ses_known: { worktree: "/srv/two" } }))
    await vi.waitFor(() => expect(service.listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_known"]))
  })

  it("keeps a pin whose project cannot be resolved", async () => {
    const service = new PinService(file)
    service.setProjectResolver(resolverFor({}))
    await service.add({ id: "ses_gone" })
    expect(await service.attributeMissing()).toBe(0)
    expect(service.list().map((item) => item.id)).toEqual(["ses_gone"])
    expect(service.unattributed().map((item) => item.id)).toEqual(["ses_gone"])
  })

  it("survives a failing resolver and does not loop on it", async () => {
    const service = new PinService(file)
    const resolver = vi.fn(async () => { throw new Error("opencode down") })
    service.setProjectResolver(resolver)
    await service.add({ id: "ses_known" })
    await vi.waitFor(() => expect(resolver).toHaveBeenCalled())
    expect(await service.attributeMissing()).toBe(0)
    expect(service.list().map((item) => item.id)).toEqual(["ses_known"])
  })

  it("does nothing when there is no resolver at all", async () => {
    const service = new PinService(file)
    await service.add({ id: "ses_known" })
    expect(await service.attributeMissing()).toBe(0)
  })

  it("does not ask about a pin that already belongs to a project", async () => {
    const service = new PinService(file)
    const resolver = resolverFor({ ses_a: { worktree: "/srv/two" } })
    service.setProjectResolver(resolver)
    await service.add(pin("ses_a", { worktree: "/srv/one" }))
    expect(await service.attributeMissing()).toBe(0)
    expect(resolver).not.toHaveBeenCalled()
  })

  it("persists the attributed project across a restart", async () => {
    const first = new PinService(file)
    first.setProjectResolver(resolverFor({ ses_known: { worktree: "/srv/two", projectName: "two" } }))
    await first.add({ id: "ses_known" })
    // النسبة بتشتغل في الخلفية، فنتأكد إن الملف اتكتب قبل ما نعمل restart
    await vi.waitFor(async () => {
      const raw = JSON.parse(await readFile(file, "utf8")) as { pins: Array<{ projectKey: string }> }
      expect(raw.pins[0]?.projectKey).toBe("/srv/two")
    })
    expect(new PinService(file).listForProject("/srv/two").map((item) => item.id)).toEqual(["ses_known"])
  })
})

describe("stored file", () => {
  it("never stores two entries for the same conversation", async () => {
    const service = new PinService(file)
    await service.add(pin("ses_a", { worktree: "/srv/one" }))
    await service.add(pin("ses_a", { worktree: "/srv/one" }))
    await service.merge([pin("ses_a")])
    const raw = JSON.parse(await readFile(file, "utf8")) as { pins: Array<{ id: string }> }
    expect(raw.pins.map((item) => item.id)).toEqual(["ses_a"])
  })
})
