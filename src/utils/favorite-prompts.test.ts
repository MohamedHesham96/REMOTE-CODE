import { describe, expect, it } from "vitest"
import { FAVORITES_LIMIT } from "../constants"
import type { FavoritePrompt } from "../types"
import {
  addFavoritePrompt,
  favoriteByText,
  favoriteLabelFromText,
  normalizeFavoritePrompts,
  removeFavoritePrompt,
  updateFavoritePrompt,
} from "./favorite-prompts"

function favorite(id: string, text: string, label: string = text): FavoritePrompt {
  return { id, text, label, createdAt: 1 }
}

describe("favoriteLabelFromText", () => {
  it("بياخد أول سطر وبيطوي المسافات", () => {
    expect(favoriteLabelFromText("  أصلح   المصادقة \nوتفاصيل تانية")).toBe("أصلح المصادقة")
  })

  it("بيقصّ الطويل بثلاث نقط عند سقف الاسم", () => {
    const label = favoriteLabelFromText("ا".repeat(300))
    expect(label).toHaveLength(120)
    expect(label.endsWith("…")).toBe(true)
  })

  it("بيرجّع فاضي للنص الفاضي", () => {
    expect(favoriteLabelFromText("   \n  ")).toBe("")
  })
})

describe("favoriteByText", () => {
  it("بيطابق النص بعد trim بس", () => {
    const favorites = [favorite("a", "طلب محفوظ")]
    expect(favoriteByText(favorites, "  طلب محفوظ  ")?.id).toBe("a")
    expect(favoriteByText(favorites, "طلب مختلف")).toBeUndefined()
    expect(favoriteByText(favorites, "   ")).toBeUndefined()
  })
})

describe("normalizeFavoritePrompts", () => {
  it("بيشيل المكرر بالـ id أو بالنص ويرتّب زي ما هو", () => {
    const result = normalizeFavoritePrompts([
      favorite("a", "واحد"),
      favorite("a", "مكرر بالـ id"),
      favorite("b", "واحد"),
      favorite("c", "تلاتة"),
    ])
    expect(result.map((item) => item.text)).toEqual(["واحد", "تلاتة"])
  })

  it("بيتجاهل المدخلات التالفة وبيكمّل الاسم الناقص", () => {
    const result = normalizeFavoritePrompts([
      null,
      "قمامة",
      { id: "a", text: "نص", label: "", createdAt: "مش رقم" },
      { id: "", text: "بلا معرّف" },
      { id: "b", text: "   " },
    ])
    expect(result).toEqual([{ id: "a", text: "نص", label: "نص", createdAt: 0 }])
  })

  it("بيطبّق السقف", () => {
    const incoming = Array.from({ length: FAVORITES_LIMIT + 10 }, (_, index) => favorite(`f${index}`, `طلب ${index}`))
    expect(normalizeFavoritePrompts(incoming)).toHaveLength(FAVORITES_LIMIT)
  })

  it("بيرجّع قائمة فاضية لمش مدخل list", () => {
    expect(normalizeFavoritePrompts(undefined)).toEqual([])
    expect(normalizeFavoritePrompts({})).toEqual([])
  })
})

describe("addFavoritePrompt", () => {
  it("بيضيف الجديد في الأول بنص مطبّع واسم مشتق", () => {
    const next = addFavoritePrompt([favorite("a", "قديم")], "  طلب جديد  ")
    expect(next[0]).toMatchObject({ text: "طلب جديد", label: "طلب جديد" })
    expect(next[1]?.id).toBe("a")
  })

  it("مبيضيفش نسخة تانية لنفس النص — نفس المرجع", () => {
    const favorites = [favorite("a", "موجود")]
    expect(addFavoritePrompt(favorites, "موجود")).toBe(favorites)
    expect(addFavoritePrompt(favorites, "  موجود  ")).toBe(favorites)
  })

  it("بيرفض الفاضي والطويل جدًا والسقف المكتمل بنفس المرجع", () => {
    const favorites = [favorite("a", "موجود")]
    expect(addFavoritePrompt(favorites, "   ")).toBe(favorites)
    expect(addFavoritePrompt(favorites, "ا".repeat(20001))).toBe(favorites)
    const full = Array.from({ length: FAVORITES_LIMIT }, (_, index) => favorite(`f${index}`, `طلب ${index}`))
    expect(addFavoritePrompt(full, "جديد")).toBe(full)
  })
})

describe("updateFavoritePrompt", () => {
  it("بيعدّل النص ويتبعه الاسم المشتق", () => {
    const favorites = [favorite("a", "النص القديم")]
    const next = updateFavoritePrompt(favorites, "a", { text: "النص الجديد" })
    expect(next[0]).toMatchObject({ text: "النص الجديد", label: "النص الجديد" })
  })

  it("بيسيب الاسم المخصص لما النص يتغيّر", () => {
    const favorites = [favorite("a", "النص القديم", "اسم بإيدي")]
    expect(updateFavoritePrompt(favorites, "a", { text: "النص الجديد" })[0]?.label).toBe("اسم بإيدي")
  })

  it("بيعيد التسمية لوحدها", () => {
    const favorites = [favorite("a", "نص")]
    expect(updateFavoritePrompt(favorites, "a", { label: "اسم جديد" })[0]?.label).toBe("اسم جديد")
  })

  it("بيرفض نص فاضي أو نسخة من مفضّلة تانية أو معرّف مش موجود", () => {
    const favorites = [favorite("a", "الأول"), favorite("b", "التاني")]
    expect(updateFavoritePrompt(favorites, "a", { text: "  " })).toBe(favorites)
    expect(updateFavoritePrompt(favorites, "a", { text: "التاني" })).toBe(favorites)
    expect(updateFavoritePrompt(favorites, "missing", { text: "جديد" })).toBe(favorites)
  })
})

describe("removeFavoritePrompt", () => {
  it("بيشيل مفضّلة وبيرجّع نفس المرجع لو مش موجودة", () => {
    const favorites = [favorite("a", "الأول"), favorite("b", "التاني")]
    expect(removeFavoritePrompt(favorites, "a").map((item) => item.id)).toEqual(["b"])
    expect(removeFavoritePrompt(favorites, "missing")).toBe(favorites)
  })
})
