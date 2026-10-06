import { describe, expect, it } from "vitest"
import type { ModelInfo } from "../types"
import { buildModelCatalog } from "./model-search"

function model(providerID: string, id: string, name = id, extra: Partial<ModelInfo> = {}): ModelInfo {
  return { providerID, id, name, free: false, enabled: true, ...extra }
}

describe("buildModelCatalog", () => {
  it("indexes each model with its pin key and a lowercase search text", () => {
    const catalog = buildModelCatalog([model("OpenCode", "Big-Pickle", "Big Pickle")])
    expect(catalog.entries[0]?.key).toBe("OpenCode/Big-Pickle")
    expect(catalog.entries[0]?.haystack).toBe("opencode/big-pickle big pickle")
  })

  it("makes a model findable by provider, id, or name regardless of case", () => {
    const catalog = buildModelCatalog([model("opencode", "space-bunny-free", "Space Bunny")])
    const haystack = catalog.entries[0]?.haystack ?? ""
    expect(haystack.includes("opencode")).toBe(true)
    expect(haystack.includes("space-bunny")).toBe(true)
    expect(haystack.includes("space bunny")).toBe(true)
  })

  it("groups by provider alphabetically and sorts models by name inside", () => {
    const catalog = buildModelCatalog([
      model("zeta", "b", "Beta"),
      model("alpha", "c", "Charlie"),
      model("alpha", "a", "Alpha"),
    ])
    expect(catalog.providers.map((group) => group.providerID)).toEqual(["alpha", "zeta"])
    expect(catalog.providers[0]?.entries.map((entry) => entry.model.name)).toEqual(["Alpha", "Charlie"])
  })

  it("maps every entry by its key for O(1) lookups", () => {
    const catalog = buildModelCatalog([
      model("opencode", "one"),
      model("openrouter", "openai/gpt-4o"),
    ])
    expect(catalog.byKey.get("opencode/one")?.model.id).toBe("one")
    // معرّفات OpenRouter فيها شرطة جوه الـ modelID ولازم تفضل قابلة للبحث
    expect(catalog.byKey.get("openrouter/openai/gpt-4o")?.model.id).toBe("openai/gpt-4o")
  })

  it("keeps the flat entry list in the incoming order", () => {
    const catalog = buildModelCatalog([model("b", "two"), model("a", "one")])
    expect(catalog.entries.map((entry) => entry.model.id)).toEqual(["two", "one"])
  })

  it("returns an empty catalog for an empty list", () => {
    expect(buildModelCatalog([])).toEqual({ entries: [], providers: [], byKey: new Map() })
  })
})