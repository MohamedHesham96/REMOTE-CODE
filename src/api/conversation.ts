import { ApiError, request } from "./http"
import type { FileDiff, HistoryTurn, SessionMessage, SessionModelRef, SessionRequests, Todo } from "../types"

// كاش ETag لطلبات المحادثة: السيرفر يرجّع 304 فاضي لما مفيش تغيير،
// فنرجّع آخر payload من الذاكرة — نفس المرجع (reference) عشان React
// يعمل bail-out وميعيدش الـ render أصلًا
const requestsEtag = new Map<string, string>()
const requestsCache = new Map<string, SessionRequests>()

export async function getRequests(id: string, lang: "ar" | "en" = "ar"): Promise<SessionRequests> {
  const key = `${id}:${lang}`
  const url = `/api/session/${encodeURIComponent(id)}/requests?lang=${lang}`
  const headers: Record<string, string> = {}
  const tag = requestsEtag.get(key)
  if (tag) {
    headers["If-None-Match"] = tag
  }
  const response = await fetch(url, { headers, credentials: "include" })
  if (response.status === 304) {
    const cached = requestsCache.get(key)
    if (cached) {
      return cached
    }
    // الكاش اتمسح لسبب ما — أعد المحاولة من غير ETag
    requestsEtag.delete(key)
    return getRequests(id, lang)
  }
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
  const etag = response.headers.get("ETag")
  if (etag) {
    requestsEtag.set(key, etag)
  }
  const result = payload as SessionRequests
  // سقف الكاش: جلسات قديمة كثيرة لا تتراكم في الذاكرة (LRU بسيط)
  if (requestsCache.size >= 30 && !requestsCache.has(key)) {
    const oldest = requestsCache.keys().next()
    if (!oldest.done) {
      requestsCache.delete(oldest.value)
      requestsEtag.delete(oldest.value)
    }
  }
  requestsCache.set(key, result)
  return result
}

export function getMessages(id: string): Promise<SessionMessage[]> {
  return request<SessionMessage[]>(`/api/session/${encodeURIComponent(id)}/message`)
}

export function getHistory(id: string, lang: "ar" | "en" = "ar"): Promise<HistoryTurn[]> {
  return request<HistoryTurn[]>(`/api/session/${encodeURIComponent(id)}/history?lang=${lang}`)
}

export function sendMessage(id: string, text: string, agent?: string, model?: SessionModelRef): Promise<{ accepted: boolean; queued: boolean }> {
  return request<{ accepted: boolean; queued: boolean }>(`/api/session/${encodeURIComponent(id)}/message`, {
    method: "POST",
    body: JSON.stringify({ text, ...(agent ? { agent } : {}), ...(model ? { model } : {}) }),
  })
}

export function abortSession(id: string): Promise<{ aborted: boolean; cleared: number }> {
  return request<{ aborted: boolean; cleared: number }>(`/api/session/${encodeURIComponent(id)}/abort`, { method: "POST" })
}

export function skipRunningRequest(id: string): Promise<{ skipped: boolean; remaining: number }> {
  return request<{ skipped: boolean; remaining: number }>(`/api/session/${encodeURIComponent(id)}/skip`, { method: "POST" })
}

export function removeQueuedRequest(id: string, requestId: string): Promise<{ removed: boolean; remaining: number }> {
  return request<{ removed: boolean; remaining: number }>(`/api/session/${encodeURIComponent(id)}/request/${encodeURIComponent(requestId)}`, { method: "DELETE" })
}

export function runQueuedRequest(id: string, requestId: string): Promise<{ started: boolean; remaining: number }> {
  return request<{ started: boolean; remaining: number }>(`/api/session/${encodeURIComponent(id)}/request/${encodeURIComponent(requestId)}/run`, { method: "POST" })
}

export function getTodos(id: string): Promise<Todo[]> {
  return request<Todo[]>(`/api/session/${encodeURIComponent(id)}/todo`)
}

export function getDiff(id: string): Promise<FileDiff[]> {
  return request<FileDiff[]>(`/api/session/${encodeURIComponent(id)}/diff`)
}
