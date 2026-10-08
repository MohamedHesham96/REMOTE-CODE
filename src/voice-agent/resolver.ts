// محلّل الأوامر: من نص طبيعي (عربي/إنجليزي/مخلوط) إلى قصد مكتوب. مفيش أي
// مقارنة نص كامل هنا — التحليل مبني على:
//   1) تطبيع شامل (normalize.ts)
//   2) تقطيع الجملة لفقرات عند روابط مثل "ثم/بعدين/then/and + فعل"
//   3) وسم الفقرة من المعجم: أفعال + أهداف + مراجع زمنية + ترتيب + صفات
//   4) قواعد تركيبية (فعل + هدف) تنتج القصد، والباقي غير الموسوم = اسم كيان
// أي لغة جديدة تُضاف كبيانات في lexicon.ts من غير لمس الملف ده لغير قواعد
// تركيبية خاصة بيها.
import type { Language } from "../i18n"
import type { AppTheme } from "../theme"
import type { EntityReference, ResolvedVoiceIntent, VoiceIntentKind } from "./intents"
import { findPhrase, matchLongestPhrase, VOICE_LEXICON, type VoiceModelQualifier, type VoiceReferenceKind, type VoiceTarget, type VoiceVerb } from "./lexicon"
import { normalizeVoiceText, tokenizeVoiceText } from "./normalize"

// كلمات السؤال بتفرّق بين "افتح المشاريع" (أمر) و"ايه المشاريع اللي عندي؟"
// (طلب معلومات)، والفرق بينهم في العرض مش في التنفيذ.
const QUESTION_PHRASES = VOICE_LEXICON.questionPhrases

// روابط قطع الفقرات: "افتح المشروع ثم اعرض المحادثة". "و/and" مش قطع دائم —
// بنقطع عنده بس لو اللي بعده فعل، عشان أسماء زي "Research and Development"
// ما تتقسمش بالغلط.
const HARD_BREAKS: readonly string[] = ["ثم", "بعدين", "بعد كده", "بعد ذلك", "وبعد", "وبعدها", "بعدها", "كمان", "ايضا", "then", "after", "afterwards", "also"]

const SINGLE_WORD_VERBS: ReadonlySet<string> = new Set(
  Object.values(VOICE_LEXICON.verbs).flat().filter((phrase) => !phrase.includes(" ")),
)

function isVerbWord(token: string): boolean {
  return SINGLE_WORD_VERBS.has(token)
}

function hardBreakLength(tokens: readonly string[], index: number): number {
  for (const phrase of HARD_BREAKS) {
    const parts = phrase.split(" ")
    if (index + parts.length > tokens.length) {
      continue
    }
    let matched = true
    for (let offset = 0; offset < parts.length; offset += 1) {
      if (tokens[index + offset] !== parts[offset]) {
        matched = false
        break
      }
    }
    if (matched) {
      return parts.length
    }
  }
  return 0
}

// تقطيع الأوامر المركّبة: كل فعل رئيسي يبدأ فقرة مستقلة. الأسماء المتبقية
// بدون فعل تُعامل كفقرة واحدة عشان "المشروع بتاع RemoteCode" ما تتقسمش.
export function splitVoiceClauses(tokens: readonly string[]): string[][] {
  const clauses: string[][] = []
  let current: string[] = []
  const flush = () => {
    if (current.length > 0) {
      clauses.push(current)
      current = []
    }
  }
  let index = 0
  while (index < tokens.length) {
    const breakLength = hardBreakLength(tokens, index)
    if (breakLength > 0) {
      flush()
      index += breakLength
      continue
    }
    const token = tokens[index]!
    if (token === "و" || token === "and") {
      const next = tokens[index + 1]
      const bareNext = next && next.length > 2 && next.startsWith("و") ? next.slice(1) : next
      if (next && bareNext && isVerbWord(bareNext)) {
        flush()
        index += 1
        continue
      }
    }
    if (token.length > 2 && token.startsWith("و") && isVerbWord(token.slice(1))) {
      flush()
      current.push(token.slice(1))
      index += 1
      continue
    }
    current.push(token)
    index += 1
  }
  flush()
  return clauses
}

export interface VoiceClauseAnalysis {
  tokens: readonly string[]
  verbs: ReadonlySet<VoiceVerb>
  targets: ReadonlySet<VoiceTarget>
  references: ReadonlySet<VoiceReferenceKind>
  modelQualifiers: ReadonlySet<VoiceModelQualifier>
  ordinal: number | null
  theme: AppTheme | null
  language: Language | null
  sound: boolean | null
  variant: string | null
  question: boolean
  help: boolean
  // الكلمات اللي ما اتصنّفتش — اسم الكيان المذكور (مشروع/محادثة/نموذج)
  name: string
}

