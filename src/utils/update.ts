import type { UpdateInfo } from "../types"

// كاش عرض فحص التحديث على الجهاز: فحص واحد كل فترة سماح حتى مع إعادة تحميل
// الصفحة، فمافيش طلب شبكة مع كل فتح ولا تكرار للتنبيه.
export const UPDATE_CACHE_KEY = "opencode.updateCheck"
// رفض المستخدم للتنبيه: يُحفظ مع النسخة وتاريخ الانتهاء — نسخة أحدث منه
// تظهر من جديد حتى لو رفض القديمة، والرفض نفسه ينتهي بعد أسبوع.
export const UPDATE_DISMISS_KEY = "opencode.updateDismissed"
export const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000
export const UPDATE_DISMISS_MS = 7 * 24 * 60 * 60 * 1000

export interface CachedUpdate {
  checkedAt: number
  info: UpdateInfo
}

export interface DismissedUpdate {
  version: string
  until: number
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    // التخزين غير متاح أو المحتوى تالف — نكمل من غير كاش
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // التخزين اختياري — الفشل لا يمنع الفحص
  }
}

export function readCachedUpdate(): CachedUpdate | null {
  const cached = readJson<CachedUpdate>(UPDATE_CACHE_KEY)
  if (!cached || typeof cached.checkedAt !== "number" || !cached.info || typeof cached.info !== "object") {
    return null
  }
  if (typeof cached.info.updateAvailable !== "boolean") {
    return null
  }
  return cached
}

export function writeCachedUpdate(info: UpdateInfo): void {
  const checkedAt = Number.isFinite(info.checkedAt) && info.checkedAt > 0 ? info.checkedAt : Date.now()
  writeJson(UPDATE_CACHE_KEY, { checkedAt, info })
}

export function shouldCheckForUpdate(checkedAt: number, now: number = Date.now()): boolean {
  return !Number.isFinite(checkedAt) || now - checkedAt >= UPDATE_CHECK_TTL_MS
}

export function readDismissedUpdate(): DismissedUpdate | null {
  const dismissed = readJson<DismissedUpdate>(UPDATE_DISMISS_KEY)
  if (!dismissed || typeof dismissed.version !== "string" || typeof dismissed.until !== "number") {
    return null
  }
  return dismissed
}

export function dismissUpdate(version: string, now: number = Date.now()): void {
  const clean = (version || "").trim()
  if (!clean) {
    return
  }
  writeJson(UPDATE_DISMISS_KEY, { version: clean, until: now + UPDATE_DISMISS_MS })
}

// يظهر التنبيه فقط لتحديث حقيقي بنسخة صالحة، وبعد انتهاء مدة الرفض المسجّلة
// لنفس النسخة. أي نسخة جديدة (أو نسخة ناقصة/غير صالحة) لا تُخفي التحديث.
export function shouldShowUpdate(info: UpdateInfo | null, dismissed: DismissedUpdate | null, now: number = Date.now()): boolean {
  if (!info || !info.updateAvailable || !info.latestVersion) {
    return false
  }
  if (!dismissed || dismissed.version !== info.latestVersion) {
    return true
  }
  return now >= dismissed.until
}
