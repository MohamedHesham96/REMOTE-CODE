// معجم الأوامر الصوتية: بيانات لغوية بحتة — لا منطق هنا. كل المفردات مكتوبة
// بصيغتها المطبّعة (normalize.ts)، والتجميع بين اللغات يسمح بكلام مخلوط
// («افتح الـ project») كما بيحصل طبيعي في التعرّف الصوتي. إضافة لغة جديدة =
// كائن كلمات جديد بنفس الشكل؛ وإضافة قدرة جديدة = buckets جديدة + قاعدة في
// resolver.ts + إجراء في registry.ts، من غير لمس طبقة الصوت أو الواجهة.
import type { Language } from "../i18n"
import type { AppTheme } from "../theme"

export type VoiceVerb =
  | "open"
  | "go"
  | "back"
  | "switch"
  | "close"
  | "stop"
  | "start"
  | "mute"
  | "unmute"
  | "delete"
  | "revert"
  | "commit"
  | "push"
  | "pull"

export type VoiceTarget =
  | "project"
  | "conversation"
  | "requests"
  | "running"
  | "settings"
  | "models"
  | "history"
  | "releases"
  | "pinned"
  | "attention"
  | "git"
  | "theme"
  | "language"
  | "sound"
  | "new"
  | "voice"

export type VoiceReferenceKind = "current" | "latest" | "previous" | "first" | "oldest" | "lastUsed" | "pronoun"

export type VoiceModelQualifier = "faster" | "smarter" | "free" | "cheap"

interface LanguageWords {
  verbs: Partial<Record<VoiceVerb, readonly string[]>>
  targets: Partial<Record<VoiceTarget, readonly string[]>>
  references: Partial<Record<VoiceReferenceKind, readonly string[]>>
  ordinals: Record<string, number>
  lastOrdinal: readonly string[]
  modelQualifiers: Partial<Record<VoiceModelQualifier, readonly string[]>>
  themes: Partial<Record<AppTheme, readonly string[]>>
  languages: Partial<Record<Language, readonly string[]>>
  soundOn: readonly string[]
  soundOff: readonly string[]
  affirmations: readonly string[]
  negations: readonly string[]
  helpPhrases: readonly string[]
  questionPhrases: readonly string[]
  variants: Record<string, string>
  stopwords: readonly string[]
}