interface Span {
  start: number
  length: number
  apply: (analysis: MutableClauseAnalysis) => void
}

interface MutableClauseAnalysis {
  verbs: Set<VoiceVerb>
  targets: Set<VoiceTarget>
  references: Set<VoiceReferenceKind>
  modelQualifiers: Set<VoiceModelQualifier>
  ordinal: number | null
  theme: AppTheme | null
  language: Language | null
  sound: boolean | null
  variant: string | null
}

// وسم الفقرة: جمع كل المطابقات الممكنة (أطول عبارة أولًا) مع منع التداخل،
// والباقي غير الموسوم هو الاسم. ده اللي يخلّي "اللي كنت شغال عليه" تتاخد
// كمرجع واحد بدل ما "شغال" تتصنّف هدف لوحدها.
export function analyzeVoiceClause(tokens: readonly string[]): VoiceClauseAnalysis {
  const spans: Span[] = []
  const push = (start: number, length: number, apply: Span["apply"]) => {
    spans.push({ start, length, apply })
  }
  // كلمات "أول/الأول" موجودة كمرجع first كذلك — المرجع أولى وأوضح دلاليًا
  const referenceWords = new Set(Object.values(VOICE_LEXICON.references).flat())
  for (let index = 0; index < tokens.length; index += 1) {
    for (const verb of Object.keys(VOICE_LEXICON.verbs) as VoiceVerb[]) {
      const match = matchLongestPhrase(tokens, index, VOICE_LEXICON.verbs[verb])
      if (match) {
        push(index, match.length, (analysis) => analysis.verbs.add(verb))
      }
    }
    for (const target of Object.keys(VOICE_LEXICON.targets) as VoiceTarget[]) {
      const match = matchLongestPhrase(tokens, index, VOICE_LEXICON.targets[target])
      if (match) {
        push(index, match.length, (analysis) => analysis.targets.add(target))
      }
    }
    for (const reference of Object.keys(VOICE_LEXICON.references) as VoiceReferenceKind[]) {
      const match = matchLongestPhrase(tokens, index, VOICE_LEXICON.references[reference])
      if (match) {
        push(index, match.length, (analysis) => analysis.references.add(reference))
      }
    }
    // كلمات المظهر بتتجمع قبل صفات النموذج: "light" ممكن تكون مظهر أو صفة
    // سرعة، ولما الكلام مالوش ذكر نموذج المظهر أولى (السياق اللي جوه الجملة).
    for (const [theme, words] of Object.entries(VOICE_LEXICON.themes) as [AppTheme, readonly string[]][]) {
      const match = matchLongestPhrase(tokens, index, words)
      if (match) {
        push(index, match.length, (analysis) => { analysis.theme = theme })
      }
    }
    for (const qualifier of Object.keys(VOICE_LEXICON.modelQualifiers) as VoiceModelQualifier[]) {
      const match = matchLongestPhrase(tokens, index, VOICE_LEXICON.modelQualifiers[qualifier])
      if (match) {
        push(index, match.length, (analysis) => analysis.modelQualifiers.add(qualifier))
      }
    }
    for (const [word, value] of Object.entries(VOICE_LEXICON.ordinals)) {
      if (referenceWords.has(word)) {
        continue
      }
      if (tokens[index] === word) {
        push(index, 1, (analysis) => { analysis.ordinal = value })
      }
    }
    for (const [language, words] of Object.entries(VOICE_LEXICON.languages) as [Language, readonly string[]][]) {
      const match = matchLongestPhrase(tokens, index, words)
      if (match) {
        push(index, match.length, (analysis) => { analysis.language = language })
      }
    }
    for (const [word, variant] of Object.entries(VOICE_LEXICON.variants)) {
      if (tokens[index] === word) {
        push(index, 1, (analysis) => { analysis.variant = variant })
      }
    }
    const soundOnMatch = matchLongestPhrase(tokens, index, VOICE_LEXICON.soundOn)
    if (soundOnMatch) {
      push(index, soundOnMatch.length, (analysis) => { analysis.sound = true })
    }
    const soundOffMatch = matchLongestPhrase(tokens, index, VOICE_LEXICON.soundOff)
    if (soundOffMatch) {
      push(index, soundOffMatch.length, (analysis) => { analysis.sound = false })
    }
    const stopwordMatch = matchLongestPhrase(tokens, index, VOICE_LEXICON.stopwords)
    if (stopwordMatch) {
      push(index, stopwordMatch.length, () => {
        // كلمات حشو/ربط — بتتشال من اسم الكيان بس، مالهاش معنى دلالي
      })
    }
  }
  // الأطول أولًا ثم الأقدم موضعًا — يمنع "شغال" جوه "اللي كنت شغال عليه".
  // المطابقات المتطابقة في الموضع والطول تتجمّع مجموعة واحدة: الكلمة الواحدة
  // ممكن تنتمي لأكتر من دلو (مثال: "switch" فعل فتح وفعل تبديل معًا)، ولازم
  // الاتنين يتسجلوا معًا مش واحد بس.
  spans.sort((a, b) => b.length - a.length || a.start - b.start || 0)
  const groups: Span[][] = []
  for (const span of spans) {
    const lastGroup = groups[groups.length - 1]
    const first = lastGroup?.[0]
    if (first && first.start === span.start && first.length === span.length) {
      lastGroup.push(span)
    } else {
      groups.push([span])
    }
  }
  const covered = new Array<boolean>(tokens.length).fill(false)
  const analysis: MutableClauseAnalysis = {
    verbs: new Set(),
    targets: new Set(),
    references: new Set(),
    modelQualifiers: new Set(),
    ordinal: null,
    theme: null,
    language: null,
    sound: null,
    variant: null,
  }
  for (const group of groups) {
    const primary = group[0]!
    let overlaps = false
    for (let offset = 0; offset < primary.length; offset += 1) {
      if (covered[primary.start + offset]) {
        overlaps = true
        break
      }
    }
    if (overlaps) {
      continue
    }
    for (let offset = 0; offset < primary.length; offset += 1) {
      covered[primary.start + offset] = true
    }
    for (const span of group) {
      span.apply(analysis)
    }
  }
  const leftovers = tokens.filter((_, index) => !covered[index])
  return {
    tokens,
    verbs: analysis.verbs,
    targets: analysis.targets,
    references: analysis.references,
    modelQualifiers: analysis.modelQualifiers,
    ordinal: analysis.ordinal,
    theme: analysis.theme,
    language: analysis.language,
    sound: analysis.sound,
    variant: analysis.variant,
    question: findPhrase(tokens, QUESTION_PHRASES) !== null,
    help: findPhrase(tokens, VOICE_LEXICON.helpPhrases) !== null,
    name: leftovers.join(" "),
  }
}

