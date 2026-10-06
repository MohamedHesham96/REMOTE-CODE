import type { ModelInfo } from "../types"
import { modelPinKey } from "./storage"

// فهرس البحث في منتقي النماذج: النص المصغّر والمفتاح بيتحسبوا مرة واحدة لكل
// كتالوج، مش مع كل حرف. قبل كده كل ضغطة كانت بتعيد على مئات النماذج:
// بناء "provider/id name" وتصغيره، وترتيب الموفرات والنماذج بـ localeCompare،
// وبناء Map من أول وجديد للبحث في المثبتة. دي أغلى من البحث نفسه بمراحل.
export interface ModelEntry {
  model: ModelInfo
  key: string
  haystack: string
}

export interface ProviderGroup {
  providerID: string
  entries: ModelEntry[]
}

export interface ModelCatalog {
  entries: ModelEntry[]
  // الموفرات مرتبة أبجديًا، والنماذج داخل كل موفر مرتبة بالاسم — الترتيب
  // اللي كانت المجموعات بتعيد حسابه في كل رندر.
  providers: ProviderGroup[]
  byKey: Map<string, ModelEntry>
}

export function buildModelCatalog(models: ModelInfo[]): ModelCatalog {
  const entries: ModelEntry[] = models.map((model) => ({
    model,
    key: modelPinKey(model.providerID, model.id),
    haystack: `${model.providerID}/${model.id} ${model.name}`.toLowerCase(),
  }))
  const byProvider = new Map<string, ModelEntry[]>()
  for (const entry of entries) {
    const list = byProvider.get(entry.model.providerID)
    if (list) {
      list.push(entry)
    } else {
      byProvider.set(entry.model.providerID, [entry])
    }
  }
  const providers = [...byProvider.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([providerID, list]) => ({
      providerID,
      entries: [...list].sort((a, b) => a.model.name.localeCompare(b.model.name)),
    }))
  return { entries, providers, byKey: new Map(entries.map((entry) => [entry.key, entry])) }
}