const ARABIC_WORDS: LanguageWords = {
  verbs: {
    open: ["افتح", "افتحلي", "افتحه", "افتحها", "تفتح", "تفتحلي", "تفتحه", "تفتحها", "فتح", "اعرض", "اعرضلي", "اعرضه", "اعرضها", "تعرض", "تعرضلي", "عرض", "عرضلي", "وريني", "ورني", "وريه", "توريني", "شوف", "شوفلي", "اشوف", "اشوفهم", "هات", "هاتلي", "جيب", "جيبلي", "تجيبلي", "بين", "بينلي", "اظهر"],
    go: ["روح", "روحلي", "اروح", "خدني", "ووديني", "وديني", "انقلني", "انتقل", "اذهب"],
    back: ["ارجع", "رجوع", "ورا", "للخلف", "للفات", "رجعني"],
    switch: ["بدل", "بدلي", "غير", "غيرلي", "حول"],
    close: ["اقفل", "اغلق", "سكر"],
    stop: ["اوقف", "وقف", "اقف", "الغ", "الغي", "كفايه"],
    start: ["ابدا"],
    mute: ["اكتم", "كتم", "اسكت"],
    unmute: ["فعل", "شغل"],
    delete: ["احذف", "امسح"],
    revert: ["تراجع", "استرجع"],
    commit: ["commit", "كوميت"],
    push: ["push", "بوش", "ارفع"],
    pull: ["pull", "اسحب"],
  },
  targets: {
    project: ["مشروع", "المشروع", "مشاريع", "المشاريع", "بروجكت", "بيت المشروع"],
    conversation: ["محادثه", "المحادثه", "محادثات", "المحادثات", "شات", "الشات", "جلسه", "الجلسه"],
    requests: ["طلب", "الطلب", "طلبات", "الطلبات", "مهمه", "المهمه", "مهام", "المهام"],
    running: ["شغال", "الشغال", "يشتغل", "يعمل", "بشتغل", "شغاله", "نشط", "النشطه", "نشطه", "جاري", "الجاري", "بيشتغل", "مشتغل"],
    settings: ["اعدادات", "الاعدادات"],
    models: ["نموذج", "النموذج", "نماذج", "النماذج", "موديل", "الموديل", "موديلات"],
    history: ["سجل", "السجل", "تاريخ", "التاريخ"],
    releases: ["اصدار", "الاصدار", "اصدارات", "الاصدارات", "ملاحظات الاصدار", "التحديثات"],
    pinned: ["مثبته", "المثبته", "مثبتات", "المثبتات"],
    attention: ["انتباه", "الانتباه", "تنبيهات", "التنبيهات", "اسيله", "الاسيله", "سوال", "السوال", "اذونات", "الاذونات", "صلاحيات", "الصلاحيات"],
    git: ["جيت", "تغييرات", "التغييرات", "تعديلات", "التعديلات"],
    theme: ["مظهر", "المظهر", "ثيم", "الثيم", "الوان"],
    language: ["لغه", "اللغه", "لغات", "اللغات"],
    sound: ["صوت", "الصوت", "نغمه", "النغمه"],
    new: ["جديد", "جديده", "الجديده"],
    voice: ["مايك", "المايك", "ميكروفون", "الميكروفون", "الاستماع", "التسجيل"],
  },
  references: {
    current: ["الحالي", "الحاليه", "المفتوح", "المفتوحه", "اللي انا فيه", "اللي احنا فيه", "اللي انا فاتحه", "دلوقتي"],
    latest: ["اخر", "اخير", "الاخير", "اخيره", "الاخيره", "احدث", "الاحدث", "جديد", "الجديد"],
    previous: ["السابق", "السابقه", "اللي قبله", "اللي قبلها", "قبله", "قبلها", "اللي فات", "الفات"],
    first: ["الاول", "اول", "الاولي"],
    oldest: ["الاقدم", "اقدم"],
    lastUsed: ["اللي كنت شغال عليه", "اللي كنت شغال عليها", "اللي كنت بعمل عليه", "اللي كنت بعمل عليها", "اللي كنت فيها", "اللي كنت فيه", "اللي كنا بنعمل عليه", "اللي كنا شغالين عليه", "اللي كنت فاتحه", "كنت شغال عليه", "كنت شغال عليها", "كنت بعمل عليه", "كنت بعمل عليها"],
    pronoun: ["هو", "هي", "ده", "دي", "دا", "هذا", "هذه", "ذلك", "تلك", "بتاعه", "بتاعها", "افتحه", "افتحها", "اعرضه", "اعرضها", "وريه"],
  },
  ordinals: {
    "الاول": 1, "اول": 1, "الاولي": 1,
    "التاني": 2, "تاني": 2, "الثاني": 2, "ثاني": 2, "التانيه": 2, "تانيه": 2,
    "التالت": 3, "تالت": 3, "الثالث": 3, "ثالث": 3, "التالته": 3, "تالته": 3, "الثالثه": 3,
    "الرابع": 4, "رابع": 4, "الرابعه": 4, "رابعه": 4,
    "الخامس": 5, "خامس": 5, "الخامسه": 5, "خامسه": 5,
    "السادس": 6, "سادس": 6, "السادسه": 6, "سادسه": 6,
    "السابع": 7, "سابع": 7, "السابعه": 7, "سابعه": 7,
    "الثامن": 8, "ثامن": 8, "الثامنه": 8, "تامنه": 8,
    "التاسع": 9, "تاسع": 9, "التاسعه": 9, "تاسعه": 9,
    "العاشر": 10, "عاشر": 10, "العاشره": 10, "عاشره": 10,
  },
  lastOrdinal: ["الاخير", "الاخيره", "اخر", "اخير"],
  modelQualifiers: {
    faster: ["اسرع", "سريع", "السريع", "الاسرع", "لاسرع", "خفيف", "الخفيف", "صغير", "الصغير"],
    smarter: ["اذكي", "الاذكي", "لاذكي", "اقوي", "الاقوي", "لاقوي", "افضل", "الافضل", "لافضل", "ادق", "الادق"],
    free: ["مجاني", "مجانا", "المجاني", "مجانيه"],
    cheap: ["ارخص", "الارخص", "لارخص", "رخيص", "الرخيص"],
  },
  themes: {
    glass: ["فاتح", "نهاري", "الفاتح", "النهاري"],
    dark: ["داكن", "غامق", "ليلي", "الداكن", "الغامق"],
    hacker: ["هاكر", "مصفوفه", "الهاكر"],
    metal: ["معدني", "المعدني", "فولاذي"],
  },
  languages: {
    ar: ["عربي", "العربيه", "بالعربي", "للعربي"],
    en: ["انجليزي", "الانجليزي", "بالانجليزي", "للانجليزي", "english"],
  },
  soundOn: ["شغل الصوت", "فعل الصوت", "الصوت شغال", "رجع الصوت"],
  soundOff: ["اكتم الصوت", "اقفل الصوت", "من غير صوت", "اسكت الصوت"],
  affirmations: ["نعم", "ايوه", "تمام", "اكد", "اكيد", "موافق", "كمل", "نفذ", "يلا", "ماشي", "اوك", "اوكي", "صح", "بالتاكيد"],
  negations: ["لا", "الغاء", "الغي", "الغ", "توقف", "بلاش", "متكملش", "متعملش", "مش دلوقتي", "خلاص لا", "ابطل"],
  helpPhrases: ["مساعده", "ساعدني", "الاوامر", "الاوامر الصوتيه", "ممكن تعمل ايه", "تقدر تعمل ايه", "ايه اللي تقدر تعمله", "ايه الامكانيات"],
  questionPhrases: ["ايه", "اي", "مين", "كام", "فين", "عندي ايه", "ايه اللي"],
  variants: { "اقصي": "max", "عالي": "high", "مرتفع": "high", "متوسط": "medium", "منخفض": "low", "ادني": "minimal" },
  stopwords: ["من", "فضلك", "ممكن", "لو", "سمحت", "يا", "لي", "ليا", "بتاع", "بتاعه", "بتاعت", "بتاعتي", "علي", "في", "عن", "بس", "كده", "حاليا"],
}

