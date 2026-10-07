import { ApiError, request } from "./http"
import type { ComposerAttachment, HistoryTurn, SessionModelRef, SessionRequests } from "../types"
import { sameSessionRequest } from "../utils/request-equality"

// كاش ETag لطلبات المحادثة: السيرفر يرجّع 304 فاضي لما مفيش تغيير،
// فنرجّع آخر payload من الذاكرة — نفس المرجع (reference) عشان React
// يعمل bail-out وميعيدش الـ render أصلًا
const requestsEtag = new Map<string, string>()
const requestsCache = new Map<string, SessionRequests>()

// in-flight dedup محلي لـ getRequests: المتصل المتعدد (poll + SSE + visibility)
// بيشارك fetch واحدة بدل N طلبات متطابقة. المفتاح = id:lang (الـ ETag
// بيخزّن منفصلاً، فالـ dedup هنا بيعمل على الـ resource نفسه).
const inflightRequests = new Map<string, Promise<SessionRequests>>()

// سقف كاش الـ ETag: مفتاحه id الجلسة، فبلا سقف بيتراكم مع كل محادثة تُفتح في
// عمر الجلسة (والأجسام معاه). الإخلاء مرتب: نشيل أقدم مفتاح من الكاشين مع
// بعض عشان مايفضلش ETag من غير جسم — الطلب اللي بعده بيعمل fetch عادي (نفس
// البيانات من السيرفر). مش بيغيّر أي نتيجة ظاهرة.
const REQUESTS_ETAG_CACHE_LIMIT = 30

export async function getRequests(id: string, lang: "ar" | "en" = "ar"): Promise<SessionRequests> {
  const key = `${id}:${lang}`
  // dedup: لو في طلب جاري بالفعل لنفس (id, lang)، نرجّع نفس الـ Promise
  const running = inflightRequests.get(key)
  if (running) {
    return running
  }
  const url = `/api/session/${encodeURIComponent(id)}/requests?lang=${lang}`
  const headers: Record<string, string> = {}
  const tag = requestsEtag.get(key)
  if (tag) {
    headers["If-None-Match"] = tag
  }
  const task = (async () => {
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
      throw new ApiError(data?.message || `Request failed (${response.status})`, response.status)
    }
    const etag = response.headers.get("ETag")
    if (etag) {
      if (requestsEtag.size >= REQUESTS_ETAG_CACHE_LIMIT && !requestsEtag.has(key)) {
        const oldest = requestsEtag.keys().next()
        if (!oldest.done) {
          requestsEtag.delete(oldest.value)
          requestsCache.delete(oldest.value)
        }
      }
      requestsEtag.delete(key)
      requestsEtag.set(key, etag)
    }
    const result = payload as SessionRequests
    const previous = requestsCache.get(key)
    if (previous) {
      const previousById = new Map(previous.requests.map((item) => [item.id, item]))
      result.requests = result.requests.map((item) => {
        const cached = previousById.get(item.id)
        return cached && sameSessionRequest(cached, item) ? cached : item
      })
    }
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
  })().finally(() => {
    if (inflightRequests.get(key) === task) {
      inflightRequests.delete(key)
    }
  })
  inflightRequests.set(key, task)
  return task
}

export function getHistory(id: string, lang: "ar" | "en" = "ar"): Promise<HistoryTurn[]> {
  return request<HistoryTurn[]>(`/api/session/${encodeURIComponent(id)}/history?lang=${lang}`)
}

// المرفقات بتتبعت كـ { uri, name } جوه `attachments`؛ السيرفر يتحقق من
// النوع والحجم قبل ما يمرّرها للمحرك كـ data URI مضمّن.
export function sendMessage(id: string, text: string, agent?: string, model?: SessionModelRef, attachments?: ComposerAttachment[]): Promise<{ accepted: boolean; queued: boolean }> {
  const files = attachments?.map((attachment) => ({ uri: attachment.uri, name: attachment.name }))
  return request<{ accepted: boolean; queued: boolean }>(`/api/session/${encodeURIComponent(id)}/message`, {
    method: "POST",
    body: JSON.stringify({
      text,
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
      ...(files && files.length > 0 ? { attachments: files } : {}),
    }),
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

export function runQueuedRequest(id: string, requestId: string): Promise<{ started: boolean; steered: boolean; queued: boolean; remaining: number }> {
  return request<{ started: boolean; steered: boolean; queued: boolean; remaining: number }>(`/api/session/${encodeURIComponent(id)}/request/${encodeURIComponent(requestId)}/run`, { method: "POST" })
}
