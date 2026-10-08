import type { Strings } from "../i18n"
import type { RequestUsage, SessionUsage, TokenUsage } from "../types"

export const EMPTY_REQUEST_USAGE: RequestUsage = { tokens: null, cost: null }

// تقريب للأرقام الكبيرة بنفس أسلوب لوحات الاستخدام: 12.4K / 51.1M. الأرقام
// نفسها غربية في اللغتين عشان تتقري في سياق واحد بلا قلب اتجاه.
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0"
  }
  if (value < 1000) {
    return String(Math.round(value))
  }
  if (value < 1_000_000) {
    return `${compact(value / 1000)}K`
  }
  return `${compact(value / 1_000_000)}M`
}

function compact(value: number): string {
  const digits = value >= 100 ? 0 : 1
  return value.toFixed(digits).replace(/\.0$/, "")
}

// تكلفة بالدولار: قيم صغيرة تحتاج خانات أكتر عشان متظهرش كصفر، والصفر الحقيقي
// يفضل $0.00 لأنه قيمة فعلية لنموذج مجاني (مش تكلفة غير معروفة).
export function formatCost(value: number): string {
  if (!Number.isFinite(value)) {
    return "$0.00"
  }
  if (value > 0 && value < 0.01) {
    return `$${value.toFixed(4)}`
  }
  return `$${value.toFixed(2)}`
}

// مدة العمل بصيغة مختصرة مترجمة: "14 د 32 ث" و"14m 32s". الوحدات تأتي من
// قاموس الواجهة عشان ما نكتبش صيغتين متوازيتين.
export function formatDuration(durationMs: number, t: Strings): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600) % 24
  const days = Math.floor(totalSeconds / 86400)
  if (days > 0) {
    return `${days} ${t.daysShort}`
  }
  if (hours > 0) {
    return seconds > 0
      ? `${hours} ${t.hoursShort} ${minutes} ${t.minutesShort} ${seconds} ${t.secondsShort}`
      : `${hours} ${t.hoursShort} ${minutes} ${t.minutesShort}`
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} ${t.minutesShort} ${seconds} ${t.secondsShort}` : `${minutes} ${t.minutesShort}`
  }
  return `${seconds} ${t.secondsShort}`
}

function sameTokenUsage(left: TokenUsage | null | undefined, right: TokenUsage | null | undefined): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.input === right.input
    && left.output === right.output
    && left.reasoning === right.reasoning
    && left.cacheRead === right.cacheRead
    && left.cacheWrite === right.cacheWrite
    && left.total === right.total
}

export function sameRequestUsage(left: RequestUsage | undefined, right: RequestUsage | undefined): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.cost === right.cost && sameTokenUsage(left.tokens, right.tokens)
}

// مقارنة ملخص الجلسة: تسمح لـ App بإرجاع نفس المرجع لما الأرقام ما اتغيرتش،
// فلا يقع رندر لدائرة التاريخ بلا سبب.
export function sameSessionUsage(left: SessionUsage | null | undefined, right: SessionUsage | null | undefined): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.requests === right.requests
    && left.durationMs === right.durationMs
    && sameRequestUsage(left, right)
}
