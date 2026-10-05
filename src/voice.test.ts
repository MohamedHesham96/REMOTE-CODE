import { describe, expect, it } from "vitest"
import { effectiveVoiceLanguage, languageCodeOf, nextVoiceLanguage, voiceLanguageCode } from "./voice"

// الشارة على زر المايك لازم تقول اللغة الفعلية للتعرّف مش الإعداد المخزّن،
// فمن غير اختبار ده ممكن الشارة تكدب على المستخدم عن لغة جلسته — خصوصًا
// حالة "تلقائي" اللي بتتترجم لغة الجهاز وقت الاستخدام.

describe("languageCodeOf", () => {
  it("يعرض العربية بعلامة ع", () => {
    expect(languageCodeOf("ar-EG")).toBe("ع")
  })

  it("يعرض الإنجليزي بعلامة EN", () => {
    expect(languageCodeOf("en-US")).toBe("EN")
  })

  it("يعرض أي لغة تانية بأول جزئين منها", () => {
    expect(languageCodeOf("fr-FR")).toBe("FR")
  })

  it("يقبل الشرطة السفلية زي BCP-47 الحديثة", () => {
    expect(languageCodeOf("ar_SA")).toBe("ع")
  })

  it("يرجع EN احتياطي لو الوسم فاضي", () => {
    expect(languageCodeOf("")).toBe("EN")
  })
})

describe("effectiveVoiceLanguage", () => {
  it("الإعداد الصريح بيسبق أي حاجة تانية", () => {
    expect(effectiveVoiceLanguage("ar")).toBe("ar-EG")
    expect(effectiveVoiceLanguage("en")).toBe("en-US")
  })
})

describe("voiceLanguageCode", () => {
  it("الشارة بتتبنى من الإعداد الصريح مباشرة", () => {
    expect(voiceLanguageCode("ar")).toBe("ع")
    expect(voiceLanguageCode("en")).toBe("EN")
  })
})

describe("nextVoiceLanguage", () => {
  it("بيلفّ تلقائي ← عربي ← إنجليزي ← تلقائي", () => {
    expect(nextVoiceLanguage("auto")).toBe("ar")
    expect(nextVoiceLanguage("ar")).toBe("en")
    expect(nextVoiceLanguage("en")).toBe("auto")
  })
})
