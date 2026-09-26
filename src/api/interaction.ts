import { request } from "./http"
import type { ConversationQuestionAnswers, Permission } from "../types"

export function listPermissions(): Promise<Permission[]> {
  return request<Permission[]>("/api/permission")
}

export function replyPermission(id: string, permissionId: string, response: "once" | "always" | "reject"): Promise<{ accepted: boolean }> {
  return request<{ accepted: boolean }>(`/api/session/${encodeURIComponent(id)}/permission/${encodeURIComponent(permissionId)}`, {
    method: "POST",
    body: JSON.stringify({ response }),
  })
}

export function replyQuestion(id: string, requestId: string, answers: ConversationQuestionAnswers): Promise<{ accepted: boolean }> {
  return request<{ accepted: boolean }>(`/api/session/${encodeURIComponent(id)}/question/${encodeURIComponent(requestId)}/reply`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  })
}

export function rejectQuestion(id: string, requestId: string): Promise<{ accepted: boolean }> {
  return request<{ accepted: boolean }>(`/api/session/${encodeURIComponent(id)}/question/${encodeURIComponent(requestId)}/reject`, {
    method: "POST",
  })
}
