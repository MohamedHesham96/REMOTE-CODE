import { DEFAULT_MODEL_KEY, LAST_SESSION_KEY, PINNED_SESSIONS_KEY, PINNED_SESSIONS_LIMIT, RECENT_PROJECTS_KEY } from "../constants"
import type { PinnedConversation, Session, SessionModelRef, SessionRequest } from "../types"
import { normalizeProjectPath } from "./paths"

export function sortSessionsByCreated(list: Session[]): Session[] {
  const sorted = [...list].sort((a, b) => (b.time.created - a.time.created) || (b.time.updated - a.time.updated))
  // نفس المحادثة مستحيل تظهر مرتين في القائمة الجانبية: إرسال مزدوج سريع
  // أو ردّ متأخر من السيرفر قد يزرع نفس الـ id مرتين، فتبان "محادثتان نشطتان"
  // وهي واحدة. نحتفظ بالأحدث ونرمي التكرار.
  const seen = new Set<string>()
  return sorted.filter((session) => {
    if (seen.has(session.id)) {
      return false
    }
    seen.add(session.id)
    return true
  })
}

export function sessionMatches(sessions: Session[], id: string | null): Session | undefined {
  return id ? sessions.find((session) => session.id === id) : undefined
}

export function isRequestsEmpty(candidate: SessionRequest[] | null): boolean {
  return !candidate || candidate.length === 0
}

