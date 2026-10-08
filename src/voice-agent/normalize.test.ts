import { describe, expect, it } from "vitest"
import { compactVoiceText, nameSimilarity, nameSkeleton, normalizeVoiceText, skeletonSimilarity, tokenizeVoiceText } from "./normalize"

describe("normalizeVoiceText", () => {
  it("يشيل التشكيل والتطويل ويوحّد الهمزات والألفات", () => {
    expect(normalizeVoiceText("إفتَحْ المشْروع")).toBe("افتح المشروع")
    expect(normalizeVoiceText("أعرض")).toBe("اعرض")
  })

  it("يوحّد التاء المربوطة والياء والواو المتطرفة", () => {
    expect(normalizeVoiceText("المحادثة")).toBe("المحادثه")
    expect(normalizeVoiceText("فتحى")).toBe("فتحي")
    expect(normalizeVoiceText("مؤكد")).toBe("موكد")
  })

  it("يحوّل الترقيم لمسافات ويرجّع الحروف صغيرة", () => {
    expect(normalizeVoiceText("Open, the RemoteCode project!")).toBe("open the remotecode project")
    expect(normalizeVoiceText("مشروع RemoteCode، ثم المحادثة")).toBe("مشروع remotecode ثم المحادثه")
  })

  it("يحوّل الأرقام العربية-الهندية والفارسية لانجليزية", () => {
    expect(normalizeVoiceText("المشروع ٢")).toBe("المشروع 2")
    expect(normalizeVoiceText("المحادثة ۳")).toBe("المحادثه 3")
  })

  it("يطوي المسافات المتكررة والأطراف", () => {
    expect(normalizeVoiceText("  افتح   المشروع  ")).toBe("افتح المشروع")
  })

  it("يرجّع نصًا فارغًا للنص الفارغ أو الرمزي فقط", () => {
    expect(normalizeVoiceText("")).toBe("")
    expect(normalizeVoiceText("!!!")).toBe("")
  })
})

describe("tokenizeVoiceText", () => {
  it("يقسّم النص المطبّع لمفردات", () => {
    expect(tokenizeVoiceText("افتح آخر محادثة")).toEqual(["افتح", "اخر", "محادثه"])
  })

  it("يرجّع مصفوفة فاضية لنص فاضي", () => {
    expect(tokenizeVoiceText("  ")).toEqual([])
  })
})

describe("compactVoiceText", () => {
  it("يشيل المسافات من النص المطبّع", () => {
    expect(compactVoiceText("Remote Code")).toBe("remotecode")
  })
})

describe("nameSkeleton", () => {
  it("يوحّد الاسم العربي المنطوق مع اللاتيني المكتوب", () => {
    expect(nameSkeleton("ريموت كود")).toBe(nameSkeleton("RemoteCode"))
  })

  it("يتعامل مع الشرطة والمسافات في المسار", () => {
    expect(nameSkeleton("REMOTE-CODE")).toBe(nameSkeleton("ريموت كود"))
  })

  it("يبسّط الأصوات المتقاربة", () => {
    expect(nameSkeleton("project")).toBe(nameSkeleton("بروجكت"))
  })
})

describe("skeletonSimilarity", () => {
  it("يعطي 1 للهيكل المتطابق", () => {
    expect(skeletonSimilarity("ريموت كود", "remotecode")).toBe(1)
  })

  it("يعطي درجة عالية لتشابه قريب", () => {
    expect(skeletonSimilarity("remotecode", "remotecods")).toBeGreaterThan(0.7)
  })

  it("يرفض الهياكل القصيرة غير المتطابقة", () => {
    expect(skeletonSimilarity("اب", "cd")).toBe(0)
  })
})

describe("nameSimilarity", () => {
  it("يعطي 1 للتطابق المضغوط", () => {
    expect(nameSimilarity("RemoteCode", "REMOTE-CODE")).toBe(1)
  })

  it("يقبل الاحتواء الجزئي", () => {
    expect(nameSimilarity("remote", "REMOTE-CODE")).toBeGreaterThanOrEqual(0.9)
  })

  it("يقبل تطابق كل كلمات الاستعلام", () => {
    expect(nameSimilarity("آخر محادثة", "آخر محادثة إصلاح")).toBeGreaterThanOrEqual(0.9)
  })

  it("يقبل المطابقة عبر اللغتين", () => {
    expect(nameSimilarity("ريموت كود", "REMOTE-CODE")).toBeGreaterThanOrEqual(0.9)
  })

  it("يعطي درجة منخفضة لأسماء غير مرتبطة", () => {
    expect(nameSimilarity("لوحة التحكم", "REMOTE-CODE")).toBeLessThan(0.4)
  })
})
