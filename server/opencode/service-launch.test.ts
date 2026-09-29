import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  candidateBinaries,
  isCompatibleVersion,
  isRegisteredServiceAlive,
  registrationFilePath,
  resolveOpencodeBinary,
  spawnHiddenService,
} from "./service-launch.js"

let scratch: string | undefined

afterEach(() => {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true })
    scratch = undefined
  }
  vi.restoreAllMocks()
})

function makeScratch(): string {
  scratch = mkdtempSync(join(tmpdir(), "service-launch-"))
  return scratch
}

describe("isCompatibleVersion", () => {
  it("accepts v2 releases only", () => {
    expect(isCompatibleVersion("2.0.18")).toBe(true)
    expect(isCompatibleVersion("2.1.0")).toBe(true)
    expect(isCompatibleVersion("1.9.0")).toBe(false)
    expect(isCompatibleVersion("3.0.0")).toBe(false)
    expect(isCompatibleVersion("")).toBe(false)
  })
})

describe("registrationFilePath", () => {
  it("respects XDG_STATE_HOME", () => {
    expect(registrationFilePath({ XDG_STATE_HOME: join("tmp", "xdg") })).toBe(
      join("tmp", "xdg", "opencode", "service.json"),
    )
  })

  it("falls back to the state directory under home", () => {
    const home = makeScratch()
    expect(registrationFilePath({}, home)).toBe(join(home, ".local", "state", "opencode", "service.json"))
  })
})

describe("resolveOpencodeBinary", () => {
  it("returns undefined without candidates", () => {
    expect(resolveOpencodeBinary([])).toBeUndefined()
  })

  it("skips missing files and picks the first existing binary", () => {
    const dir = makeScratch()
    const binary = join(dir, "opencode.exe")
    writeFileSync(binary, "fake")
    expect(resolveOpencodeBinary([join(dir, "missing.exe"), binary])).toBe(binary)
    expect(resolveOpencodeBinary([join(dir, "missing.exe")])).toBeUndefined()
  })
})

describe("isRegisteredServiceAlive", () => {
  it("treats missing or corrupt registrations as dead", () => {
    const dir = makeScratch()
    expect(isRegisteredServiceAlive(join(dir, "nope.json"))).toBe(false)
    const corrupt = join(dir, "corrupt.json")
    writeFileSync(corrupt, "{not json")
    expect(isRegisteredServiceAlive(corrupt)).toBe(false)
    const dead = join(dir, "dead.json")
    writeFileSync(dead, JSON.stringify({ pid: 2147483647, url: "http://127.0.0.1:9" }))
    expect(isRegisteredServiceAlive(dead)).toBe(false)
  })

  it("detects the current process as alive", () => {
    const dir = makeScratch()
    const live = join(dir, "live.json")
    writeFileSync(live, JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:9" }))
    expect(isRegisteredServiceAlive(live)).toBe(true)
  })
})

describe("candidateBinaries", () => {
  it("prefers OPENCODE_BIN on Windows and stays empty elsewhere", () => {
    const home = makeScratch()
    const binaries = candidateBinaries({ APPDATA: join(home, "appdata"), OPENCODE_BIN: join(home, "custom.exe") }, home)
    if (process.platform === "win32") {
      expect(binaries[0]).toBe(join(home, "custom.exe"))
    } else {
      expect(binaries).toEqual([])
    }
  })
})

describe("spawnHiddenService", () => {
  it("never throws on an invalid binary", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const dir = makeScratch()
    expect(() => spawnHiddenService(join(dir, "missing.exe"))).not.toThrow()
    await sleep(300)
    expect(errors).toHaveBeenCalled()
  })
})