function positionalReference(analysis: VoiceClauseAnalysis): EntityReference | undefined {
  // المرجع الزمني/الترتيبي أسبق من الاسم: لو الكلام قال "آخر محادثة" يبقى
  // القصد زمني حتى لو فضل اسم غير موسوم من صيغة فعل مش مسجّلة بعد.
  if (analysis.references.has("lastUsed")) {
    return { kind: "last-used" }
  }
  if (analysis.references.has("current")) {
    return { kind: "current" }
  }
  if (analysis.references.has("previous")) {
    return { kind: "previous" }
  }
  if (analysis.references.has("latest")) {
    return { kind: "latest" }
  }
  if (analysis.references.has("first")) {
    return { kind: "first" }
  }
  if (analysis.references.has("oldest")) {
    return { kind: "oldest" }
  }
  if (analysis.ordinal !== null) {
    return { kind: "ordinal", index: analysis.ordinal }
  }
  if (analysis.references.has("pronoun")) {
    return { kind: "pronoun" }
  }
  if (analysis.name) {
    return { kind: "named", text: analysis.name }
  }
  return undefined
}

function hasAnyVerb(analysis: VoiceClauseAnalysis): boolean {
  return analysis.verbs.size > 0
}

// تحويل وسم الفقرة إلى قصد. ترتيب القواعد مقصود: الأخص قبل الأعم، والأوامر
// الخطرة/الغريبة قبل فتح الشاشات بالاسم فقط.
function resolveClause(analysis: VoiceClauseAnalysis): ResolvedVoiceIntent | null {
  const spoken = analysis.tokens.join(" ")
  const intent = (kind: VoiceIntentKind, extra: Partial<ResolvedVoiceIntent> = {}): ResolvedVoiceIntent => ({ kind, spoken, ...extra })

  if (analysis.help) {
    return intent("help")
  }

  // "اقفل المايك" / "وقف الاستماع" — أمر محلي لطبقة الصوت نفسها
  if (analysis.targets.has("voice") && (analysis.verbs.has("stop") || analysis.verbs.has("close") || analysis.verbs.has("mute"))) {
    return intent("stop-listening")
  }

  // تأكيد/رفض خام: كلمات قليلة بلا فعل ولا هدف (السياق المعلّق يحسمها)
  if (!hasAnyVerb(analysis) && analysis.targets.size === 0 && analysis.references.size === 0) {
    if (voiceNegation(analysis.tokens)) {
      return intent("deny")
    }
    if (voiceAffirmation(analysis.tokens)) {
      return intent("affirm")
    }
  }

  if (analysis.verbs.has("back")) {
    return intent("go-back")
  }
  if (analysis.verbs.has("delete")) {
    // مفيش إجراء حذف صوتي مسجّل — نقولها بصراحة بدل ما نخمّن (req 13)
    return intent("unsupported")
  }
  if (analysis.verbs.has("stop") && !analysis.targets.has("sound")) {
    return intent("stop-task")
  }
  // إعدادات بسيطة: مظهر/لغة/صوت
  if (analysis.theme && !analysis.targets.has("project") && !analysis.targets.has("conversation")) {
    return intent("set-theme", { theme: analysis.theme })
  }
  if (analysis.language && !analysis.targets.has("project") && !analysis.targets.has("conversation")) {
    return intent("set-language", { language: analysis.language })
  }
  if (analysis.sound !== null) {
    return intent("set-sound", { sound: analysis.sound })
  }
  if (analysis.targets.has("sound")) {
    if (analysis.verbs.has("unmute") || analysis.verbs.has("push")) {
      return intent("set-sound", { sound: true })
    }
    if (analysis.verbs.has("mute")) {
      return intent("set-sound", { sound: false })
    }
    return null
  }
  // تغييرات Git: التراجع/الـ commit/الـ push/السحب — كلها بتمر من السجل
  // بأمان (تراجع وcommit&push محتاجين تأكيد)
  if (analysis.verbs.has("revert")) {
    return intent("revert-changes")
  }
  if (analysis.verbs.has("commit") || analysis.verbs.has("push")) {
    return intent("commit-push")
  }
  if (analysis.verbs.has("pull")) {
    return intent("pull-changes")
  }

  // أسئلة معلومات: "ايه المشاريع اللي عندي؟"
  if (analysis.question) {
    if (analysis.targets.has("project")) {
      return intent("list-projects")
    }
    if (analysis.targets.has("conversation")) {
      return intent("list-conversations")
    }
    if (analysis.targets.has("models")) {
      return intent("list-models")
    }
    if (analysis.targets.has("running") || analysis.targets.has("requests")) {
      return intent("show-running")
    }
    if (analysis.targets.has("attention")) {
      return intent("open-attention")
    }
    if (analysis.targets.size === 0) {
      return intent("help")
    }
  }

  // تبديل النموذج: اسم نموذج أو صفة (أسرع/أذكى/مجاني) أو مستوى تفكير
  const modelQualifier = [...analysis.modelQualifiers][0]
  const wantsModelSwitch = analysis.targets.has("models") && (modelQualifier !== undefined || analysis.name !== "" || analysis.variant !== null)
  if (wantsModelSwitch) {
    return intent("change-model", {
      model: positionalReference(analysis),
      modelQualifier,
      variant: analysis.variant ?? undefined,
    })
  }
  if (analysis.variant !== null && !analysis.targets.has("models") && !analysis.targets.has("sound") && !analysis.targets.has("theme")) {
    return intent("change-model", { variant: analysis.variant })
  }

  // إجراءات الشاشات حسب الهدف المذكور
  if (analysis.targets.has("project")) {
    if (analysis.targets.has("new")) {
      // إنشاء مشروع ليس من قدرات التطبيق — لا نخترع إجراءً
      return intent("unsupported")
    }
    return intent("open-project", { project: positionalReference(analysis) })
  }
  if (analysis.targets.has("conversation")) {
    if (analysis.targets.has("new")) {
      return intent("new-conversation")
    }
    // "سجل المحادثة" اسم اللوحة نفسها — السجل أولى من فتح المحادثة لما
    // الكلمتين يتواجدوا معًا
    if (analysis.targets.has("history")) {
      return intent("open-history")
    }
    return intent("open-conversation", { conversation: positionalReference(analysis) })
  }
  if (analysis.targets.has("new")) {
    return intent("new-conversation")
  }
  if (analysis.targets.has("running")) {
    return intent("show-running")
  }
  if (analysis.targets.has("requests")) {
    return intent("show-requests", { project: analysis.references.has("current") ? { kind: "current" } : undefined })
  }
  if (analysis.targets.has("attention")) {
    return intent("open-attention")
  }
  if (analysis.targets.has("history")) {
    return intent("open-history")
  }
  if (analysis.targets.has("pinned")) {
    return intent("open-pinned")
  }
  if (analysis.targets.has("git")) {
    return intent("open-git")
  }
  if (analysis.targets.has("settings")) {
    return intent("open-settings")
  }
  if (analysis.targets.has("models")) {
    return intent("open-models")
  }
  if (analysis.targets.has("releases")) {
    return intent("open-releases")
  }

  // اسم بلا نوع ظاهر: "افتح RemoteCode" — النوع الفعلي (مشروع/محادثة/نموذج)
  // يتحدد في planner.ts من سياق التطبيق نفسه، مش من نص الكلام.
  if (analysis.name && (analysis.verbs.has("open") || analysis.verbs.has("go"))) {
    if (analysis.verbs.has("switch") && !analysis.verbs.has("go")) {
      return intent("change-model", { model: { kind: "named", text: analysis.name } })
    }
    return intent("open-named", { name: analysis.name })
  }

  // "افتح التاني" — ترتيب بلا نوع؛ النوع من آخر قائمة عرضها الوكيل. بيتفحص
  // قبل الضمير لأن "افتح التاني" أو "open the second one" فيها الاتنين.
  if (analysis.ordinal !== null) {
    return intent("open-reference", { ordinal: analysis.ordinal, reference: { kind: "ordinal", index: analysis.ordinal } })
  }
  // "افتحه" / "افتحه هو" / "Open the latest one" — مرجع بلا نوع؛ النوع
  // يتحدد من ذاكرة الجلسة، والمرجع (ضمير/أحدث/سابق...) بيفضل محفوظًا
  if (analysis.references.size > 0 && (analysis.verbs.has("open") || analysis.verbs.has("go") || analysis.verbs.has("switch"))) {
    const reference = positionalReference(analysis)
    if (reference) {
      return intent("open-reference", { reference })
    }
    return intent("open-reference")
  }

  // "ارجعني" بلا فعل معروف لكن مع مرجع "اللي كنت فيه" — الرجوع
  if (analysis.references.has("lastUsed") && analysis.verbs.size === 0 && analysis.targets.size === 0) {
    return intent("go-back")
  }
  return null
}

