import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateInfo } from "../types"
import {
  UPDATE_CACHE_KEY,
  UPDATE_DISMISS_MS,
  dismissUpdate,
  readCachedUpdate,
  readDismissedUpdate,
  shouldCheckForUpdate,
  shouldShowUpdate,
  writeCachedUpdate,
} from "./update"

function info(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    currentVersion: "1.8.1",
    latestVersion: "1.9.0",
    updateAvailable: true,
    releaseUrl: null,
    releaseNotes: null,
    checkedAt: 1_000,
    ...overrides,
  }
}

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    clear: () => data.clear(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("update cache", () => {
  it("round-trips the last check and keeps it fresh inside the window", () => {
    writeCachedUpdate(info({ checkedAt: 10_000 }))
    const cached = readCachedUpdate()
    expect(cached?.info.latestVersion).toBe("1.9.0")
    expect(cached?.checkedAt).toBe(10_000)
    expect(shouldCheckForUpdate(10_000, 10_000 + 60_000)).toBe(false)
    expect(shouldCheckForUpdate(10_000, 10_000 + 7 * 60 * 60 * 1000)).toBe(true)
  })

  it("falls back to the write time when the server sends a missing checkedAt", () => {
    writeCachedUpdate(info({ checkedAt: Number.NaN }))
    expect(readCachedUpdate()?.checkedAt).toBeGreaterThan(0)
  })

  it("ignores corrupt cached entries", () => {
    globalThis.localStorage.setItem(UPDATE_CACHE_KEY, "{ not json")
    expect(readCachedUpdate()).toBeNull()
    globalThis.localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify({ checkedAt: "yesterday", info: {} }))
    expect(readCachedUpdate()).toBeNull()
  })
})

describe("dismissal", () => {
  it("hides a dismissed version until the window ends", () => {
    dismissUpdate("1.9.0", 1_000)
    const dismissed = readDismissedUpdate()
    expect(dismissed?.version).toBe("1.9.0")
    expect(dismissed?.until).toBe(1_000 + UPDATE_DISMISS_MS)
    expect(shouldShowUpdate(info(), dismissed, 2_000)).toBe(false)
    expect(shouldShowUpdate(info(), dismissed, 1_000 + UPDATE_DISMISS_MS + 1)).toBe(true)
  })

  it("shows a newer version even after an older one was dismissed", () => {
    dismissUpdate("1.9.0", 1_000)
    const dismissed = readDismissedUpdate()
    expect(shouldShowUpdate(info({ latestVersion: "1.10.0" }), dismissed, 2_000)).toBe(true)
  })

  it("never shows anything without a real update or a valid version", () => {
    const dismissed = readDismissedUpdate()
    expect(shouldShowUpdate(null, dismissed)).toBe(false)
    expect(shouldShowUpdate(info({ updateAvailable: false }), dismissed)).toBe(false)
    expect(shouldShowUpdate(info({ latestVersion: null }), dismissed)).toBe(false)
    expect(shouldShowUpdate(info({ latestVersion: "" }), dismissed)).toBe(false)
  })

  it("ignores an empty version instead of storing a global dismissal", () => {
    dismissUpdate("")
    expect(readDismissedUpdate()).toBeNull()
  })
})
