import { describe, expect, it } from "vitest"
import { RELEASE_CATEGORY_ORDER, groupReleaseChanges, type Release } from "./releases"
import { releases } from "./releases-data"

function release(overrides: Partial<Release> = {}): Release {
  return {
    version: "v9.9.9",
    date: "2026-01-01",
    title: { ar: "t", en: "t" },
    summary: { ar: "s", en: "s" },
    changes: [
      { category: "fixes", title: { ar: "fix", en: "fix" }, description: { ar: "", en: "" } },
      { category: "features", title: { ar: "feat", en: "feat" }, description: { ar: "", en: "" } },
      { category: "features", title: { ar: "feat 2", en: "feat 2" }, description: { ar: "", en: "" } },
    ],
    ...overrides,
  }
}

describe("groupReleaseChanges", () => {
  it("يرتّب الأقسام بترتيب العرض ويتجاهل التصنيفات الفارغة", () => {
    const groups = groupReleaseChanges(release())
    expect(groups.map((group) => group.category)).toEqual(["features", "fixes"])
  })

  it("يحافظ على ترتيب التغييرات داخل القسم", () => {
    const features = groupReleaseChanges(release()).find((group) => group.category === "features")
    expect(features?.changes.map((change) => change.title.ar)).toEqual(["feat", "feat 2"])
  })

  it("يرجّع قائمة فاضية لإصدار بلا تغييرات", () => {
    expect(groupReleaseChanges(release({ changes: [] }))).toEqual([])
  })

  it("لا ينتج أي تصنيف خارج الترتيب المعلن", () => {
    const categories = new Set(groupReleaseChanges(release()).map((group) => group.category))
    for (const category of categories) {
      expect(RELEASE_CATEGORY_ORDER).toContain(category)
    }
  })
})

describe("releases-data", () => {
  it("مرتّبة من الأحدث إلى الأقدم", () => {
    const dates = releases.map((item) => item.date)
    const sorted = [...dates].sort().reverse()
    expect(dates).toEqual(sorted)
  })

  it("كل إصدار يحمل نسخة وتاريخًا وتغييرات ولها مراجع commits", () => {
    for (const item of releases) {
      expect(item.version).toMatch(/^v\d+\.\d+\.\d+$/)
      expect(Number.isNaN(new Date(`${item.date}T00:00:00Z`).getTime())).toBe(false)
      expect(item.changes.length).toBeGreaterThan(0)
      expect(item.commits && item.commits.length > 0).toBe(true)
    }
  })

  it("عناوين التغييرات فريدة داخل الإصدار الواحد", () => {
    for (const item of releases) {
      const titles = item.changes.map((change) => change.title.ar)
      expect(new Set(titles).size).toBe(titles.length)
    }
  })

  it("كل نص مترجم موجود باللغتين وغير فاضي", () => {
    // الاكتمال الثنائي شرط أساسي: العربية والإنجليزية هما اللغتان الوحيدتان،
    // وأي نص ناقص في إحداهما يكسر العرض عند تبديل اللغة.
    for (const item of releases) {
      expect(item.title.ar.length).toBeGreaterThan(0)
      expect(item.title.en.length).toBeGreaterThan(0)
      expect(item.summary.ar.length).toBeGreaterThan(0)
      expect(item.summary.en.length).toBeGreaterThan(0)
      for (const change of item.changes) {
        expect(change.title.ar.length).toBeGreaterThan(0)
        expect(change.title.en.length).toBeGreaterThan(0)
        expect(change.description.ar.length).toBeGreaterThan(0)
        expect(change.description.en.length).toBeGreaterThan(0)
      }
    }
  })

  it("النص الإنجليزي لا يحتوي حروفًا عربية", () => {
    const arabic = /[\u0600-\u06FF]/
    for (const item of releases) {
      expect(arabic.test(item.title.en)).toBe(false)
      expect(arabic.test(item.summary.en)).toBe(false)
      for (const change of item.changes) {
        expect(arabic.test(change.title.en)).toBe(false)
        expect(arabic.test(change.description.en)).toBe(false)
      }
    }
  })
})
