import { describe, expect, it, vi } from "vitest"
import {
  UpdateService,
  compareVersions,
  isNewerVersion,
  parseVersion,
  readPackageVersion,
  repositoryFromRemoteUrl,
  type UpdateInfo,
} from "./update.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function service(options: {
  currentVersion: string
  now?: () => number
  responses?: Array<() => Promise<Response>>
}) {
  const responses = [...(options.responses ?? [])]
  const fetchMock = vi.fn(() => {
    const next = responses.shift()
    if (!next) {
      return Promise.reject(new Error("offline"))
    }
    return next()
  })
  const instance = new UpdateService({
    currentVersion: options.currentVersion,
    repository: "owner/repo",
    fetchImpl: fetchMock as unknown as typeof fetch,
    now: options.now,
    timeoutMs: 50,
  })
  return { instance, fetchMock, responses }
}

describe("version parsing and comparison", () => {
  it("parses numeric versions with or without a v prefix", () => {
    expect(parseVersion("v1.8.1")).toEqual([1, 8, 1])
    expect(parseVersion("2.10.0")).toEqual([2, 10, 0])
    expect(parseVersion("1.8")).toEqual([1, 8])
    expect(parseVersion("")).toBeNull()
    expect(parseVersion("v")).toBeNull()
    expect(parseVersion("latest")).toBeNull()
    expect(parseVersion("1.x.0")).toBeNull()
  })

  it("compares numerically, not as strings", () => {
    expect(compareVersions("2.10.0", "2.9.0")).toBe(1)
    expect(compareVersions("2.9.0", "2.10.0")).toBe(-1)
    expect(compareVersions("v1.8.1", "1.8.1")).toBe(0)
    expect(compareVersions("1.8", "1.8.0")).toBe(0)
    expect(compareVersions("1.9.0-beta.1", "1.9.0")).toBe(0)
    expect(compareVersions("broken", "1.0.0")).toBeNull()
  })

  it("never reports an update for malformed or missing versions", () => {
    expect(isNewerVersion("1.9.0", "1.8.1")).toBe(true)
    expect(isNewerVersion("1.8.1", "1.8.1")).toBe(false)
    expect(isNewerVersion("", "1.8.1")).toBe(false)
    expect(isNewerVersion("next", "1.8.1")).toBe(false)
    expect(isNewerVersion("1.9.0", "")).toBe(false)
  })
})

describe("repositoryFromRemoteUrl", () => {
  it("extracts owner/repo from https and ssh remotes", () => {
    expect(repositoryFromRemoteUrl("https://github.com/MohamedHesham96/REMOTE-CODE.git")).toBe("MohamedHesham96/REMOTE-CODE")
    expect(repositoryFromRemoteUrl("git@github.com:owner/repo.git")).toBe("owner/repo")
    expect(repositoryFromRemoteUrl("https://gitlab.com/owner/repo.git")).toBeNull()
    expect(repositoryFromRemoteUrl("")).toBeNull()
  })
})

describe("readPackageVersion", () => {
  it("returns an empty string when package.json is missing or invalid", () => {
    expect(readPackageVersion("/definitely/missing/folder")).toBe("")
  })
})

describe("UpdateService", () => {
  it("reports an available update and caches it", async () => {
    let now = 1_000
    const { instance, fetchMock } = service({
      currentVersion: "1.8.1",
      now: () => now,
      responses: [() => Promise.resolve(jsonResponse({ version: "1.9.0" })), () => Promise.resolve(jsonResponse({}, 404))],
    })

    const first = await instance.check()
    expect(first.updateAvailable).toBe(true)
    expect(first.latestVersion).toBe("1.9.0")
    expect(first.currentVersion).toBe("1.8.1")
    expect(first.releaseUrl).toBe("https://github.com/owner/repo/releases")

    // داخل مدة الكاش: لا اتصال جديد
    now += 60_000
    const second = await instance.check()
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("reports no update when the remote matches or is older", async () => {
    const { instance } = service({
      currentVersion: "1.8.1",
      responses: [() => Promise.resolve(jsonResponse({ version: "1.8.1" }))],
    })
    const info = await instance.check()
    expect(info.updateAvailable).toBe(false)
    expect(info.latestVersion).toBe("1.8.1")
    expect(info.releaseNotes).toBeNull()
  })

  it("treats a malformed remote version as no update", async () => {
    const { instance } = service({
      currentVersion: "1.8.1",
      responses: [() => Promise.resolve(jsonResponse({ version: "not-a-version" }))],
    })
    const info = await instance.check()
    expect(info.updateAvailable).toBe(false)
    expect(info.latestVersion).toBe("not-a-version")
  })

  it("fails silently on network errors and retries after the shorter window", async () => {
    let now = 1_000
    const { instance, fetchMock } = service({
      currentVersion: "1.8.1",
      now: () => now,
      responses: [() => Promise.reject(new Error("offline"))],
    })

    const failed = await instance.check()
    expect(failed).toEqual<UpdateInfo>({
      currentVersion: "1.8.1",
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      releaseNotes: null,
      checkedAt: 1_000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // لسه داخل نافذة إعادة المحاولة
    now += 5 * 60_000
    await instance.check()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // بعد النافذة يعيد المحاولة
    now += 11 * 60_000
    await instance.check()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("deduplicates concurrent checks into one request", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchMock = vi.fn(async () => {
      await gate
      return jsonResponse({ version: "1.9.0" })
    })
    const instance = new UpdateService({
      currentVersion: "1.8.1",
      repository: "owner/repo",
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    const checks = Promise.all([instance.check(), instance.check(), instance.check()])
    release()
    const results = await checks
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
    // طلب واحد للنسخة + طلب واحد للملاحظات (404)، مش ثلاثة
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("attaches release notes only when the release tag matches the remote version", async () => {
    const matching = service({
      currentVersion: "1.8.1",
      responses: [
        () => Promise.resolve(jsonResponse({ version: "1.9.0" })),
        () => Promise.resolve(jsonResponse({
          tag_name: "v1.9.0",
          name: "v1.9.0",
          body: "✨ New",
          html_url: "https://github.com/owner/repo/releases/tag/v1.9.0",
          published_at: "2026-10-08T00:00:00Z",
        })),
      ],
    })
    const info = await matching.instance.check()
    expect(info.releaseNotes?.body).toBe("✨ New")
    expect(info.releaseUrl).toBe("https://github.com/owner/repo/releases/tag/v1.9.0")

    const mismatched = service({
      currentVersion: "1.8.1",
      responses: [
        () => Promise.resolve(jsonResponse({ version: "1.9.0" })),
        () => Promise.resolve(jsonResponse({ tag_name: "v2.0.0", html_url: "https://github.com/owner/repo/releases/tag/v2.0.0" })),
      ],
    })
    const fallback = await mismatched.instance.check()
    expect(fallback.releaseNotes).toBeNull()
    expect(fallback.releaseUrl).toBe("https://github.com/owner/repo/releases")
  })
})