const ENGLISH_WORDS: LanguageWords = {
  verbs: {
    open: ["open", "show", "display", "bring", "view", "see", "look", "take", "go", "navigate", "jump", "switch"],
    go: ["go", "navigate", "jump", "move"],
    back: ["back", "return"],
    switch: ["switch", "change", "swap", "turn"],
    close: ["close", "dismiss", "hide"],
    stop: ["stop", "halt", "abort", "cancel"],
    start: ["start", "begin", "launch", "create"],
    mute: ["mute", "silence"],
    unmute: ["unmute", "enable"],
    delete: ["delete", "remove", "erase"],
    revert: ["revert", "rollback", "undo"],
    commit: ["commit"],
    push: ["push"],
    pull: ["pull"],
  },
  targets: {
    project: ["project", "projects", "repo", "repository", "workspace"],
    conversation: ["conversation", "conversations", "chat", "chats", "session", "sessions"],
    requests: ["request", "requests", "task", "tasks"],
    running: ["running", "active", "busy", "working", "now"],
    settings: ["settings", "setting", "preferences", "prefs", "config"],
    models: ["model", "models"],
    history: ["history", "log", "logs", "past"],
    releases: ["release", "releases", "changelog", "notes", "updates"],
    pinned: ["pinned"],
    attention: ["attention", "questions", "question", "permissions", "permission", "alerts"],
    git: ["git", "changes", "diff"],
    theme: ["theme", "themes", "colors"],
    language: ["language", "languages"],
    sound: ["sound", "audio", "volume"],
    new: ["new"],
    voice: ["voice", "mic", "microphone", "listening"],
  },
  references: {
    current: ["current"],
    latest: ["latest", "last", "newest", "recent", "most"],
    previous: ["previous", "prev", "earlier", "before"],
    first: ["first", "1st"],
    oldest: ["oldest", "earliest"],
    lastUsed: ["the one i was working on", "the one we were working on", "the one i was just working on", "the one i had open", "the one i m working on", "i was working on", "we were working on", "i ve been working on", "we ve been working on"],
    pronoun: ["it", "that", "this", "one"],
  },
  ordinals: {
    "first": 1, "1st": 1,
    "second": 2, "2nd": 2,
    "third": 3, "3rd": 3,
    "fourth": 4, "4th": 4,
    "fifth": 5, "5th": 5,
    "sixth": 6, "6th": 6,
    "seventh": 7, "7th": 7,
    "eighth": 8, "8th": 8,
    "ninth": 9, "9th": 9,
    "tenth": 10, "10th": 10,
  },
  lastOrdinal: ["last", "latest"],
  modelQualifiers: {
    faster: ["faster", "fast", "quick", "quickest", "light", "lightweight", "small", "mini"],
    smarter: ["smarter", "smart", "best", "strongest", "powerful", "accurate"],
    free: ["free"],
    cheap: ["cheaper", "cheap", "cost"],
  },
  themes: {
    glass: ["light", "day"],
    dark: ["dark", "night"],
    hacker: ["hacker", "matrix"],
    metal: ["metal", "steel"],
  },
  languages: {
    ar: ["arabic"],
    en: ["english"],
  },
  soundOn: ["sound on", "turn on sound", "enable sound"],
  soundOff: ["sound off", "mute sound", "turn off sound", "silence"],
  affirmations: ["yes", "yeah", "yep", "ok", "okay", "sure", "confirm", "proceed", "approve", "affirmative", "do it", "go ahead", "continue", "keep going"],
  negations: ["no", "nope", "cancel", "stop", "abort", "never mind", "nevermind"],
  helpPhrases: ["help", "commands", "what can you do", "what can i say", "what can you say"],
  questionPhrases: ["which", "what", "list", "how many"],
  variants: { "max": "max", "maximum": "max", "high": "high", "higher": "high", "medium": "medium", "low": "low", "minimal": "minimal" },
  stopwords: ["the", "a", "an", "to", "me", "my", "please", "just", "for", "of", "now", "at", "in", "on"],
}

