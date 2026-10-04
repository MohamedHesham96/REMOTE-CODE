import type { Strings } from "./i18n"

// لغة الإدخال الصوتي إعداد مستقل عن لغة الواجهة عن قصد: المستخدم ممكن يشغّل
// الواجهة إنجليزي وهو بيتكلم عربي، فربط لغة المايك بالواجهة بيفشل. "auto"
// بتتبع لغة الجهاز (navigator.language)، والباقي اختيار صريح.
export type VoiceLanguage = "auto" | "ar" | "en"

export const VOICE_LANGUAGES: VoiceLanguage[] = ["auto", "ar", "en"]

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