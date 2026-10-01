import { useMemo, useState } from "react"
import {
  getVarietyLevels,
  GitRefreshIcon,
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
  const [freeOnly, setFreeOnly] = useState(false)
  // كل النماذج تتعرض كما وصلت من السيرفر — بلا إخفاء حسب التفعيل.
  // مرشح "المجاني فقط" اختياري (مغلق افتراضيًا) فالقائمة الكاملة هي الأصل.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = freeOnly ? models.filter((model) => model.free) : models
    if (!q) {
      return list
    }
    return list.filter((model) =>
      `${model.providerID}/${model.id} ${model.name}`.toLowerCase().includes(q),
    )
  }, [models, freeOnly, query])

  // التجميع حسب الموفر مرتبًا أبجديًا — والنماذج داخل كل مجموعة مرتبة بالاسم
  const groups = useMemo(() => {
    const map = new Map<string, ModelInfo[]>()
    for (const model of filtered) {
      const list = map.get(model.providerID)
      if (list) {
        list.push(model)
      } else {
        map.set(model.providerID, [model])
      }
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([providerID, list]) => ({
        providerID,
        models: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [filtered])

  const totalCount = models.length
  const providerCount = useMemo(() => new Set(models.map((model) => model.providerID)).size, [models])

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
          <div><div className="eyebrow">{t.currentModel}: {modelLabel(current, t)}</div><h2>{t.chooseModel}</h2></div>
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
          <button className="icon-button" onClick={onRefresh} aria-label={t.refreshList} title={t.refreshFromOpencode} disabled={loading}><GitRefreshIcon /></button>
        </div>
        <label className="model-filter-row">
          <input
            type="checkbox"
            checked={freeOnly}
            onChange={(event) => setFreeOnly(event.target.checked)}
          />
          <span>{t.freeOnly}</span>
        </label>
        <div className="model-count">{loading ? t.updatingFromOpencode : `${t.availableNow}: ${totalCount} ${t.modelsCount} · ${providerCount} ${t.providersCount}`}</div>
        {loading && totalCount === 0 ? (
          <div className="picker-loading"><span className="loader" /> {t.loadingModels}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">{t.noModels}</div>
        ) : (
          <div className="model-list">
            {groups.map((group) => (
              <section className="model-group" key={group.providerID}>
                <h3 className="model-group-title" dir="ltr">{group.providerID} <span>({group.models.length})</span></h3>
                {group.models.map((model) => {
                  const key = `${model.providerID}/${model.id}`
                  const isCurrent = current?.providerID === model.providerID && current?.modelID === model.id
                  const isSwitching = switching === key
                  // عناصر الكتالوج العام (enabled: false) للعرض فقط — المحرك
                  // لا يقدّمها قبل ربط موفرها، فالاختيار معطّل مع شارة توضيحية
                  const unavailable = model.enabled === false
                  const modelVariants = getVarietyLevels(model)
                  return (
                    <button
                      className={`model-card${isCurrent ? " selected" : ""}`}
                      key={key}
                      disabled={busy || Boolean(switching) || unavailable}
                      title={unavailable ? t.needsConnection : undefined}
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
                        {model.free ? <span className="free-badge">FREE</span> : null}
                        {unavailable ? <span className="needs-badge">{t.needsConnection}</span> : null}
                        {isCurrent ? <span className="current-badge">{t.current} ✓</span> : null}
                        {isSwitching ? <span className="loader small" /> : null}
                      </span>
                    </button>
                  )
                })}
              </section>
            ))}
          </div>
        )}
        <div className="model-footnote">{t.modelListLive}</div>
      </aside>
    </div>
  )
}
