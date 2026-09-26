/* eslint-disable react-refresh/only-export-components -- ملف helpers مشترك عمدًا
   بين App واللوحات الكسولة، مع مكوّن SVG صغير واحد (GitBranchIcon) */
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

export function projectName(project: Project): string {
  const normalized = project.worktree.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).filter(Boolean).pop() || project.worktree
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
