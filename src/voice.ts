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

// أدنى وصف لمقطع تفريغ واحد، مستقل عن أنواع Web Speech DOM عشان قواعد التجميع
// تحت تفضل دوال بحتة قابلة للاختبار من غير متصفح.
export interface RecognizedSegment {
  transcript: string
  isFinal: boolean
  confidence: number
}

// ضمّ نصّين مع إزالة التداخل عند الوصلة: لو آخر كلمة/كلمات في الأول هي نفسها
// أول كلمة/كلمات في التاني ("زي كده" + "كده بعد") ما نكرّرهاش. كمان بيعالج
// الحالات الحرفية اللي محرّك أندرويد بيبعتها: المقطع المكرّر نفسه، أو مقطع
// تراكمي بيبدأ ببداية اللي قبله ("مو" ← "موبا" ← "موبايل"). من غير كده الضمّ
// الساذج بيدّي "مو موبا موبايل" و"زي كده كده بعد".
export function mergeTranscriptOverlap(base: string, chunk: string): string {
  const left = normalizeTranscript(base)
  const right = normalizeTranscript(chunk)
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  // واحد فيهم بيحتوي التاني: ناخد الأكمل. ده بيغطّي المقطع المكرّر، والمقطع
  // التراكمي، وإعادة إرسال الجملة (أو جزء منها) عند وقف الاستماع.
  if (right.includes(left)) {
    return right
  }
  if (left.includes(right)) {
    return left
  }
  const leftWords = left.split(" ")
  const rightWords = right.split(" ")
  const max = Math.min(leftWords.length, rightWords.length)
  for (let n = max; n > 0; n--) {
    if (leftWords.slice(leftWords.length - n).join(" ") === rightWords.slice(0, n).join(" ")) {
      return [...leftWords, ...rightWords.slice(n)].join(" ")
    }
  }
  return `${left} ${right}`
}

// ضم قائمة مقاطع التفريغ بنفس قواعد إزالة التداخل — تُستخدم لنتائج الحدث الواحد.
export function joinTranscriptSegments(segments: readonly string[]): string {
  let result = ""
  for (const raw of segments) {
    result = mergeTranscriptOverlap(result, normalizeTranscript(raw))
  }
  return result
}

// كشف المنصّة مرة واحدة عند الطلب: محرّك أندرويد بيعلّم النتائج المتغيّرة (اللي
// لسه بتتصحّح) كأنها نهائية بثقة صفر لحد ما تستقر، بعكس سطح المكتب. لازم نعرف
// المنصّة عشان نطبّق فحص الثقة ده على أندرويد بس، وإلا النهائي الحقيقي على
// سطح المكتب — اللي ممكن ثقته صفر كمان — هيتعامل كمبدئي.
export function requiresFinalConfidence(): boolean {
  return /android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "")
}

export interface FlatVoiceTranscript {
  finalText: string
  interimText: string
}

// فصل نتائج حدث واحد إلى نص نهائي مستقر ونص مبدئي متغيّر. القرار على isFinal،
// وعلى أندرويد كمان على confidence > 0 (المصحّحات الوسيطة ثقتها صفر).
export function flattenRecognitionSegments(
  segments: readonly RecognizedSegment[],
  requireConfidence: boolean,
): FlatVoiceTranscript {
  const finals: string[] = []
  const interims: string[] = []
  for (const segment of segments) {
    const transcript = normalizeTranscript(segment.transcript)
    if (!transcript) {
      continue
    }
    if (segment.isFinal && (!requireConfidence || segment.confidence > 0)) {
      finals.push(transcript)
    } else {
      interims.push(transcript)
    }
  }
  return { finalText: joinTranscriptSegments(finals), interimText: joinTranscriptSegments(interims) }
}

// أوامر المسح الصوتي: لما يتقال أي واحد فيهم بيمسح كل اللي في الحقل والمايك
// يفضل سامع. العبارات طويلة عن قصد (مش كلمة واحدة) عشان ما تتقالش وسط الكلام
// العادي بالغلط، وفيها عربي وإنجليزي عشان تشتغل مع أي لغة إملاء.
export const VOICE_CLEAR_COMMANDS: readonly string[] = ["امسح الكلام كله", "clear all text", "start over"]

