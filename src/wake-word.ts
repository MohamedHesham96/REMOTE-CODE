import type { Language } from "./i18n"
import { normalizeForVoiceMatch } from "./voice"

// إعدادات كلمة التنبيه محلية للجهاز عن قصد: مين عايز الميكروفون يفضل سامع في
// الخلفية قرار خصوصية شخصي، فمايتخزّنش على السيرفر ولا يتشارك بين الأجهزة.
const WAKE_WORD_ENABLED_KEY = "opencode-wake-word-enabled"
const WAKE_WORD_PHRASE_KEY = "opencode-wake-word-phrase"

// أقل طول منطقي للعبارة: كلمة من حرف أو حرفين بتتقال من غير قصد وسط الكلام
// العادي، والمطابقة عليها بتولّد فتحًا كاذبًا للوحة.
export const MIN_WAKE_PHRASE_CHARS = 3

// حالة صف الإعداد في الدرج: القيم دي هي اللي بتحدد النص التوضيحي المعروض.
export type WakeWordStatus = "off" | "idle" | "active" | "blocked" | "tooShort" | "unsupported"

// العبارة الافتراضية بلغة الواجهة عشان المستخدم يلاقي عبارة تشتغل من غير
// كتابة، والتخزين بيحفظ اللي يكتبه بنفسه فوقها.
export function defaultWakePhrase(lang: Language): string {
  return lang === "ar" ? "يا ريموت" : "hey remote"
}

export function effectiveWakePhrase(phrase: string, lang: Language): string {
  const trimmed = phrase.trim()
  return trimmed || defaultWakePhrase(lang)
}

export function isValidWakePhrase(phrase: string): boolean {
  return normalizeForVoiceMatch(phrase).length >= MIN_WAKE_PHRASE_CHARS
}

// المطابقة بتتم على التطبيع الموحّد (تشكيل/همزات/حالة الأحرف) — نفس منطق أوامر
// المسح الصوتي — فالعبارة تُلتقط لو المحرّك كتبها بشكل مختلف قليلًا.
export function containsWakePhrase(transcript: string, phrase: string): boolean {
  const needle = normalizeForVoiceMatch(phrase)
  if (!needle) {
    return false
  }
  return normalizeForVoiceMatch(transcript).includes(needle)
}

export function getSavedWakeWordEnabled(): boolean {
  try {
    return localStorage.getItem(WAKE_WORD_ENABLED_KEY) === "1"
  } catch {
    // التخزين غير متاح — الافتراضي: مقفولة.
    return false
  }
}

export function saveWakeWordEnabled(value: boolean): void {
  try {
    localStorage.setItem(WAKE_WORD_ENABLED_KEY, value ? "1" : "0")
  } catch {
    // تجاهل — التخزين غير متاح.
  }
}

export function getSavedWakeWordPhrase(): string {
  try {
    return localStorage.getItem(WAKE_WORD_PHRASE_KEY) ?? ""
  } catch {
    // التخزين غير متاح — العبارة الافتراضية هي اللي هتتستخدم.
    return ""
  }
}

export function saveWakeWordPhrase(value: string): void {
  try {
    localStorage.setItem(WAKE_WORD_PHRASE_KEY, value)
  } catch {
    // تجاهل — التخزين غير متاح.
  }
}