function mergeWordLists<K extends string>(left: Partial<Record<K, readonly string[]>>, right: Partial<Record<K, readonly string[]>>): Record<K, readonly string[]> {
  const merged = {} as Record<K, string[]>
  for (const source of [left, right]) {
    for (const [key, values] of Object.entries(source) as [K, readonly string[]][]) {
      const bucket = merged[key] ?? (merged[key] = [])
      for (const value of values) {
        // المستعار اللغوي بيتكرر بين اللغتين (pull/commit...) — منع التكرار
        // هنا بيغطّي أي لغة جديدة من غير ما نلاحظ القوائم يدويًا
        if (!bucket.includes(value)) {
          bucket.push(value)
        }
      }
    }
  }
  return merged
}

export interface VoiceLexicon {
  verbs: Record<VoiceVerb, readonly string[]>
  targets: Record<VoiceTarget, readonly string[]>
  references: Record<VoiceReferenceKind, readonly string[]>
  ordinals: Record<string, number>
  lastOrdinal: readonly string[]
  modelQualifiers: Record<VoiceModelQualifier, readonly string[]>
  themes: Record<AppTheme, readonly string[]>
  languages: Record<Language, readonly string[]>
  soundOn: readonly string[]
  soundOff: readonly string[]
  affirmations: readonly string[]
  negations: readonly string[]
  helpPhrases: readonly string[]
  questionPhrases: readonly string[]
  variants: Record<string, string>
  stopwords: readonly string[]
}