// تحليل النص كامل: تقطيع لفقرات ثم حلّ كل فقرة. الناتج مرتب بترتيب الكلام
// عشان خطة التنفيذ المتعددة الخطوات تحافظ على تسلسل المستخدم.
export function resolveVoiceIntents(transcript: string): ResolvedVoiceIntent[] {
  const clauses = splitVoiceClauses(tokenizeVoiceText(transcript))
  const intents: ResolvedVoiceIntent[] = []
  for (const clause of clauses) {
    const intent = resolveClause(analyzeVoiceClause(clause))
    if (intent) {
      intents.push(intent)
    }
  }
  return intents
}

export function voiceAffirmation(tokens: readonly string[]): boolean {
  return findPhrase(tokens, VOICE_LEXICON.affirmations) !== null
}

export function voiceNegation(tokens: readonly string[]): boolean {
  return findPhrase(tokens, VOICE_LEXICON.negations) !== null
}

// جواب توضيح ممكن يكون ترتيبًا ("التاني"). بنرجّع الرقم أو -1 لـ"الأخير"،
// أو null لو مفيش ترتيب في الكلام.
export function clarificationOrdinal(tokens: readonly string[]): number | null {
  const last = findPhrase(tokens, VOICE_LEXICON.lastOrdinal)
  if (last !== null) {
    return -1
  }
  for (const token of tokens) {
    const value = VOICE_LEXICON.ordinals[token]
    if (value !== undefined) {
      return value
    }
  }
  // "الأول" محجوب من خريطة الترتيب لصالح المرجع first — نلمّه هنا صريحًا
  if (findPhrase(tokens, VOICE_LEXICON.references.first) !== null) {
    return 1
  }
  return null
}

export function normalizeVoiceTranscript(transcript: string): string {
  return normalizeVoiceText(transcript)
}
