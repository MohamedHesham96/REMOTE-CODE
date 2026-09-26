import { request } from "./http"
import type { ModelInfo, SessionModelRef, SessionModelState } from "../types"

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
