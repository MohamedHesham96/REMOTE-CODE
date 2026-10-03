import { describe, expect, it } from "vitest"
import { etagFor, fnv1a } from "./hash.js"

describe("fnv1a / etagFor", () => {
  it("is deterministic and distinguishes versions", () => {
    expect(fnv1a("busy|1|abc")).toBe(fnv1a("busy|1|abc"))
    expect(fnv1a("busy|1|abc")).not.toBe(fnv1a("busy|1|abd"))
    expect(etagFor("v1")).toMatch(/^W\/"[0-9a-f]{8}-\d+"$/)
    expect(etagFor("v1")).not.toBe(etagFor("v2"))
  })
})
