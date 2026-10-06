import { describe, expect, it } from "vitest"
import { effectiveVoiceLanguage, flattenRecognitionSegments, hasVoiceClearCommand, joinTranscriptSegments, languageCodeOf, mergeTranscript, mergeTranscriptOverlap, nextVoiceLanguage, normalizeTranscript, reduceVoiceTranscript, type RecognizedSegment, type VoiceTranscriptState, voiceLanguageCode } from "./voice"

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

// محرّك أندرويد بيكرّر: بيعيد المقطع النهائي مرتين، وبيعلّم المصحّحات الوسيطة
// كأنها نهائية بثقة صفر. الاختبارات دي بتثبّت قواعد التنظيف اللي بتمنع ظهور
// "زي زي زي زي" في الحقل.

describe("joinTranscriptSegments", () => {
  it("ما يكرّرش المقطع نفسه لما المحرّك يبعته مرتين", () => {
    expect(joinTranscriptSegments(["زي", "زي"])).toBe("زي")
  })

  it("يطوي المقاطع التراكمية لآخر أكمل نسخة", () => {
    expect(joinTranscriptSegments(["مو", "موبا", "موبايل"])).toBe("موبايل")
  })

  it("يضم المقاطع الطبيعية بمسافة واحدة", () => {
    expect(joinTranscriptSegments(["السلام", "عليكم"])).toBe("السلام عليكم")
  })

  it("يتجاهل المقاطع الفاضية ويطبّع المسافات", () => {
    expect(joinTranscriptSegments(["  ", "\nالسلام", "", "عليكم  "])).toBe("السلام عليكم")
  })
})

describe("flattenRecognitionSegments", () => {
  it("على سطح المكتب يثق في isFinal حتى لو الثقة صفر", () => {
    const flat = flattenRecognitionSegments(
      [
        { transcript: "السلام", isFinal: true, confidence: 0 },
        { transcript: "عليكم", isFinal: false, confidence: 0 },
      ],
      false,
    )
    expect(flat).toEqual({ finalText: "السلام", interimText: "عليكم" })
  })

  it("على أندرويد يعامل النهائي بثقة صفر كمبدئي", () => {
    const flat = flattenRecognitionSegments(
      [
        { transcript: "السلام", isFinal: true, confidence: 0.8 },
        { transcript: "عليكم", isFinal: true, confidence: 0 },
      ],
      true,
    )
    expect(flat).toEqual({ finalText: "السلام", interimText: "عليكم" })
  })

  it("على أندرويد يقبل النهائي بثقة موجبة", () => {
    const flat = flattenRecognitionSegments(
      [
        { transcript: "زي", isFinal: true, confidence: 0.9 },
        { transcript: "زي", isFinal: true, confidence: 0.9 },
      ],
      true,
    )
    expect(flat).toEqual({ finalText: "زي", interimText: "" })
  })
})

describe("mergeTranscriptOverlap", () => {
  it("يشيل التداخل عند الوصلة على مستوى الكلمات", () => {
    expect(mergeTranscriptOverlap("زي كده", "كده بعد")).toBe("زي كده بعد")
  })

  it("يطوي المقطع المكرّر والمقطع التراكمي", () => {
    expect(mergeTranscriptOverlap("زي", "زي")).toBe("زي")
    expect(mergeTranscriptOverlap("مو", "موبا")).toBe("موبا")
  })

  it("يضم النصّين الجديدين بمسافة واحدة", () => {
    expect(mergeTranscriptOverlap("السلام", "عليكم")).toBe("السلام عليكم")
  })

  it("ما يدمجش تداخلًا حرفيًا جوه الكلمات", () => {
    // «أنا» + «نام» … التداخل الحرفي "نا" مش على حدود كلمة، فما ينفعش يندمج
    expect(mergeTranscriptOverlap("أنا", "نام")).toBe("أنا نام")
  })

  it("يسيب الأكمل لما المحرّك يعيد جزءًا من نص متجمّع بالفعل", () => {
    expect(mergeTranscriptOverlap("زي كده بعد", "كده بعد")).toBe("زي كده بعد")
    expect(mergeTranscriptOverlap("زي كده بعد", "زي كده")).toBe("زي كده بعد")
  })
})

describe("hasVoiceClearCommand", () => {
  it("يلقط العبارة بالظبط", () => {
    expect(hasVoiceClearCommand("امسح الكلام كله")).toBe(true)
  })

  it("يلقطها وسط كلام", () => {
    expect(hasVoiceClearCommand("طيب امسح الكلام كله بعدين")).toBe(true)
  })

  it("يتجاهل التشكيل واختلاف الهمزة والتاء المربوطة", () => {
    expect(hasVoiceClearCommand("إمْسَح الكلام كلّه")).toBe(true)
  })

  it("مايلقطش كلام عادي ما فيهوش الأمر", () => {
    expect(hasVoiceClearCommand("الكلام كله زي الفل")).toBe(false)
  })

  it("يلقط الأمر الإنجليزي بأي حالة أحرف", () => {
    expect(hasVoiceClearCommand("Clear All Text")).toBe(true)
    expect(hasVoiceClearCommand("please start over now")).toBe(true)
  })

  it("مايلقطش كلمة clear لوحدها لأنها مش أمر كامل", () => {
    expect(hasVoiceClearCommand("clear")).toBe(false)
    expect(hasVoiceClearCommand("the sky is clear today")).toBe(false)
  })
})

