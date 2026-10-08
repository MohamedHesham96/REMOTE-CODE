import { describe, expect, it } from "vitest"
import type { EntityReference } from "./intents"
import { clarificationOrdinal, resolveVoiceIntents, splitVoiceClauses, voiceAffirmation, voiceNegation } from "./resolver"
import { tokenizeVoiceText } from "./normalize"

function kinds(transcript: string): string[] {
  return resolveVoiceIntents(transcript).map((intent) => intent.kind)
}

function first(transcript: string) {
  return resolveVoiceIntents(transcript)[0]
}

describe("صيغ متعددة لنفس القصد", () => {
  it("كل التعبيرات عن فتح الطلبات ترجع لنفس القصد", () => {
    const phrases = [
      "Open requests",
      "Show me the requests",
      "Take me to requests",
      "I want to see the requests",
      "Can you bring up the requests screen?",
      "Let's look at the requests",
      "عرض الطلبات",
      "وريني الطلبات",
      "عايز أشوف الطلبات",
      "روح على الطلبات",
      "ممكن تفتحلي الطلبات؟",
    ]
    for (const phrase of phrases) {
      expect(kinds(phrase), phrase).toEqual(["show-requests"])
    }
  })

  it("صيغ متعددة لفتح الإعدادات", () => {
    expect(kinds("open settings")).toEqual(["open-settings"])
    expect(kinds("افتح الإعدادات")).toEqual(["open-settings"])
    expect(kinds("وديني على الإعدادات")).toEqual(["open-settings"])
    expect(kinds("settings")).toEqual(["open-settings"])
  })

  it("صيغ متعددة لفتح المشروع", () => {
    expect(kinds("افتح المشروع")).toEqual(["open-project"])
    expect(kinds("روح على المشروع")).toEqual(["open-project"])
    expect(kinds("take me to the project")).toEqual(["open-project"])
  })

  it("صيغ متعددة للرجوع", () => {
    expect(kinds("go back")).toEqual(["go-back"])
    expect(kinds("رجعني")).toEqual(["go-back"])
    expect(kinds("ارجع للشاشة اللي كنت فيها")).toEqual(["go-back"])
  })

  it("صيغ متعددة لعرض ما يعمل الآن", () => {
    expect(kinds("Show me what is currently running")).toEqual(["show-running"])
    expect(kinds("إيه اللي شغال دلوقتي؟")).toEqual(["show-running"])
    expect(kinds("what's active?")).toEqual(["show-running"])
  })
})

