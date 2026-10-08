import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FavoritePromptService, MAX_FAVORITES, parseFavoritePatch, parseFavoritePrompt } from "./favorites.js"

let dir = ""
let file = ""

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "favorites-test-"))
  file = join(dir, "favorites.json")
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("parseFavoritePrompt", () => {
  it("بيحفظ النص زي ما هو (بعد trim) ويولّد اسمًا من أول سطر", () => {
    const parsed = parseFavoritePrompt({ text: "  أصلح المصادقة وأضف refresh token\nوتفاصيل تانية  " })
    expect(parsed.text).toBe("أصلح المصادقة وأضف refresh token\nوتفاصيل تانية")
    expect(parsed.label).toBe("أصلح المصادقة وأضف refresh token")
    expect(parsed.id).toMatch(/^fav_/)
  })

  it("بيرفض نص فاضي أو مدخل مش كائن", () => {
    expect(() => parseFavoritePrompt(null)).toThrow("INVALID_FAVORITE")
    expect(() => parseFavoritePrompt({ text: "   " })).toThrow("INVALID_FAVORITE")
    expect(() => parseFavoritePrompt(42)).toThrow("INVALID_FAVORITE")
  })

  it("بيرفض نص أطول من السقف بدل ما يقتطعه", () => {
    expect(() => parseFavoritePrompt({ text: "ا".repeat(20001) })).toThrow("FAVORITE_TOO_LONG")
  })

  it("بيقبل اسمًا صريحًا ويقصّه للسقف", () => {
    const parsed = parseFavoritePrompt({ text: "نص", label: "اسم مخصص" })
    expect(parsed.label).toBe("اسم مخصص")
    expect(parseFavoritePrompt({ text: "نص", label: "ا".repeat(500) }).label).toHaveLength(120)
  })
})

describe("parseFavoritePatch", () => {
  it("بيسمح بتعديل النص أو الاسم أو الاتنين", () => {
    expect(parseFavoritePatch({ text: "جديد" })).toEqual({ text: "جديد" })
    expect(parseFavoritePatch({ label: "اسم" })).toEqual({ label: "اسم" })
    expect(parseFavoritePatch({ text: "جديد", label: "" })).toEqual({ text: "جديد", label: "" })
  })

  it("بيرفض patch فاضي أو نص فاضي", () => {
    expect(() => parseFavoritePatch({})).toThrow("INVALID_FAVORITE")
    expect(() => parseFavoritePatch({ text: "  " })).toThrow("INVALID_FAVORITE")
  })
})

