import { request } from "./http"
import type { PushSubscriptionJson } from "../types"

export function subscribePush(subscription: PushSubscriptionJson, lang: "ar" | "en" = "ar"): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ ...subscription, lang }),
  })
}

export function unsubscribePush(endpoint: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/push/subscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  })
}
