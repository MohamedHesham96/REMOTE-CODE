import { describe, expect, it } from "vitest"
import { effectiveVoiceLanguage, languageCodeOf, mergeTranscript, nextVoiceLanguage, normalizeTranscript, voiceLanguageCode } from "./voice"

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

describe("normalizeTranscript", () => {
  it("يطوي فاصل السطر اللي المحرّك بيحطه في أول النتيجة", () => {
    expect(normalizeTranscript("\nالسلام عليكم")).toBe("السلام عليكم")
  })

  it("يطوي فواصل الأسطر اللي بين الكلمات لمسافة واحدة", () => {
    // كروم على أندرويد بيرجّع "\n" فاصل بين نتائج التعرّف في continuous mode،
    // وضم النتائج مباشرة كان بيسيبها جوه النص فتظهر الجملة على سطور
    expect(normalizeTranscript("السلام\nعليكم")).toBe("السلام عليكم")
    expect(normalizeTranscript("السلام\r\nعليكم")).toBe("السلام عليكم")
  })

  it("يشيل المسافات المتكررة والأطراف", () => {
    expect(normalizeTranscript("  السلام   عليكم  ")).toBe("السلام عليكم")
  })

  it("يرجّع نصًا فارغًا للفراغات وحدها", () => {
    expect(normalizeTranscript(" \n\t ")).toBe("")
  })
})

describe("mergeTranscript", () => {
  it("يضم النصين بمسافة واحدة", () => {
    expect(mergeTranscript("السلام عليكم", "إزيك")).toBe("السلام عليكم إزيك")
  })

  it("يرجّع التاني زي ما هو لو الأساس فاضي، والأساس لو التاني فاضي", () => {
    expect(mergeTranscript("", "مرحبا")).toBe("مرحبا")
    expect(mergeTranscript("مرحبا", "")).toBe("مرحبا")
  })

  it("ما يضيفش مسافة زيادة لو الأساس خلص بمسافة", () => {
    expect(mergeTranscript("سطر ", "مرحبا")).toBe("سطر مرحبا")
  })

  it("يسيب سطر المستخدم اللي في الأساس زي ما هو", () => {
    // الأساس نص المستخدم — لو هو اللي كتب سطر جديد، الإملاء يكمّل بعده
    expect(mergeTranscript("سطر\n", "مرحبا")).toBe("سطر\nمرحبا")
  })

  it("ضم سلسلة نتائج متتالية ما يطلعش أي سطر جديد", () => {
    const merged = ["\nالسلام", "\nعليكم", " إزيك"].map(normalizeTranscript).reduce(mergeTranscript, "")
    expect(merged).toBe("السلام عليكم إزيك")
  })
})