export function loadLastSessions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const result: Record<string, string> = {}
    for (const [worktree, sessionId] of Object.entries(parsed)) {
      if (typeof sessionId === "string" && sessionId) {
        result[normalizeProjectPath(worktree)] = sessionId
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveLastSession(worktree: string, sessionId: string): void {
  const key = normalizeProjectPath(worktree)
  try {
    const all = loadLastSessions()
    if (all[key] === sessionId) {
      return
    }
    all[key] = sessionId
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

export function forgetLastSession(worktree: string): void {
  const key = normalizeProjectPath(worktree)
  try {
    const all = loadLastSessions()
    if (all[key] === undefined) {
      return
    }
    delete all[key]
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

// ── الموديل الافتراضي لكل مشروع ──
// أول ما المستخدم يغيّر الموديل أو مستوى التفكير، الاختيار ده بيتخفظ هنا ويبقى
// الافتراضي لكل محادثة جديدة في نفس المشروع (مفتاح المشروع هو المسار المطبّع،
// زي lastSession بالظبط). المحادثات القديمة بتفضل على موديل opencode بتاعها.
//
// القيم جاية من localStorage فممكن تكون تالفة أو متعدّلة من الـ devtools، فبننضّفها
// قبل الاستخدام: provider/model لازم يتكتبوا، والـ variant الفاضي بيتشال.

const MODEL_PROVIDER_MAX = 100
const MODEL_ID_MAX = 200
const MODEL_VARIANT_MAX = 100

export function normalizeModelRef(value: unknown): SessionModelRef | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const candidate = value as Partial<SessionModelRef>
  const text = (input: unknown, max: number) => (typeof input === "string" ? input.trim().slice(0, max) : "")
  const providerID = text(candidate.providerID, MODEL_PROVIDER_MAX)
  const modelID = text(candidate.modelID, MODEL_ID_MAX)
  if (!providerID || !modelID) {
    return null
  }
  const variant = text(candidate.variant, MODEL_VARIANT_MAX)
  return { providerID, modelID, ...(variant ? { variant } : {}) }
}

export function loadDefaultModels(): Record<string, SessionModelRef> {
  try {
    const raw = localStorage.getItem(DEFAULT_MODEL_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const result: Record<string, SessionModelRef> = {}
    for (const [worktree, value] of Object.entries(parsed)) {
      const ref = normalizeModelRef(value)
      if (ref) {
        result[normalizeProjectPath(worktree)] = ref
      }
    }
    return result
  } catch {
    return {}
  }
}

export function loadDefaultModel(worktree: string): SessionModelRef | null {
  return loadDefaultModels()[normalizeProjectPath(worktree)] ?? null
}

export function saveDefaultModel(worktree: string, model: SessionModelRef): void {
  const key = normalizeProjectPath(worktree)
  const ref = normalizeModelRef(model)
  if (!key || !ref) {
    return
  }
  try {
    const all = loadDefaultModels()
    const current = all[key]
    if (current && current.providerID === ref.providerID && current.modelID === ref.modelID && (current.variant || "") === (ref.variant || "")) {
      return
    }
    all[key] = ref
    localStorage.setItem(DEFAULT_MODEL_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

export function loadRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

// ── المثبّتات ──
const EMPTY_PINS: PinnedConversation[] = []

// المصدر الحقيقي على السيرفر (يتشارك بين كل الأجهزة وبيفضل بعد الـ refresh)؛
// الـ localStorage هنا كاش للعرض الأول بس. النسخة القديمة كانت array من ids
// مجرّدة، والبعدي entries كاملة — التطبيع بيزرع الـ format القديم تلقائيًا.
//
// كل مثبّتة متربوطة بمشروعها بمعرّف ثابت (المسار المطبّع) مش بالـ id: ده اللي
// بيخلّي كل مشروع بيشوف مثبّتاته هو بس، والعميل مش بيقدر ينسب محادثة لمشروع
// تاني (والسيرفر بيتحسب الـ projectKey نفسه من المسارات).

// نفس قاعدة server/pins.ts pinProjectKey — لازم يتطابقوا حرفيًا
export function pinProjectKey(worktree: string, directory: string): string {
  return normalizeProjectPath(worktree) || normalizeProjectPath(directory)
}

// التثبيت بيتم من صف المحادثة في مشروع مفتوح، فالمشروع الحالي هو صاحب
// القرار: نحوّل أي مسارات جاية في البيانات لمسار المشروع الفعلي. كده مستحيل
// مثبّتة تطلع في لوحة مشروع تاني بالغلط.
export function stampPinnedProject(
  pin: PinnedConversation,
  worktree: string,
  projectName: string,
): PinnedConversation {
  const target = worktree || pin.worktree || pin.directory
  const key = normalizeProjectPath(target)
  const session = normalizeProjectPath(pin.directory)
  // مجلد الجلسة بيتقبل بس لو جوه المشروع فعلًا — غير كده بنخليه المشروع
  // نفسه، عشان بيانات المثبّتة ماتبقاش متضاربة (محادثة مشروع تاني منسوبة لده)
  const inside = Boolean(session) && (session === key || session.startsWith(`${key}/`))
  const directory = inside ? pin.directory : target
  return {
    ...pin,
    directory,
    worktree: target,
    projectKey: key,
    projectName: projectName || pin.projectName,
  }
}

// مثبّتة بتاعة المشروع ده؟ المشروع الفاضي/المجهول = لا شيء — أحسن ما نعرضش
// محادثات مشروع تاني بالغلط.
export function pinBelongsToProject(pin: PinnedConversation, worktree: string | null): boolean {
  const key = worktree ? normalizeProjectPath(worktree) : ""
  return Boolean(key) && pin.projectKey === key
}

// مثبّتات مشروع واحد بس، بنفس ترتيب "الأحدث تثبيتًا أولًا". نفس المرجع لو
// مفيش تغيير (React يعمل bail-out بدل رندر على كل تعديل في مشروع تاني).
export function pinsForProject(pins: PinnedConversation[], worktree: string | null): PinnedConversation[] {
  if (!worktree) {
    return EMPTY_PINS
  }
  const next = pins.filter((pin) => pinBelongsToProject(pin, worktree))
  return next.length === pins.length ? pins : next
}

export function loadPinnedConversations(): PinnedConversation[] {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (!raw) {
      return []
    }
    return normalizePinnedConversations(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

export function savePinnedConversations(pins: PinnedConversation[]): void {
  const next = normalizePinnedConversations(pins)
  try {
    // ما نكتبش نفس القيمة: التقاط غير ضروري في كل render
    const current = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (current === JSON.stringify(next)) {
      return
    }
    localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

// هل النسخة المحفوظة بالشكل القديم (array من ids مجرّدة)؟ بنستخدمها مرة واحدة
// عشان نعرف إننا لازم نرفعها للسيرفر — بعد أول مزامنة بتتخزّن بالشكل الجديد.
export function hasLegacyPinnedFormat(): boolean {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_KEY)
    if (!raw) {
      return false
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) && parsed.some((item) => typeof item === "string")
  } catch {
    return false
  }
}

function pinnedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

// بتتحمل بيانات قديمة/تالفة أو تعديل يدوي من الـ devtools، وبتعيد ترتيب
// "الأحدث تثبيتًا الأول" مع شيل المكرر والسفلي الفاضي، وبتحسب معرّف المشروع
// من المسارات (الكاش القديم مالوش projectKey).
export function normalizePinnedConversations(values: unknown): PinnedConversation[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set<string>()
  const result: PinnedConversation[] = []
  for (const value of values) {
    // الشكل القديم: string مجرد — من غير بيانات العرض، بنحتفظ بالـ id بس
    const legacyId = typeof value === "string" ? value : ""
    const candidate = (typeof value === "object" && value !== null ? value : {}) as Partial<PinnedConversation>
    const id = pinnedText(candidate.id, 200) || legacyId.trim()
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    const created = typeof candidate.created === "number" && Number.isFinite(candidate.created)
      ? Math.trunc(candidate.created)
      : 0
    const directory = pinnedText(candidate.directory, 1024)
    const worktree = pinnedText(candidate.worktree, 1024)
    result.push({
      id,
      title: pinnedText(candidate.title, 200),
      created,
      directory,
      worktree,
      // بيتحسب من المسارات نفسها مش من الكاش — كده كاش باين أو متعدّل
      // ما يقدرش ينسب محادثة لمشروع تاني
      projectKey: pinProjectKey(worktree, directory),
      projectName: pinnedText(candidate.projectName, 200),
    })
    if (result.length >= PINNED_SESSIONS_LIMIT) {
      break
    }
  }
  return result
}

// كل انتقال بيرجّع نفس المرجع لو مفيش تغيير — عشان React ما يعيدش الرندر
// لما المحادثة مثبّتة بالفعل أو مش مثبّتة أصلًا
export function pinConversation(pins: PinnedConversation[], pin: PinnedConversation): PinnedConversation[] {
  if (!pin.id) {
    return pins
  }
  return normalizePinnedConversations([pin, ...pins.filter((item) => item.id !== pin.id)])
}

export function unpinConversation(pins: PinnedConversation[], sessionId: string): PinnedConversation[] {
  if (!pins.some((pin) => pin.id === sessionId)) {
    return pins
  }
  return pins.filter((pin) => pin.id !== sessionId)
}

// ينضّف المحادثات اللي اتمسحت من التثبيت (مسح يدوي أو مسودة فاضية اتشالت)
export function forgetPinnedConversations(pins: PinnedConversation[], removedIds: string[]): PinnedConversation[] {
  if (removedIds.length === 0) {
    return pins
  }
  const removed = new Set(removedIds)
  const next = pins.filter((pin) => !removed.has(pin.id))
  return next.length === pins.length ? pins : next
}
