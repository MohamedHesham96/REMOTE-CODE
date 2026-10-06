import type { Strings } from "./i18n"

// لغة الإدخال الصوتي إعداد مستقل عن لغة الواجهة عن قصد: المستخدم ممكن يشغّل
// الواجهة إنجليزي وهو بيتكلم عربي، فربط لغة المايك بالواجهة بيفشل. "auto"
// بتتبع لغة الجهاز (navigator.language)، والباقي اختيار صريح.
export type VoiceLanguage = "auto" | "ar" | "en"

export const VOICE_LANGUAGES: VoiceLanguage[] = ["auto", "ar", "en"]

// اللغة التالية في الدورة — زر تبديل اللغة جنب المايك بيلفّ: تلقائي ← عربي ←
// إنجليزي ← تلقائي. الإعداد مخزّن في localStorage عبر saveVoiceLanguage.
export function nextVoiceLanguage(value: VoiceLanguage): VoiceLanguage {
  const index = VOICE_LANGUAGES.indexOf(value)
  return VOICE_LANGUAGES[(index + 1) % VOICE_LANGUAGES.length] ?? "auto"
}

const VOICE_LANGUAGE_KEY = "opencode-voice-language"

export function getSavedVoiceLanguage(): VoiceLanguage {
  try {
    const raw = localStorage.getItem(VOICE_LANGUAGE_KEY)
    if (raw === "auto" || raw === "ar" || raw === "en") {
      return raw
    }
  } catch {
    // التخزين غير متاح — الافتراضي.
  }
  return "auto"
}

export function saveVoiceLanguage(value: VoiceLanguage): void {
  try {
    localStorage.setItem(VOICE_LANGUAGE_KEY, value)
  } catch {
    // تجاهل — التخزين غير متاح.
  }
}

// وسم BCP-47 اللي يتبعت لمحرك التعرف. undefined معناه "اتبع لغة الجهاز" —
// والهوك هو اللي يحلّها لـ navigator.language وقت الجلسة.
export function voiceRecognitionTag(value: VoiceLanguage): string | undefined {
  if (value === "ar") {
    return "ar-EG"
  }
  if (value === "en") {
    return "en-US"
  }
  return undefined
}

export function voiceLanguageLabel(value: VoiceLanguage, t: Strings): string {
  if (value === "ar") {
    return t.voiceLanguageArabic
  }
  if (value === "en") {
    return t.voiceLanguageEnglish
  }
  return t.voiceLanguageAuto
}

export function voiceLanguageDescription(value: VoiceLanguage, t: Strings): string {
  if (value === "ar") {
    return t.voiceLanguageArabicDesc
  }
  if (value === "en") {
    return t.voiceLanguageEnglishDesc
  }
  return t.voiceLanguageAutoDesc
}

// اللغة الفعّالة اللي التعرف هيشتغل بيها دلوقتي — نفس ترتيب حلّ useVoiceInput:
// الإعداد الصريح، وإلا لغة الجهاز، وإلا الإنجليزي. الشارة على زر المايك
// بتستخدمها عشان تُظهر للمستخدم لغة الجلسة الجارية فعلًا؛ "تلقائي" لوحدها
// ما تكفيش لأن المستخدم عايز يعرف اللغة اللي كلامه هيتحوّل بيها قبل ما يتكلم.
export function effectiveVoiceLanguage(value: VoiceLanguage): string {
  const device = typeof navigator !== "undefined" ? navigator.language?.trim() : undefined
  return voiceRecognitionTag(value) ?? device ?? "en-US"
}

// الشارة الصغيرة على زر المايك: "ع" للعربية، وأي لغة تانية بأول جزئين منها
// كي يبان على الزر أنهي لغة التعرف شغالة. "EN" احتياطي لو الوسم فاضي.
export function languageCodeOf(tag: string): string {
  const primary = tag.split(/[-_]/)[0]?.trim().toLowerCase()
  return primary === "ar" ? "ع" : primary ? primary.toUpperCase() : "EN"
}

export function voiceLanguageCode(value: VoiceLanguage): string {
  return languageCodeOf(effectiveVoiceLanguage(value))
}

// تطبيع نص التفريغ لسطر واحد: محرّكات التعرّف بترجّع مسافات وفواصل أسطر
// فاصلة بين النتائج (المواصفة بتقول إنها مسافات "لازمة لضم النتائج"، وكروم
// على أندرويد بيستخدم "\n" فعلًا) — والحقل بيعرض pre-wrap، فالسطر الجديد
// يبان في وسط الكلام أو قبله من غير ما المستخدم يطلبه. الإدخال الصوتي إملاء
// متصل، فبنطوي كل المسافات المتكررة وفواصل الأسطر لمسافة واحدة ونشيل الأطراف.
export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

// ضمّ نصين إملائيين بمسافة واحدة من غير تكرار: لو الأول خلص بمسافة أو
// التاني بدأ بمسافة ما نضيفش مسافة زيادة (النصين المفروض مطبّعين بالفعل،
// والفحص التاني احتياطي لو جاي من مكان تاني).
export function mergeTranscript(base: string, chunk: string): string {
  if (!base) {
    return chunk
  }
  if (!chunk) {
    return base
  }
  return /\s$/.test(base) || /^\s/.test(chunk) ? `${base}${chunk}` : `${base} ${chunk}`
}