describe("استخراج الكيانات", () => {
  it("اسم المشروع عربي وإنجليزي", () => {
    const arabic = first("افتح مشروع RemoteCode")
    expect(arabic?.kind).toBe("open-project")
    expect(arabic?.project).toEqual<EntityReference>({ kind: "named", text: "remotecode" })

    const english = first("Open the RemoteCode project")
    expect(english?.kind).toBe("open-project")
    expect(english?.project).toEqual<EntityReference>({ kind: "named", text: "remotecode" })

    const mixed = first("Take me to project RemoteCode")
    expect(mixed?.kind).toBe("open-project")
    expect(mixed?.project).toEqual<EntityReference>({ kind: "named", text: "remotecode" })
  })

  it("الاسم بلا كلمة مشروع ينتج قصدًا مفتوح النوع", () => {
    const intent = first("Open RemoteCode")
    expect(intent?.kind).toBe("open-named")
    expect(intent?.name).toBe("remotecode")
    expect(first("افتح RemoteCode")?.kind).toBe("open-named")
  })

  it("المرجع الزمني للمحادثة", () => {
    expect(first("افتح آخر محادثة")?.conversation).toEqual<EntityReference>({ kind: "latest" })
    expect(first("Open the latest conversation")?.conversation).toEqual<EntityReference>({ kind: "latest" })
    expect(first("ممكن تفتحلي آخر conversation؟")?.conversation).toEqual<EntityReference>({ kind: "latest" })
  })

  it("مرجع المحادثة اللي كنت شغال عليها", () => {
    expect(first("افتح المحادثة اللي كنت شغال عليها")?.conversation).toEqual<EntityReference>({ kind: "last-used" })
    expect(first("Open the conversation I was working on")?.conversation).toEqual<EntityReference>({ kind: "last-used" })
  })

  it("مرجع المشروع الحالي", () => {
    expect(first("افتح المشروع الحالي")?.project).toEqual<EntityReference>({ kind: "current" })
    expect(first("Open the current project")?.project).toEqual<EntityReference>({ kind: "current" })
  })

  it("الترتيب الرقمي", () => {
    expect(first("Open the second project")?.project).toEqual<EntityReference>({ kind: "ordinal", index: 2 })
    expect(first("افتح المشروع التاني")?.project).toEqual<EntityReference>({ kind: "ordinal", index: 2 })
    expect(first("افتح المحادثة الثالثة")?.conversation).toEqual<EntityReference>({ kind: "ordinal", index: 3 })
  })

  it("اسم المحادثة المذكور", () => {
    const intent = first("افتح محادثة إصلاح اللوجين")
    expect(intent?.kind).toBe("open-conversation")
    expect(intent?.conversation).toEqual<EntityReference>({ kind: "named", text: "اصلاح اللوجين" })
  })

  it("الضمير بلا نوع ينتج مرجعًا مفتوحًا", () => {
    expect(kinds("افتحه")).toEqual(["open-reference"])
    expect(kinds("open it")).toEqual(["open-reference"])
  })

  it("المرجع بلا نوع بيحمل قيمة المرجع نفسها", () => {
    expect(first("Open the latest one")?.reference).toEqual<EntityReference>({ kind: "latest" })
    expect(first("افتح السابق")?.reference).toEqual<EntityReference>({ kind: "previous" })
  })

  it("أوامر معلومات القوائم", () => {
    expect(kinds("which projects do I have?")).toEqual(["list-projects"])
    expect(kinds("ايه المشاريع اللي عندي؟")).toEqual(["list-projects"])
    expect(kinds("what conversations do I have?")).toEqual(["list-conversations"])
    expect(kinds("ايه النماذج المتاحة؟")).toEqual(["list-models"])
  })
})

describe("الأوامر المتعددة الخطوات", () => {
  it("يقسم جملة إنجليزية مركّبة إلى ثلاثة أقسام بترتيب الكلام", () => {
    const intents = resolveVoiceIntents("Open RemoteCode, then open the latest conversation and show me the requests")
    expect(intents.map((intent) => intent.kind)).toEqual(["open-named", "open-conversation", "show-requests"])
    expect(intents[0]?.name).toBe("remotecode")
    expect(intents[1]?.conversation).toEqual<EntityReference>({ kind: "latest" })
  })

  it("يقسم جملة عربية مركّبة بالفعل المتصل بالواو", () => {
    const intents = resolveVoiceIntents("افتح RemoteCode ثم افتح آخر محادثة واعرض الطلبات")
    expect(intents.map((intent) => intent.kind)).toEqual(["open-named", "open-conversation", "show-requests"])
  })

  it("لا يقسم أسماء المشاريع التي تحتوي على and", () => {
    const clauses = splitVoiceClauses(tokenizeVoiceText("Open the Research and Development project"))
    expect(clauses).toHaveLength(1)
  })

  it("لا يقسم كلامًا واحدًا بلا روابط", () => {
    expect(splitVoiceClauses(tokenizeVoiceText("افتح آخر محادثة"))).toHaveLength(1)
  })
})

