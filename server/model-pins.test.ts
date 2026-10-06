import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_PINNED_MODELS, ModelPinService, parseModelPinKey } from "./model-pins.js"

let dir = ""
let file = ""

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "model-pins-test-"))
  file = join(dir, "model-pins.json")
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("parseModelPinKey", () => {
  it("keeps a well formed key", () => {
    expect(parseModelPinKey("opencode/space-bunny-free")).toBe("opencode/space-bunny-free")
  })

  it("keeps slashes inside the model id", () => {
    // معرّفات OpenRouter فيها "/" جوه الـ modelID، فلو اشترطنا شرطة واحدة
    // كانت تثبيتها كلها هتترفض وتختفي
    expect(parseModelPinKey("openrouter/openai/gpt-4o")).toBe("openrouter/openai/gpt-4o")
  })

  it("trims and truncates an oversized key instead of storing it raw", () => {
    const parsed = parseModelPinKey(` ${"a".repeat(500)}/${"b".repeat(500)} `)
    expect(parsed).toHaveLength(300)
    expect(parsed.startsWith("a")).toBe(true)
  })

  it("rejects keys without a usable provider or model", () => {
    expect(() => parseModelPinKey(null)).toThrow("INVALID_MODEL_PIN")
    expect(() => parseModelPinKey(42)).toThrow("INVALID_MODEL_PIN")
    expect(() => parseModelPinKey("   ")).toThrow("INVALID_MODEL_PIN")
    expect(() => parseModelPinKey("no-slash")).toThrow("INVALID_MODEL_PIN")
    expect(() => parseModelPinKey("/model")).toThrow("INVALID_MODEL_PIN")
    expect(() => parseModelPinKey("provider/")).toThrow("INVALID_MODEL_PIN")
  })
})

describe("ModelPinService", () => {
  it("adds newest first and moves a re-pinned key back to the top", async () => {
    const service = new ModelPinService(file)
    expect(await service.add("opencode/one")).toEqual(["opencode/one"])
    expect(await service.add("opencode/two")).toEqual(["opencode/two", "opencode/one"])
    expect(await service.add("opencode/one")).toEqual(["opencode/one", "opencode/two"])
  })

  it("removes a key and ignores one that is not pinned", async () => {
    const service = new ModelPinService(file)
    await service.add("opencode/one")
    await service.add("opencode/two")
    expect(await service.remove("opencode/one")).toEqual(["opencode/two"])
    expect(await service.remove("opencode/nope")).toEqual(["opencode/two"])
  })

  it("rejects a malformed key instead of storing it", async () => {
    const service = new ModelPinService(file)
    await expect(service.add("no-slash")).rejects.toThrow("INVALID_MODEL_PIN")
    expect(service.list()).toEqual([])
  })

  it("refuses a new key at the cap without dropping another device's pin", async () => {
    const service = new ModelPinService(file)
    for (let i = 0; i < MAX_PINNED_MODELS; i += 1) {
      await service.add(`opencode/model-${i}`)
    }
    // الرفض مقصود: أي تقطاع هنا هيمسح تثبيت جهاز تاني من غير طلب منه
    await expect(service.add("opencode/extra")).rejects.toThrow("MODEL_PINS_FULL")
    expect(service.list()).toEqual([
      "opencode/model-4",
      "opencode/model-3",
      "opencode/model-2",
      "opencode/model-1",
      "opencode/model-0",
    ])
    // إعادة تثبيت مفتاح موجود لسه بتعدّي عادي حتى مع امتلاء السقف
    expect(await service.add("opencode/model-0")).toHaveLength(MAX_PINNED_MODELS)
  })

  it("merges an incoming list without replacing the existing pins", async () => {
    const service = new ModelPinService(file)
    await service.add("opencode/mine")
    expect(await service.merge(["openrouter/theirs", "opencode/mine"])).toEqual([
      "opencode/mine",
      "openrouter/theirs",
    ])
  })

  it("caps what it merges so the server list cannot grow past the limit", async () => {
    const service = new ModelPinService(file)
    const incoming = Array.from({ length: 9 }, (_, index) => `opencode/in-${index}`)
    expect(await service.merge(incoming)).toHaveLength(MAX_PINNED_MODELS)
    expect(await service.merge(incoming)).toEqual(await service.merge(incoming))
  })

  it("merging nothing new does not notify the listeners", async () => {
    const service = new ModelPinService(file)
    const seen: string[][] = []
    service.subscribe((models) => seen.push(models))
    await service.add("opencode/one")
    expect(seen).toEqual([["opencode/one"]])
    // نفس القائمة جوّه response — مفيش تغيير حقيقي فمفيش سبب للبثّ
    await service.merge(["opencode/one"])
    await service.add("opencode/one")
    await service.remove("opencode/nope")
    expect(seen).toEqual([["opencode/one"]])
  })

  it("keeps serving other listeners when one throws", async () => {
    const service = new ModelPinService(file)
    const good: string[][] = []
    service.subscribe(() => {
      throw new Error("listener exploded")
    })
    service.subscribe((models) => good.push(models))
    await service.add("opencode/one")
    expect(good).toEqual([["opencode/one"]])
  })

  it("persists to disk and reads it back on a fresh instance", async () => {
    const service = new ModelPinService(file)
    await service.add("opencode/one")
    await service.add("openrouter/openai/gpt-4o")
    expect(new ModelPinService(file).list()).toEqual([
      "openrouter/openai/gpt-4o",
      "opencode/one",
    ])
  })

  it("drops malformed and duplicate keys found in the file", async () => {
    await writeFile(file, JSON.stringify({
      version: 1,
      models: ["opencode/one", "bad", "opencode/one", 42, "opencode/two"],
    }), "utf8")
    expect(new ModelPinService(file).list()).toEqual(["opencode/one", "opencode/two"])
  })

  it("starts empty when the file is broken", async () => {
    await writeFile(file, "{ not json", "utf8")
    expect(new ModelPinService(file).list()).toEqual([])
  })

  it("rewrites an old version of the file on load", async () => {
    await writeFile(file, JSON.stringify({ models: ["opencode/one"] }), "utf8")
    new ModelPinService(file)
    await vi.waitFor(async () => {
      const saved = JSON.parse(await readFile(file, "utf8")) as { version: number; models: string[] }
      expect(saved.version).toBe(1)
      expect(saved.models).toEqual(["opencode/one"])
    })
  })
})