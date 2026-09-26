import { useMemo, useState } from "react"
import {
  getVarietyLevels,
  modelLabel,
  shortModelName,
  variantLabel,
  VARIANT_ORDER,
} from "../display"
import type { Strings } from "../i18n"
import type {
  ModelInfo,
  SessionModelRef,
} from "../types"

export function ModelPicker({
  models,
  loading,
  current,
  busy,
  switching,
  onSelect,
  onRefresh,
  onClose,
  t,
}: {
  models: ModelInfo[]
  loading: boolean
  current: SessionModelRef | null
  busy: boolean
  switching: string | null
  onSelect: (model: ModelInfo, variant?: string) => void
  onRefresh: () => void
  onClose: () => void
  t: Strings
}) {
  const [query, setQuery] = useState("")
  // الموجودين في opencode فقط + المتاح (enabled) + free فقط — القائمة حية من السيرفر
  const freeOnly = useMemo(() => models.filter((model) => model.free && model.enabled !== false), [models])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return freeOnly
    }
    return freeOnly.filter((model) =>
      `${model.providerID}/${model.id} ${model.name}`.toLowerCase().includes(q),
    )
  }, [freeOnly, query])

  // خيارات الـ variety بتتغير حسب الموديل المختار — بنجيبها من الموديل نفسه
  const currentModel = useMemo(
    () => models.find((model) => model.providerID === current?.providerID && model.id === current?.modelID) ?? null,
    [models, current],
  )
  const variants = useMemo(() => (currentModel ? getVarietyLevels(currentModel) : []).sort((a, b) => {
    const left = VARIANT_ORDER.indexOf(a)
    const right = VARIANT_ORDER.indexOf(b)
    if (left !== -1 && right !== -1) return left - right
    if (left !== -1) return -1
    if (right !== -1) return 1
    return a.localeCompare(b)
  }), [currentModel])
  const activeVariant = current?.variant || ""

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer model-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div><div className="eyebrow">{t.currentModel}: {modelLabel(current, t)}</div><h2>{t.chooseFreeModel} 🆓</h2></div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {variants.length > 0 && currentModel ? (
          <div className="variant-picker">
            <div className="variant-label">
              <span>{t.modelVariety}</span>
              <small dir="ltr">{currentModel.providerID}/{currentModel.id}</small>
            </div>
            <div className="variant-chips" role="radiogroup" aria-label={t.modelVariety}>
              {activeVariant ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked="true"
                  className="variant-chip active"
                  onClick={() => onSelect(currentModel, "")}
                >
                  {t.varietyDefault}
                </button>
              ) : null}
              {variants.map((variant) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={activeVariant === variant}
                  className={`variant-chip${activeVariant === variant ? " active" : ""}`}
                  key={variant}
                  onClick={() => onSelect(currentModel, variant)}
                >
                  {variantLabel(variant, t)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="model-toolbar">
          <input
            className="model-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.searchModelsPlaceholder}
            aria-label={t.searchModelsAria}
          />
          <button className="icon-button" onClick={onRefresh} aria-label={t.refreshList} title={t.refreshFromOpencode} disabled={loading}>↻</button>
        </div>
        <div className="model-count">{loading ? t.updatingFromOpencode : `${t.availableNow}: ${freeOnly.length} ${t.freeModels}`}</div>
        {loading && freeOnly.length === 0 ? (
          <div className="picker-loading"><span className="loader" /> {t.loadingModels}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">{t.noFreeModels}</div>
        ) : (
          <div className="model-list">
            {filtered.map((model) => {
              const key = `${model.providerID}/${model.id}`
              const isCurrent = current?.providerID === model.providerID && current?.modelID === model.id
              const isSwitching = switching === key
              const modelVariants = getVarietyLevels(model)
              return (
                <button
                  className={`model-card${isCurrent ? " selected" : ""}`}
                  key={key}
                  disabled={busy || Boolean(switching)}
                  onClick={() => onSelect(model, "")}
                >
                  <span className="model-card-body">
                    <strong>{shortModelName(model)}</strong>
                    <small dir="ltr">{isCurrent && activeVariant ? `${key} · ${variantLabel(activeVariant, t)}` : key}</small>
                  </span>
                  <span className="model-card-side">
                    {modelVariants.length > 0 ? (
                      <span className="variant-badge">{isCurrent && activeVariant ? variantLabel(activeVariant, t) : `${modelVariants.length} ${t.varietyOptions}`}</span>
                    ) : null}
                    <span className="free-badge">FREE 🆓</span>
                    {isCurrent ? <span className="current-badge">{t.current} ✓</span> : null}
                    {isSwitching ? <span className="loader small" /> : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="model-footnote">{t.modelListLive}</div>
      </aside>
    </div>
  )
}
