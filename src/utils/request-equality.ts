import type { RequestAttachment, ResultFile, SessionRequest } from "../types"

function sameStrings(left: string[], right: string[]): boolean {
  return left === right || (left.length === right.length && left.every((value, index) => value === right[index]))
}

function sameRecords<T extends ResultFile | RequestAttachment>(left: T[], right: T[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b) {
      return false
    }
    const keys = Object.keys(a) as Array<keyof T>
    const otherKeys = Object.keys(b) as Array<keyof T>
    if (keys.length !== otherKeys.length || keys.some((key) => !otherKeys.includes(key) || a[key] !== b[key])) {
      return false
    }
  }
  return true
}

// استجابة البثّ تعيد إنشاء كل الطلبات حتى لو تغيّر نص الطلب الجاري فقط؛
// مشاركة مراجع الصفوف الثابتة تسمح لـ React بتجاوز رسم السجل التاريخي كله.
export function sameSessionRequest(left: SessionRequest, right: SessionRequest): boolean {
  return left === right || (
    left.id === right.id
    && left.index === right.index
    && left.prompt === right.prompt
    && left.state === right.state
    && left.activity === right.activity
    && left.finalResult === right.finalResult
    && left.liveText === right.liveText
    && left.stepsCompleted === right.stepsCompleted
    && left.activeTool === right.activeTool
    && sameStrings(left.usedTools, right.usedTools)
    && sameRecords(left.resultFiles, right.resultFiles)
    && sameRecords(left.attachments, right.attachments)
    && left.startedAt === right.startedAt
    && left.completedAt === right.completedAt
    && left.updatedAt === right.updatedAt
  )
}