describe("الأمان وعدم الاختراع", () => {
  it("أمر غير مفهوم لا ينتج أي قصد", () => {
    expect(kinds("Make my application fly")).toEqual([])
    expect(kinds("بلا بلا بلا")).toEqual([])
  })

  it("الحذف بلا قدرة مسجّلة ينتج قصدًا غير مدعوم", () => {
    expect(kinds("Delete the entire project")).toEqual(["unsupported"])
    expect(kinds("احذف المشروع")).toEqual(["unsupported"])
  })

  it("إنشاء مشروع غير مدعوم", () => {
    expect(kinds("افتح مشروع جديد")).toEqual(["unsupported"])
  })

  it("إيقاف المهمة قصد مستقل", () => {
    expect(kinds("stop the running task")).toEqual(["stop-task"])
    expect(kinds("أوقف المهمة")).toEqual(["stop-task"])
  })

  it("إيقاف الاستماع أمر محلي لطبقة الصوت", () => {
    expect(kinds("stop listening")).toEqual(["stop-listening"])
    expect(kinds("اقفل المايك")).toEqual(["stop-listening"])
  })
})

describe("إعدادات سريعة", () => {
  it("تبديل المظهر", () => {
    expect(first("فعّل المظهر الداكن")?.theme).toBe("dark")
    expect(first("switch to light mode")?.kind).toBe("set-theme")
    expect(first("switch to light mode")?.theme).toBe("glass")
  })

  it("تبديل اللغة", () => {
    expect(first("غيّر اللغة للإنجليزي")?.language).toBe("en")
    expect(first("change the language to Arabic")?.language).toBe("ar")
  })

  it("كتم الصوت", () => {
    expect(first("اكتم الصوت")).toMatchObject({ kind: "set-sound", sound: false })
    expect(first("mute the sound")).toMatchObject({ kind: "set-sound", sound: false })
    expect(first("شغل الصوت")).toMatchObject({ kind: "set-sound", sound: true })
  })

  it("تبديل النموذج بصفة سرعة", () => {
    const intent = first("Switch to the faster model")
    expect(intent?.kind).toBe("change-model")
    expect(intent?.modelQualifier).toBe("faster")
    expect(first("بدّل لأسرع نموذج")?.modelQualifier).toBe("faster")
  })

  it("تبديل النموذج بالاسم", () => {
    const intent = first("switch to Sonnet")
    expect(intent?.kind).toBe("change-model")
    expect(intent?.model).toEqual<EntityReference>({ kind: "named", text: "sonnet" })
  })
})

describe("التأكيد والرفض", () => {
  it("يلقط التأكيد عربي وإنجليزي", () => {
    expect(voiceAffirmation(tokenizeVoiceText("نعم"))).toBe(true)
    expect(voiceAffirmation(tokenizeVoiceText("تمام"))).toBe(true)
    expect(voiceAffirmation(tokenizeVoiceText("yes"))).toBe(true)
    expect(voiceAffirmation(tokenizeVoiceText("go ahead"))).toBe(true)
  })

  it("يلقط الرفض عربي وإنجليزي", () => {
    expect(voiceNegation(tokenizeVoiceText("لا"))).toBe(true)
    expect(voiceNegation(tokenizeVoiceText("إلغاء"))).toBe(true)
    expect(voiceNegation(tokenizeVoiceText("no"))).toBe(true)
    expect(voiceNegation(tokenizeVoiceText("cancel"))).toBe(true)
  })
})

describe("clarificationOrdinal", () => {
  it("يرجّع رقم الترتيب من الكلام", () => {
    expect(clarificationOrdinal(tokenizeVoiceText("التاني"))).toBe(2)
    expect(clarificationOrdinal(tokenizeVoiceText("the second one"))).toBe(2)
    expect(clarificationOrdinal(tokenizeVoiceText("الأول"))).toBe(1)
  })

  it("يرجّع -1 لـ الأخير", () => {
    expect(clarificationOrdinal(tokenizeVoiceText("الأخير"))).toBe(-1)
    expect(clarificationOrdinal(tokenizeVoiceText("the last one"))).toBe(-1)
  })

  it("يرجّع null لما مفيش ترتيب", () => {
    expect(clarificationOrdinal(tokenizeVoiceText("RemoteCode"))).toBeNull()
  })
})
