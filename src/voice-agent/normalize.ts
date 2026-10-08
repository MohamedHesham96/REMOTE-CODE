// تطبيع نص التفريغ لأغراض المطابقة الدلالية فقط — لا يغيّر النص المعروض
// للمستخدم. محرّكات التعرّف ترجّع الهمزات والألفات بأشكال مختلفة، وبعضها
// يضيف تشكيلًا، والأرقام قد تصل عربية-هندية، والكلمات اللاتينية بأي حالة
// أحرف. التطبيع هنا يوسّع نطاق التطابق من غير قوائم صيغ حرفية: القواعد
// بنائية، والكلمات نفسها بيانات في lexicon.ts فيمكن إضافة لغة كاملة هناك.

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g

function digitToAscii(value: string): string {
  const code = value.charCodeAt(0)
  if (code >= 0x0660 && code <= 0x0669) {
    return String(code - 0x0660)
  }
  if (code >= 0x06F0 && code <= 0x06F9) {
    return String(code - 0x06F0)
  }
  return value
}

// يوحّد الهمزات والألفات والتاء المربوطة والياء، ويشيل التشكيل والتطويل،
// ويحوّل الترقيم لمسافات، ويرجّع الحروف صغيرة. الناتج نص مطبّع بمفردات
// مفصولة بمسافة واحدة.
export function normalizeVoiceText(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(ARABIC_INDIC_DIGITS, digitToAscii)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

export function tokenizeVoiceText(text: string): string[] {
  const normalized = normalizeVoiceText(text)
  return normalized ? normalized.split(" ") : []
}

// نسخة بلا مسافات — تُستخدم لمطابقة الأسماء المركّبة والمسارات.
export function compactVoiceText(text: string): string {
  return normalizeVoiceText(text).replace(/ /g, "")
}

// جدول نقل عربي→لاتيني مبسّط: الهدف مطابقة الاسم المنطوق عربيًا مع الاسم
// المكتوب لاتينيًا («ريموت كود» ≈ RemoteCode) من غير بيانات إضافية.
const ARABIC_TRANSLITERATION: Record<string, string> = {
  "ا": "a", "ب": "b", "ت": "t", "ث": "t", "ج": "j", "ح": "h", "خ": "k",
  "د": "d", "ذ": "z", "ر": "r", "ز": "z", "س": "s", "ش": "s", "ص": "s",
  "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "g", "ف": "f", "ق": "k",
  "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y",
  "ء": "",
}

// الهيكل الساكن للاسم: نقل عربي→لاتيني ثم توحيد الأصوات المتقاربة
// (c/q→k، p→b، v→f) ثم إزالة حروف العلّة. النتيجة قابلة للمقارنة عبر
// اللغتين: «ريموت كود» و"RemoteCode" يعطيان نفس الهيكل تقريبًا.
export function nameSkeleton(text: string): string {
  let value = compactVoiceText(text)
  value = value
    .replace(/sh/g, "s")
    .replace(/th/g, "t")
    .replace(/ch/g, "k")
    .replace(/kh/g, "k")
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
  let transliterated = ""
  for (const character of value) {
    transliterated += ARABIC_TRANSLITERATION[character] ?? character
  }
  return transliterated
    .replace(/[cq]/g, "k")
    .replace(/p/g, "b")
    .replace(/v/g, "f")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/g/g, "j")
    .replace(/[aeiouyw]/g, "")
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  if (!left) {
    return right.length
  }
  if (!right) {
    return left.length
  }
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1)
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution)
    }
    previous = current
  }
  return previous[right.length]!
}

// تشابه الهياكن الساكنة 0..1 — نقطة البداية لمطابقة أسماء من لغتين مختلفتين.
export function skeletonSimilarity(left: string, right: string): number {
  const a = nameSkeleton(left)
  const b = nameSkeleton(right)
  if (!a || !b) {
    return 0
  }
  if (a === b) {
    return 1
  }
  // الهياكل القصيرة جدًا عرضة للتصادف، فما نقبلهاش إلا بتطابق كامل (فوق).
  if (Math.min(a.length, b.length) <= 2) {
    return 0
  }
  return 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length)
}

export interface NameMatch {
  score: number
}

// مطابقة اسم واحد: تساوي مضغوط، أو احتواء، أو تطابق كل كلمات الاستعلام،
// وأخيرًا تشابه الهيكل الساكن. النتيجة 0..1 — والحد الأدنى للقبول في
// planner.ts عشان سياسة القبول تفضل في مكان واحد.
export function nameSimilarity(query: string, candidate: string): number {
  const normalizedQuery = normalizeVoiceText(query)
  const normalizedCandidate = normalizeVoiceText(candidate)
  if (!normalizedQuery || !normalizedCandidate) {
    return 0
  }
  const compactQuery = normalizedQuery.replace(/ /g, "")
  const compactCandidate = normalizedCandidate.replace(/ /g, "")
  if (compactQuery === compactCandidate) {
    return 1
  }
  if (compactQuery.length >= 3 && compactCandidate.includes(compactQuery)) {
    return 0.92
  }
  if (compactCandidate.length >= 3 && compactQuery.includes(compactCandidate)) {
    return 0.9
  }
  const queryTokens = normalizedQuery.split(" ")
  const candidateTokens = new Set(normalizedCandidate.split(" "))
  if (queryTokens.length > 0 && queryTokens.every((token) => candidateTokens.has(token))) {
    return 0.9
  }
  return skeletonSimilarity(query, candidate)
}
