import type { ActiveSession, AppConfig, ConversationQuestionAnswers, FileDiff, HistoryTurn, ModelInfo, Part, Permission, Project, ProjectResponse, PushSubscriptionJson, ResultFile, Session, SessionMessage, SessionModelRef, SessionModelState, SessionStatus, SessionSummary, Todo } from "./types"

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  })

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    const data = payload as { message?: string; error?: string } | undefined
    throw new ApiError(data?.message || `Request failed (${response.status})`, response.status, data?.error)
  }

  return payload as T
}

export async function login(accessToken: string): Promise<void> {
  await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ accessToken }),
  })
}

export async function logout(): Promise<void> {
  await request("/api/logout", { method: "POST" })
}

export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>("/api/config")
}

export function getProjects(): Promise<ProjectResponse> {
  return request<ProjectResponse>("/api/project")
}

export function selectProject(project: Pick<Project, "id" | "worktree">): Promise<{ project: Project }> {
  return request<{ project: Project }>("/api/project/select", {
    method: "POST",
    body: JSON.stringify({ id: project.id, worktree: project.worktree }),
  })
}

export function getSummary(id: string): Promise<SessionSummary> {
  return request<SessionSummary>(`/api/session/${encodeURIComponent(id)}/summary`)
}

export function listSessions(): Promise<Session[]> {
  return request<Session[]>("/api/session")
}

export function createSession(title?: string, mobile = false): Promise<Session> {
  return request<Session>("/api/session", {
    method: "POST",
    body: JSON.stringify({ ...(title ? { title } : {}), ...(mobile ? { mobile: true } : {}) }),
  })
}

export function renameSession(id: string, title: string): Promise<Session> {
  return request<Session>(`/api/session/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  })
}

export function deleteSession(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/session/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export function getStatuses(): Promise<Record<string, SessionStatus>> {
  return request<Record<string, SessionStatus>>("/api/session/status")
}

export function getActivity(): Promise<ActiveSession[]> {
  return request<ActiveSession[]>("/api/activity")
}

export function getMessages(id: string): Promise<SessionMessage[]> {
  return request<SessionMessage[]>(`/api/session/${encodeURIComponent(id)}/message`)
}

export function getHistory(id: string): Promise<HistoryTurn[]> {
  return request<HistoryTurn[]>(`/api/session/${encodeURIComponent(id)}/history`)
}

export function sendMessage(id: string, text: string, agent?: string, model?: SessionModelRef): Promise<{ accepted: boolean }> {
  return request<{ accepted: boolean }>(`/api/session/${encodeURIComponent(id)}/message`, {
    method: "POST",
    body: JSON.stringify({ text, ...(agent ? { agent } : {}), ...(model ? { model } : {}) }),
  })
}

export function abortSession(id: string): Promise<{ aborted: boolean }> {
  return request<{ aborted: boolean }>(`/api/session/${encodeURIComponent(id)}/abort`, { method: "POST" })
}

export function getTodos(id: string): Promise<Todo[]> {
  return request<Todo[]>(`/api/session/${encodeURIComponent(id)}/todo`)
}

export function getDiff(id: string): Promise<FileDiff[]> {
  return request<FileDiff[]>(`/api/session/${encodeURIComponent(id)}/diff`)
}

export function fileDownloadUrl(sessionId: string, file: Pick<ResultFile, "path" | "downloadUrl">): string {
  if (file.downloadUrl) {
    return file.downloadUrl
  }
  return `/api/session/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(file.path)}`
}

export async function downloadResultFile(sessionId: string, file: ResultFile): Promise<void> {
  const url = fileDownloadUrl(sessionId, file)
  if (/^(data:|blob:|https?:)/i.test(url)) {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = file.name || "file"
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return
  }

  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) {
    let message = `Download failed (${response.status})`
    try {
      const payload = (await response.json()) as { message?: string }
      if (payload.message) {
        message = payload.message
      }
    } catch {
      // Keep default message for binary error responses.
    }
    throw new ApiError(message, response.status)
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const canShareFiles = typeof navigator.share === "function" && typeof (navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare === "function"
    const shareable = new File([blob], file.name || "file", { type: blob.type || file.mime || "application/octet-stream" })
    if (canShareFiles) {
      try {
        if ((navigator as Navigator & { canShare: (data: ShareData) => boolean }).canShare({ files: [shareable] })) {
          // Let the caller decide when to share; default stays as direct download for reliability.
        }
      } catch {
        // Ignore and fall back to download.
      }
    }

    const anchor = document.createElement("a")
    anchor.href = objectUrl
    anchor.download = file.name || "file"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
  }
}

export async function shareResultFile(sessionId: string, file: ResultFile): Promise<boolean> {
  if (typeof navigator.share !== "function") {
    return false
  }
  const url = fileDownloadUrl(sessionId, file)
  if (/^(data:|blob:|https?:)/i.test(url)) {
    await navigator.share({ title: file.name, text: file.name, url })
    return true
  }
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) {
    throw new ApiError(`Download failed (${response.status})`, response.status)
  }
  const blob = await response.blob()
  const shareFile = new File([blob], file.name || "file", { type: blob.type || file.mime || "application/octet-stream" })
  const navigatorWithShare = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (navigatorWithShare.canShare && !navigatorWithShare.canShare({ files: [shareFile] })) {
    await navigator.share({ title: file.name, text: file.name, url: window.location.href })
    return true
  }
  await navigator.share({ title: file.name, text: file.name, files: [shareFile] })
  return true
}

export function listPermissions(): Promise<Permission[]> {
  return request<Permission[]>("/api/permission")
}

export function getModels(): Promise<ModelInfo[]> {
  return request<ModelInfo[]>("/api/models")
}

export function getSessionModel(id: string): Promise<SessionModelState> {
  return request<SessionModelState>(`/api/session/${encodeURIComponent(id)}/model`)
}

export function setSessionModel(id: string, model: SessionModelRef): Promise<{ model: SessionModelRef }> {
  return request<{ model: SessionModelRef }>(`/api/session/${encodeURIComponent(id)}/model`, {
    method: "POST",
    body: JSON.stringify(model),
  })
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

export function subscribePush(subscription: PushSubscriptionJson): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription),
  })
}

export function unsubscribePush(endpoint: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/push/subscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  })
}

export function testPush(subscription: PushSubscriptionJson): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/push/test", {
    method: "POST",
    body: JSON.stringify(subscription),
  })
}

export function base64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}

export function isTextPart(part: Part): part is Extract<Part, { type: "text" }> {
  return part.type === "text"
}

export function messageText(parts: Part[]): string {
  return parts.filter(isTextPart).map((part) => part.text).join("\n")
}