// دمچ العربية والإنجليزية معًا: المتحدّث قد يخلط اللغتين في جملة واحدة،
// والقرار النهائي على القصد يجي من resolver.ts مش من لغة الكلمة الواحدة.
export const VOICE_LEXICON: VoiceLexicon = {
  verbs: mergeWordLists(ARABIC_WORDS.verbs, ENGLISH_WORDS.verbs),
  targets: mergeWordLists(ARABIC_WORDS.targets, ENGLISH_WORDS.targets),
  references: mergeWordLists(ARABIC_WORDS.references, ENGLISH_WORDS.references),
  ordinals: { ...ARABIC_WORDS.ordinals, ...ENGLISH_WORDS.ordinals },
  lastOrdinal: [...ARABIC_WORDS.lastOrdinal, ...ENGLISH_WORDS.lastOrdinal],
  modelQualifiers: mergeWordLists(ARABIC_WORDS.modelQualifiers, ENGLISH_WORDS.modelQualifiers),
  themes: mergeWordLists(ARABIC_WORDS.themes, ENGLISH_WORDS.themes),
  languages: mergeWordLists(ARABIC_WORDS.languages, ENGLISH_WORDS.languages),
  soundOn: [...ARABIC_WORDS.soundOn, ...ENGLISH_WORDS.soundOn],
  soundOff: [...ARABIC_WORDS.soundOff, ...ENGLISH_WORDS.soundOff],
  affirmations: [...ARABIC_WORDS.affirmations, ...ENGLISH_WORDS.affirmations],
  negations: [...ARABIC_WORDS.negations, ...ENGLISH_WORDS.negations],
  helpPhrases: [...ARABIC_WORDS.helpPhrases, ...ENGLISH_WORDS.helpPhrases],
  questionPhrases: [...ARABIC_WORDS.questionPhrases, ...ENGLISH_WORDS.questionPhrases],
  variants: { ...ARABIC_WORDS.variants, ...ENGLISH_WORDS.variants },
  stopwords: [...ARABIC_WORDS.stopwords, ...ENGLISH_WORDS.stopwords],
}

// كل العبارات في كل القوائم — للاختبار اللي يتأكد إن البيانات مكتوبة
// بصيغتها المطبّعة أصلًا (أي عبارة غير مطبّعة = خطأ بيانات مش خطأ منطق).
export function collectLexiconPhrases(): string[] {
  const phrases: string[] = []
  for (const bucket of Object.values(VOICE_LEXICON.verbs)) {
    phrases.push(...bucket)
  }
  for (const bucket of Object.values(VOICE_LEXICON.targets)) {
    phrases.push(...bucket)
  }
  for (const bucket of Object.values(VOICE_LEXICON.references)) {
    phrases.push(...bucket)
  }
  for (const bucket of Object.values(VOICE_LEXICON.modelQualifiers)) {
    phrases.push(...bucket)
  }
  for (const bucket of Object.values(VOICE_LEXICON.themes)) {
    phrases.push(...bucket)
  }
  for (const bucket of Object.values(VOICE_LEXICON.languages)) {
    phrases.push(...bucket)
  }
  phrases.push(...Object.keys(VOICE_LEXICON.ordinals))
  phrases.push(...VOICE_LEXICON.lastOrdinal)
  phrases.push(...VOICE_LEXICON.soundOn, ...VOICE_LEXICON.soundOff)
  phrases.push(...VOICE_LEXICON.affirmations, ...VOICE_LEXICON.negations)
  phrases.push(...VOICE_LEXICON.helpPhrases, ...VOICE_LEXICON.stopwords)
  phrases.push(...VOICE_LEXICON.questionPhrases)
  phrases.push(...Object.keys(VOICE_LEXICON.variants))
  return phrases
}

export interface PhraseMatch {
  phrase: string
  length: number
}

// أطول عبارة تبدأ عند الفهرس ده — المطابقة على حدود كلمات كاملة (مفيش
// includes حرفي) عشان «ما» ما تتطابقش جوه «ماشي».
export function matchLongestPhrase(tokens: readonly string[], index: number, phrases: readonly string[]): PhraseMatch | null {
  let best: PhraseMatch | null = null
  for (const phrase of phrases) {
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
    if (matched && (!best || parts.length > best.length)) {
      best = { phrase, length: parts.length }
    }
  }
  return best
}

// أول تطابق لأي عبارة في القائمة من أي موضع — للكشف العام (تأكيد/إلغاء/مساعدة).
export function findPhrase(tokens: readonly string[], phrases: readonly string[]): PhraseMatch | null {
  let best: PhraseMatch | null = null
  for (let index = 0; index < tokens.length; index += 1) {
    const match = matchLongestPhrase(tokens, index, phrases)
    if (match && (!best || match.length > best.length)) {
      best = match
    }
  }
  return best
}
