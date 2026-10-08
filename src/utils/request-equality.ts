import type { ConversationQuestion, ConversationQuestionRequest, SessionRequest } from "../types"
import { sameRequestUsage } from "./usage"

function sameStrings(left: string[], right: string[]): boolean {
  return left === right || (left.length === right.length && left.every((value, index) => value === right[index]))
}

function sameRecords<T extends object>(left: T[], right: T[]): boolean {
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
  const sameRetryModel = left.retryModel === right.retryModel || (
    left.retryModel !== undefined
    && right.retryModel !== undefined
    && left.retryModel.providerID === right.retryModel.providerID
    && left.retryModel.modelID === right.retryModel.modelID
    && left.retryModel.variant === right.retryModel.variant
  )
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
    && sameRequestUsage(left.usage, right.usage)
    && left.error === right.error
    && left.retryAgent === right.retryAgent
    && sameRetryModel
  )
}

function sameQuestion(left: ConversationQuestion, right: ConversationQuestion): boolean {
  return left.question === right.question
    && left.header === right.header
    && left.multiple === right.multiple
    && left.custom === right.custom
    && sameRecords(left.options, right.options)
}

export function sameConversationQuestionRequest(left: ConversationQuestionRequest, right: ConversationQuestionRequest): boolean {
  return left === right || (
    left.id === right.id
    && left.sessionID === right.sessionID
    && left.questions.length === right.questions.length
    && left.questions.every((question, index) => {
      const other = right.questions[index]
      return other !== undefined && sameQuestion(question, other)
    })
  )
}
