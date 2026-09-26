import { request } from "./http"
import type { ActiveSession, AppConfig, Session, SessionStatus } from "../types"

export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>("/api/config")
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

export function renameSession(id: string, title: string, lang: "ar" | "en" = "ar"): Promise<Session> {
  return request<Session>(`/api/session/${encodeURIComponent(id)}?lang=${lang}`, {
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

export function getActivity(lang: "ar" | "en" = "ar"): Promise<ActiveSession[]> {
  return request<ActiveSession[]>(`/api/activity?lang=${lang}`)
}