// تطبيع خاص بالمطابقة (مش للعرض): بيشيل التشكيل والتطويل ويوحّد الألفات
// والهمزات والتاء المربوطة والياء، وبيرجّع الحروف صغيرة، عشان المحرّك يكتب
// «إمسح» بتشكيل أو بهمزة مختلفة أو "Clear" بحرف كبير والكلام يفضل يتطابق.
function normalizeForCommandMatch(text: string): string {
  return normalizeTranscript(text)
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .toLowerCase()
}

export function hasVoiceClearCommand(text: string): boolean {
  const haystack = normalizeForCommandMatch(text)
  if (!haystack) {
    return false
  }
  return VOICE_CLEAR_COMMANDS.some((command) => haystack.includes(normalizeForCommandMatch(command)))
}

// بادئة محجوبة بعد أمر مسح: المحرّك بيعيد إرسال الجلسة، فبنشيل النص اللي كان
// موجود وقت الأمر من كل حدث بعده عشان ما يرجعش يظهر. لما النص الجديد ما يبقاش
// مبنيًا على المحجوب (المحرّك بدأ جملة جديدة)، الحجب بيخلص غرضه وبنشيله.
function stripSuppressed(text: string, suppress: string): { text: string; suppress: string } {
  const value = normalizeTranscript(text)
  if (!suppress) {
    return { text: value, suppress }
  }
  if (!value || suppress.startsWith(value)) {
    return { text: "", suppress }
  }
  if (value.startsWith(suppress)) {
    return { text: normalizeTranscript(value.slice(suppress.length)), suppress }
  }
  return { text: value, suppress: "" }
}

// حالة التجميع عبر أحداث التعرف المتتالية في الجلسة الواحدة.
export interface VoiceTranscriptState {
  // نص الحقل قبل بداية الجلسة (بما فيه جلسات اللوك اللي فاتت).
  base: string
  // النص النهائي المستقر المتراكم في الجلسة الجارية، بيتجمّع من كل حدث بضمّ
  // واعي بالتداخل عشان إعادة إرسال جزء منه ما تكرّرهوش.
  confirmed: string
  // بادئة محجوبة بعد أمر مسح (شوف stripSuppressed).
  suppress: string
}

export interface VoiceTranscriptResult {
  state: VoiceTranscriptState
  text: string
  // true لما الحدث ده يكون أمر مسح فاتنضّف الحقل بالكامل.
  cleared: boolean
}

// إعادة بناء النص الكامل من حالة سابقة + حدث التعرف الحالي. إعادة الحساب من
// الصفر كل حدث مقصودة: أي تكرار جوه الحدث نفسه بيتصفّى قبل ما يتراكم. ومهم:
// مفيش أي «ضمّ للأساس» أثناء الجلسة — المحرّك وقت الوقوف بيعيد إرسال الجملة
// كاملة، فلو كنا ضمّينا أجزاءها للأساس ونضمّها تاني هنا الجملة تتكرر. بدل كده
// بنجمّع النهائي كله في confirmed بضمّ بيشيل التداخل، فإعادة الإرسال ما بتغيّرش
// حاجة. وكمان بيتعامل مع أمر المسح الصوتي.
export function reduceVoiceTranscript(
  state: VoiceTranscriptState,
  segments: readonly RecognizedSegment[],
  requireConfidence: boolean,
): VoiceTranscriptResult {
  const flat = flattenRecognitionSegments(segments, requireConfidence)
  const strippedFinal = stripSuppressed(flat.finalText, state.suppress)
  const strippedInterim = stripSuppressed(flat.interimText, strippedFinal.suppress)
  const suppress = strippedInterim.suppress
  const finalText = strippedFinal.text
  const interimText = strippedInterim.text
  const recognized = mergeTranscript(mergeTranscriptOverlap(state.confirmed, finalText), interimText)

  // أمر المسح: نمسح كل حاجة في الحقل (بما فيه المكتوب بالإيد) ونحجب النص
  // المُتعرَّف عليه الحالي عشان إعادة إرسال المحرّك ما ترجّعش الكلام الممسوح.
  if (recognized && hasVoiceClearCommand(recognized)) {
    return { state: { base: "", confirmed: "", suppress: recognized }, text: "", cleared: true }
  }

  const confirmed = mergeTranscriptOverlap(state.confirmed, finalText)
  const text = mergeTranscript(state.base, mergeTranscriptOverlap(confirmed, interimText))
  return { state: { base: state.base, confirmed, suppress }, text, cleared: false }
}