describe("reduceVoiceTranscript", () => {
  const segment = (transcript: string, isFinal: boolean, confidence = 0.9): RecognizedSegment => ({ transcript, isFinal, confidence })

  it("يجمّع الجملة عبر الأحداث من غير تكرار", () => {
    const first = reduceVoiceTranscript({ base: "", confirmed: "", suppress: "" }, [segment("زي", true)], true)
    expect(first.text).toBe("زي")
    const second = reduceVoiceTranscript(first.state, [segment("زي", true), segment("كده", true)], true)
    expect(second.text).toBe("زي كده")
  })

  it("ما يكرّرش الكلمة لما المحرّك يبعت النهائي مرتين", () => {
    const first = reduceVoiceTranscript({ base: "", confirmed: "", suppress: "" }, [segment("زي", true)], true)
    const second = reduceVoiceTranscript(first.state, [segment("زي", true), segment("زي", true)], true)
    expect(second.text).toBe("زي")
  })

  it("ما يكرّرش الجملة لما المحرّك يعيد إرسالها كاملة عند وقف الاستماع", () => {
    // ده السيناريو اللي كان بيطلّع الجملة مرتين: الجملة توصل على أجزاء والمحرّك
    // بيصفّر مصفوفة النتائج مع كل جزء، وبعدين عند الوقوف يبعت الجملة كاملة تاني.
    let state: VoiceTranscriptState = { base: "", confirmed: "", suppress: "" }
    state = reduceVoiceTranscript(state, [segment("زي", true)], true).state
    state = reduceVoiceTranscript(state, [segment("كده", true)], true).state
    const spoken = reduceVoiceTranscript(state, [segment("بعد", true)], true)
    expect(spoken.text).toBe("زي كده بعد")

    const flush = reduceVoiceTranscript(spoken.state, [segment("زي", true), segment("كده", true), segment("بعد", true)], true)
    expect(flush.text).toBe("زي كده بعد")
  })

  it("ما يكرّرش الكلام لما محرّك أندرويد يصحّح ويقصّر النص الوسيط", () => {
    // الثقة صفر معناها المقطع لسه بيتغيّر، فبيتعامل كمبدئي ومسموح له يتراجع
    // بدل ما يتضمّن للنهائي ويفضل ثابت بعدين يتكرّر.
    const state: VoiceTranscriptState = { base: "", confirmed: "", suppress: "" }
    const longer = reduceVoiceTranscript(state, [segment("زي كده", true, 0)], true)
    expect(longer.text).toBe("زي كده")
    const shortened = reduceVoiceTranscript(longer.state, [segment("زي", true, 0)], true)
    expect(shortened.text).toBe("زي")
  })

  it("يجمّع النص الجديد فوق نص الحقل الأصلي", () => {
    const state: VoiceTranscriptState = { base: "مرحبا", confirmed: "", suppress: "" }
    const result = reduceVoiceTranscript(state, [segment("عليكم", true)], true)
    expect(result.text).toBe("مرحبا عليكم")
    expect(result.state).toEqual({ base: "مرحبا", confirmed: "عليكم", suppress: "" })
  })

  it("يمسح كل حاجة لما يتقال أمر المسح", () => {
    const state: VoiceTranscriptState = { base: "مرحبا", confirmed: "زي كده", suppress: "" }
    const result = reduceVoiceTranscript(state, [segment("امسح الكلام كله", true)], true)
    expect(result.cleared).toBe(true)
    expect(result.text).toBe("")
    expect(result.state).toEqual({ base: "", confirmed: "", suppress: "زي كده امسح الكلام كله" })
  })

  it("ما يرجّعش الكلام الممسوح مع إعادة إرسال المحرّك، ويقبل كلام جديد بعده", () => {
    const cleared = reduceVoiceTranscript(
      { base: "", confirmed: "زي كده", suppress: "" },
      [segment("زي كده امسح الكلام كله", true)],
      true,
    )
    expect(cleared.cleared).toBe(true)
    expect(cleared.text).toBe("")

    const echo = reduceVoiceTranscript(cleared.state, [segment("زي كده امسح الكلام كله", true)], true)
    expect(echo.cleared).toBe(false)
    expect(echo.text).toBe("")

    const fresh = reduceVoiceTranscript(echo.state, [segment("زي كده امسح الكلام كله السلام عليكم", true)], true)
    expect(fresh.text).toBe("السلام عليكم")
  })
})