describe("FavoritePromptService", () => {
  it("بيحفظ الأحدث الأول", async () => {
    const service = new FavoritePromptService(file)
    await service.add({ text: "الأول" })
    await service.add({ text: "التاني" })
    expect(service.list().map((favorite) => favorite.text)).toEqual(["التاني", "الأول"])
  })

  it("منع التكرار: نفس النص مبيضيفش نسخة تانية ومش بيبعت بثّ", async () => {
    const service = new FavoritePromptService(file)
    const seen: number[] = []
    service.subscribe((favorites) => seen.push(favorites.length))
    await service.add({ text: "نفس الطلب" })
    await service.add({ text: "  نفس الطلب  " })
    expect(service.list()).toHaveLength(1)
    expect(seen).toEqual([1])
  })

  it("بيحترم الـ id الجاي من العميل عشان النسخة المتفائلة تفضل بنفس المعرّف", async () => {
    const service = new FavoritePromptService(file)
    const list = await service.add({ id: "fav_client_1", text: "طلب" })
    expect(list[0]?.id).toBe("fav_client_1")
  })

  it("إعادة التسمية بتغيّر الاسم بس والنص بيفضل زي ما هو", async () => {
    const service = new FavoritePromptService(file)
    await service.add({ text: "اقرأ الملفات" })
    const target = service.list()[0]!
    await service.update(target.id, { label: "مراجعة" })
    expect(service.list()[0]).toMatchObject({ id: target.id, text: "اقرأ الملفات", label: "مراجعة" })
  })

  it("تعديل النص بيتبعه الاسم المشتق ويسيب الاسم المخصص", async () => {
    const service = new FavoritePromptService(file)
    await service.add({ text: "النص القديم" })
    const derived = service.list()[0]!
    await service.update(derived.id, { text: "النص الجديد" })
    expect(service.list()[0]?.label).toBe("النص الجديد")

    await service.update(derived.id, { label: "اسم بإيدي" })
    await service.update(derived.id, { text: "نص تالت" })
    expect(service.list()[0]).toMatchObject({ text: "نص تالت", label: "اسم بإيدي" })
  })

  it("اسم فاضي صريح بيرجع للاسم المشتق من النص", async () => {
    const service = new FavoritePromptService(file)
    await service.add({ text: "نص عادي" })
    const target = service.list()[0]!
    await service.update(target.id, { label: "مخصص" })
    await service.update(target.id, { label: "" })
    expect(service.list()[0]?.label).toBe("نص عادي")
  })

  it("تعديل نص لنص مفضّلة تانية مرفوض — مفيش نسختين بنفس النص", async () => {
    const service = new FavoritePromptService(file)
    await service.add({ text: "الأول" })
    await service.add({ text: "التاني" })
    const target = service.list()[1]!
    await expect(service.update(target.id, { text: "التاني" })).rejects.toThrow("FAVORITE_EXISTS")
    // التعديل لنفس النص الحالي مسموح (مش تكرار جديد)
    await expect(service.update(target.id, { text: "الأول" })).resolves.toHaveLength(2)
  })

  it("تعديل مفضّلة مش موجودة بيرمي FAVORITE_NOT_FOUND", async () => {
    const service = new FavoritePromptService(file)
    await expect(service.update("fav_missing", { label: "x" })).rejects.toThrow("FAVORITE_NOT_FOUND")
  })

  it("الحذف بيشيل مفضّلة واحدة ويسيب الباقي زي ما هو", async () => {
    const service = new FavoritePromptService(file)
    await service.add({ text: "الأول" })
    await service.add({ text: "التاني" })
    const target = service.list()[0]!
    expect((await service.remove(target.id)).map((favorite) => favorite.text)).toEqual(["الأول"])
    // حذف مش موجود = مفيش تغيير ولا بثّ
    expect((await service.remove("fav_missing")).map((favorite) => favorite.text)).toEqual(["الأول"])
  })

  it("السقف بيرفض الجديد من غير ما يمسح القديم", async () => {
    const service = new FavoritePromptService(file)
    for (let index = 0; index < MAX_FAVORITES; index += 1) {
      await service.add({ text: `طلب ${index}` })
    }
    await expect(service.add({ text: "طلب زيادة" })).rejects.toThrow("FAVORITES_FULL")
    expect(service.list()).toHaveLength(MAX_FAVORITES)
  })

  it("بيفضل بعد إعادة التشغيل — القائمة بتُقرأ من الملف", async () => {
    const first = new FavoritePromptService(file)
    await first.add({ text: "يفضل بعد الريستارت" })
    const second = new FavoritePromptService(file)
    expect(second.list().map((favorite) => favorite.text)).toEqual(["يفضل بعد الريستارت"])
  })

  it("ملف تالف أو مكرر بينضّف عند التحميل", async () => {
    await writeFile(file, JSON.stringify({
      version: 1,
      favorites: [
        { id: "one", text: "نص", label: "اسم", createdAt: 1 },
        { id: "one", text: "نص تاني", label: "اسم", createdAt: 2 },
        { id: "two", text: "نص", label: "مكرر بالنص", createdAt: 3 },
        { id: "three", text: "", label: "", createdAt: 4 },
        "قمامة",
      ],
    }), "utf8")
    const service = new FavoritePromptService(file)
    expect(service.list().map((favorite) => favorite.text)).toEqual(["نص"])
  })

  it("الملف بيتكتب بالنسخة الحالية والشكل المطلوب", async () => {
    const service = new FavoritePromptService(file)
    await service.add({ text: "اقرأ الملف" })
    const data = JSON.parse(await readFile(file, "utf8")) as { version: number; favorites: Array<{ text: string }> }
    expect(data.version).toBe(1)
    expect(data.favorites[0]?.text).toBe("اقرأ الملف")
  })

  it("المشاهدين بيوصلهم التغيير الحقيقي بس، وواحد بيرمي مش بيكسر الباقي", async () => {
    const service = new FavoritePromptService(file)
    const seen: string[][] = []
    service.subscribe(() => {
      throw new Error("مشاهد واقع")
    })
    service.subscribe((favorites) => seen.push(favorites.map((favorite) => favorite.text)))
    await service.add({ text: "الأول" })
    await service.add({ text: "الأول" })
    await service.remove("fav_missing")
    await service.add({ text: "التاني" })
    expect(seen).toEqual([["الأول"], ["التاني", "الأول"]])
  })
})
