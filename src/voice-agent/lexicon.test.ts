import { describe, expect, it } from "vitest"
import { collectLexiconPhrases, findPhrase, matchLongestPhrase, VOICE_LEXICON } from "./lexicon"
import { normalizeVoiceText, tokenizeVoiceText } from "./normalize"

// المعجم بيانات، وأي عبارة فيه مكتوبة يدويًا معرّضة للخطأ: لو دخلت بتشكيل
// أو بهمزة غير مطبّعة لن تطابق أبدًا وقت التشغيل. الاختبار ده حارس بيانات.
describe("VOICE_LEXICON", () => {
  it("كل عبارة مكتوبة بصيغتها المطبّعة", () => {
    for (const phrase of collectLexiconPhrases()) {
      expect(normalizeVoiceText(phrase), `العبارة غير مطبّعة: ${phrase}`).toBe(phrase)
    }
  })

  it("لا تحتوي قوائم المفردات على تكرار داخل نفس القائمة", () => {
    for (const bucket of Object.values(VOICE_LEXICON.verbs)) {
      expect(new Set(bucket).size).toBe(bucket.length)
    }
    for (const bucket of Object.values(VOICE_LEXICON.targets)) {
      expect(new Set(bucket).size).toBe(bucket.length)
    }
  })
})

describe("matchLongestPhrase", () => {
  it("يطابق على حدود كلمات كاملة فقط", () => {
    const tokens = tokenizeVoiceText("افتح المحادثة")
    expect(matchLongestPhrase(tokens, 0, VOICE_LEXICON.verbs.open)?.phrase).toBe("افتح")
    expect(matchLongestPhrase(tokens, 1, VOICE_LEXICON.targets.conversation)?.phrase).toBe("المحادثه")
  })

  it("يفضّل العبارة الأطول عند التداخل", () => {
    const tokens = tokenizeVoiceText("ملاحظات الإصدار")
    expect(matchLongestPhrase(tokens, 0, VOICE_LEXICON.targets.releases)?.phrase).toBe("ملاحظات الاصدار")
  })

  it("لا يطابق منتصف كلمة", () => {
    const tokens = tokenizeVoiceText("إلغاء")
    expect(matchLongestPhrase(tokens, 0, ["لغ"])).toBeNull()
  })
})

describe("findPhrase", () => {
  it("يلقط العبارة من أي موضع", () => {
    const tokens = tokenizeVoiceText("ممكن تفتحلي آخر محادثة؟")
    expect(findPhrase(tokens, VOICE_LEXICON.references.latest)?.phrase).toBe("اخر")
  })

  it("يلقط العبارة متعددة الكلمات", () => {
    const tokens = tokenizeVoiceText("افتح اللي كنت شغال عليه")
    expect(findPhrase(tokens, VOICE_LEXICON.references.lastUsed)?.phrase).toBe("اللي كنت شغال عليه")
  })

  it("يلقط العبارة الإنجليزية متعددة الكلمات", () => {
    const tokens = tokenizeVoiceText("open the one I was working on")
    expect(findPhrase(tokens, VOICE_LEXICON.references.lastUsed)?.phrase).toBe("the one i was working on")
  })

  it("يرجّع null لما مفيش تطابق", () => {
    expect(findPhrase(tokenizeVoiceText("السلام عليكم"), VOICE_LEXICON.targets.git)).toBeNull()
  })
})
