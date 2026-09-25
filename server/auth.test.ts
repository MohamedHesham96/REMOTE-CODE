import { describe, expect, it } from "vitest"
import { isValidAccessToken } from "./auth.js"

describe("isValidAccessToken", () => {
  it("accepts the exact access token", () => {
    expect(isValidAccessToken("access-token-123456789", "access-token-123456789")).toBe(true)
  })

  it("rejects a different or incomplete token", () => {
    expect(isValidAccessToken("access-token-123456789", "access-token-123456780")).toBe(false)
    expect(isValidAccessToken("short", "access-token-123456789")).toBe(false)
  })
})
