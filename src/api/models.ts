import { request } from "./http"
import type { ModelInfo, SessionModelRef, SessionModelState } from "../types"

export function getModels(): Promise<ModelInfo[]> {
  return request<ModelInfo[]>("/api/models")
}

export function getSessionModel(id: string): Promise<SessionModelState> {
  return request<SessionModelState>(`/api/session/${encodeURIComponent(id)}/model`)
}

// lang ضروري هنا: السيرفر بيرد برسالة "اربط المزوّد" لما النموذج من الكتالوج
// ومزوّدش متصل، والرسالة لازم تطلع بلغة الواجهة زي باقي رسائل العقد
export function setSessionModel(id: string, model: SessionModelRef, lang: "ar" | "en" = "ar"): Promise<{ model: SessionModelRef }> {
  return request<{ model: SessionModelRef }>(`/api/session/${encodeURIComponent(id)}/model?lang=${lang}`, {
    method: "POST",
    body: JSON.stringify(model),
  })
}
