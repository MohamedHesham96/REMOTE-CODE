/* eslint-disable react-refresh/only-export-components -- ملف helpers مشترك عمدًا
   بين App واللوحات الكسولة، مع الأيقونات SVG (GitBranchIcon, LogoutIcon,
   SoundOnIcon, SoundMuteIcon, SettingsIcon) */
import { localeOf, type Language, type Strings } from "./i18n"
import type { GitChangeFile, GitChangeStatus, ModelInfo, Project, SessionModelRef, SessionStatus } from "./types"

// كاش فورماترز Intl: إنشاؤها غالٍ وكان بيحصل مع كل صف في كل render.
// المشاركة هنا توفّر التكلفة من غير ما تغيّر الإخراج إطلاقًا.
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(lang: Language, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${localeOf(lang)}|${JSON.stringify(options)}`
  const cached = formatterCache.get(key)
  if (cached) {
    return cached
  }
  const created = new Intl.DateTimeFormat(localeOf(lang), options)
  formatterCache.set(key, created)
  return created
}

export function formatTime(value: number | undefined, lang: Language): string {
  if (!value) {
    return ""
  }
  return formatter(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

export function formatDate(value: number, lang: Language): string {
  return formatter(lang, { day: "numeric", month: "short" }).format(new Date(value))
}

export function formatDateTime(value: number | undefined, lang: Language): string {
  if (!value) {
    return ""
  }
  return formatter(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function formatElapsed(since: number | undefined, t: Strings, now: number = Date.now()): string {
  if (!since) {
    return ""
  }
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) {
    return `${seconds} ${t.secondsShort}`
  }
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes} ${t.minutesShort} ${rest} ${t.secondsShort}` : `${minutes} ${t.minutesShort}`
}

// اسم المشروع من مساره: آخر جزء بعد الشرطة — نفس اللي بتعمله الفيشة
// في server/opencode.ts للمشاريع اللي مالهاش اسم من OpenCode
export function projectNameFromPath(worktree: string): string {
  const normalized = worktree.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).filter(Boolean).pop() || worktree
}

export function projectName(project: Project): string {
  return projectNameFromPath(project.worktree)
}

export function samePath(left: string | undefined | null, right: string | undefined | null): boolean {
  if (!left || !right) {
    return false
  }
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
  return normalize(left) === normalize(right)
}

export function statusLabel(status: SessionStatus | undefined, t: Strings): string {
  if (!status) {
    return t.statusReady
  }
  if (status.type === "busy") {
    return t.statusBusy
  }
  if (status.type === "retry") {
    return t.statusRetry
  }
  return t.statusReady
}

export function displayTitle(title: string | undefined | null, t: Strings): string {
  const clean = (title || "").replace(/\s*\(mobile\)\s*$/i, "").trim()
  return clean || t.newConversation
}

export function modelLabel(ref: SessionModelRef | null | undefined, t: Strings): string {
  if (!ref) {
    return t.defaultModel
  }
  const base = `${ref.providerID}/${ref.modelID}`
  return ref.variant ? `${base} · ${ref.variant}` : base
}

export function shortModelName(model: ModelInfo): string {
  return model.name && model.name !== model.id ? model.name : model.id
}

// خيارات الـ variety بتجيبها من السيرفر مباشرة — كل موديل ليه مستويات مختلفة
export function getVarietyLevels(model: ModelInfo): string[] {
  return model.variants || []
}

// ترتيب العرض: low قبل high قبل max — أي اسم تاني في مكانه
export const VARIANT_ORDER = ["minimal", "none", "low", "medium", "high", "xhigh", "max"]

export function variantLabel(variant: string, t: Strings): string {
  switch (variant) {
    case "max":
      return t.varietyMax
    case "high":
      return t.varietyHigh
    case "medium":
      return t.varietyMedium
    case "low":
      return t.varietyLow
    case "minimal":
      return t.varietyMinimal
    default:
      return variant
  }
}

export const EMPTY_GIT_FILES: GitChangeFile[] = []

export function splitChangePath(path: string): { name: string; dir: string } {
  const index = path.lastIndexOf("/")
  if (index < 0) {
    return { name: path, dir: "" }
  }
  return { name: path.slice(index + 1), dir: path.slice(0, index) }
}

export function gitStatusMeta(status: GitChangeStatus, t: Strings): { label: string; glyph: string; className: string } {
  if (status === "added") {
    return { label: t.gitChangesAdded, glyph: "＋", className: "git-status-added" }
  }
  if (status === "deleted") {
    return { label: t.gitChangesDeleted, glyph: "－", className: "git-status-deleted" }
  }
  return { label: t.gitChangesModified, glyph: "✎", className: "git-status-modified" }
}

export function GitBranchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <path d="M6 7.2v9.6" />
      <path d="M18 11.2c0 3.4-2.3 4.6-5.2 5.2" />
    </svg>
  )
}

// أيقونة الطاقة بدل "↪" كحرف: الرسم ثابت في الاتجاهين، يعني بتقرأ صح
// في العربي (RTL) والإنجليزي (LTR) من غير قلب ولا CSS إضافي.
export function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </svg>
  )
}

// سماعة + موجتين: حالة "الصوت شغّال".
export function SoundOnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h3l5-4v14l-5-4H3z" />
      <path d="M15 9.5a4 4 0 0 1 0 5" />
      <path d="M18.5 7a8 8 0 0 1 0 10" />
    </svg>
  )
}

// نفس السماعة لكن علامة ✕ بدل الموجتين: حالة "مكتوم" — الفرق بين الشكلين
// واضح من غير لون، فحتى الأعمى للوضع يميّزهم من الشكل.
export function SoundMuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h3l5-4v14l-5-4H3z" />
      <path d="m16 9.5 5 5" />
      <path d="m21 9.5-5 5" />
    </svg>
  )
}

// الترس كـ SVG بدل حرف "⚙": الحرف كان بيتلوّن إيموجي على بعض الأنظمة
// فبيتجاهل لون .icon-settings البنفسجي، وكان أخف من باقي أيقونات الهيدر.
export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
