import { memo, useCallback, useEffect, useMemo, useState } from "react"
import {
  getVarietyLevels,
  GitRefreshIcon,
  SearchLensIcon,
  shortModelName,
  variantLabel,
  VARIANT_ORDER,
} from "../display"
import type { Strings } from "../i18n"
import { PINNED_MODELS_LIMIT } from "../constants"
import type {
  ModelInfo,
  SessionModelRef,
} from "../types"
import { loadPinnedModels, modelPinKey, savePinnedModels, togglePinnedModel } from "../utils/storage"

// صف النموذج: كائن memo مستقل عشان الكتابة في البحث تعيد رسم الصفوف اللي
// اتغيّرت بس. القائمة ممكن توصل لمئات النماذج، وكل ضغطة حرف في البحث كانت
// بتعيد رسم كل صف مطابق (مقارنة + بناء DOM) من غير أي تغيير في بياناته.
// ملحوظة: الـ `key` هنا نص العرض جوه الصف؛ مفتاح React بيتحدد عند الـ parent.
const ModelRow = memo(function ModelRow({ model, current, busy, switching, pinned, pinDisabled, activeVariant, onSelect, onTogglePin, t }: {
  model: ModelInfo
  current: SessionModelRef | null
  busy: boolean
  switching: string | null
  pinned: boolean
  pinDisabled: boolean
  activeVariant: string
  onSelect: (model: ModelInfo, variant?: string) => void
  onTogglePin: (model: ModelInfo) => void
  t: Strings
}) {
  const key = `${model.providerID}/${model.id}`
  const isCurrent = current?.providerID === model.providerID && current?.modelID === model.id
  const isSwitching = switching === key
  // عناصر الكتالوج العام (enabled: false) مش مربوطة بالمحرك، بس بنسمح
  // باختيارها: مفيش تكلفة، والمزوّد ممكن يتربط بعدين على المضيف فيشتغل
  // من غير ما المستخدم يرجعل الاختيار تاني
  const unavailable = model.enabled === false
  const modelVariants = getVarietyLevels(model)
  return (
    <div className="model-row">
      <button
        className={`model-card${isCurrent ? " selected" : ""}`}
        disabled={busy || Boolean(switching)}
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
      <button
        type="button"
        className={`model-pin${pinned ? " active" : ""}`}
        aria-pressed={pinned}
        aria-label={pinned ? t.unpinModel : t.pinModel}
        title={pinDisabled ? t.pinnedModelsFull : pinned ? t.unpinModel : t.pinModel}
        disabled={pinDisabled}
        onClick={() => onTogglePin(model)}
      >
        <span aria-hidden="true">{pinned ? "📌" : "📍"}</span>
      </button>
    </div>
  )
})

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
  // كل المجموعات مطوية افتراضيًا — القائمة طويلة (مئات النماذج)، فالطيّ
  // يخلّي التنقل حسب الموفر بدل السكرول الطويل. البحث يفتح الكل تلقائيًا
  // عشان النتائج تبان من غير فتح يدوي.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // النماذج المثبتة (بحد أقصى 5) — كاش عرض محلي يظهر قسمًا علويًا ثابتًا
  // للوصول السريع من غير سكرول في مئات النماذج. مطوي افتراضيًا زي باقي
  // المجموعات: العنوان بيقول كام مثبت، والمستخدم يفتحه لما يعوزه
  const [pinnedKeys, setPinnedKeys] = useState<string[]>(() => loadPinnedModels())
  const [pinnedOpen, setPinnedOpen] = useState(false)
  useEffect(() => {
    savePinnedModels(pinnedKeys)
  }, [pinnedKeys])
  const togglePin = useCallback((model: ModelInfo): void => {
    setPinnedKeys((current) => togglePinnedModel(current, modelPinKey(model.providerID, model.id)))
  }, [])
  const searching = query.trim().length > 0
  const toggleGroup = (providerID: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(providerID)) {
        next.delete(providerID)
      } else {
        next.add(providerID)
      }
      return next
    })
  }
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

  // التجميع حسب الموفر مرتبًا أبجديًا — والنماذج داخل كل مجموعة مرتبة بالاسم.
  // المثبتة مستثناة من المجموعات (تظهر في القسم العلوي فقط) عشان مفيش تكرار —
  // لكن أثناء البحث بترجع لمجموعتها الطبيعية: البحث فهرس للنتايج مش قائمة
  // اختصارات، والمستخدم بيدوّر على الموديل مش على مكانه في تثبيته
  const groups = useMemo(() => {
    const pinned = searching ? new Set<string>() : new Set(pinnedKeys)
    const map = new Map<string, ModelInfo[]>()
    for (const model of filtered) {
      if (pinned.has(modelPinKey(model.providerID, model.id))) {
        continue
      }
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
  }, [filtered, pinnedKeys, searching])

  // القسم العلوي بنفس ترتيب التثبيت ("الأحدث أولًا")، ويخضع لنفس الترشيح
  // (مجاني/بحث) عشان البحث ما يسيبش نتائج قديمة ظاهرة فوق
  const pinnedModels = useMemo(() => {
    const byKey = new Map(models.map((model) => [modelPinKey(model.providerID, model.id), model]))
    const q = query.trim().toLowerCase()
    const result: ModelInfo[] = []
    for (const key of pinnedKeys) {
      const model = byKey.get(key)
      if (!model) {
        continue
      }
      if (freeOnly && !model.free) {
        continue
      }
      if (q && !`${model.providerID}/${model.id} ${model.name}`.toLowerCase().includes(q)) {
        continue
      }
      result.push(model)
    }
    return result
  }, [models, pinnedKeys, freeOnly, query])
  const pinnedFull = pinnedKeys.length >= PINNED_MODELS_LIMIT

  const totalCount = models.length

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

  // صف النموذج: زر الاختيار + زر التثبيت جنبه — زرّان متجاوران لا متداخلان
  // (زر جوّه زرّ HTML غير صالح)، والتثبيت شغّال دائمًا لأنه كاش عرض محلي.
  // الحساب هنا رخيص (مفتاح + bool) والتكلفة الفعلية في `ModelRow` الـ memo.
  const renderModelRow = (model: ModelInfo) => {
    const key = `${model.providerID}/${model.id}`
    const pinned = pinnedKeys.includes(key)
    return (
      <ModelRow
        key={key}
        model={model}
        current={current}
        busy={busy}
        switching={switching}
        pinned={pinned}
        pinDisabled={!pinned && pinnedFull}
        activeVariant={activeVariant}
        onSelect={onSelect}
        onTogglePin={togglePin}
        t={t}
      />
    )
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer model-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div><h2>{t.chooseModel}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {variants.length > 0 && currentModel ? (
          <div className="variant-options">
            <div className="variant-label">
              <small dir="ltr">{currentModel.providerID}/{currentModel.id}</small>
              <span>{t.modelVariety}</span>
            </div>
            <select
              className="variant-select"
              value={activeVariant}
              onChange={(event) => onSelect(currentModel, event.target.value)}
              aria-label={t.modelVariety}
            >
              <option value="">{t.varietyDefault}</option>
              {variants.map((variant) => (
                <option value={variant} key={variant}>
                  {variantLabel(variant, t)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="model-toolbar">
          <span className="model-search-wrap">
            <span className="model-search-icon" aria-hidden="true"><SearchLensIcon /></span>
            <input
              className="model-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.searchModelsPlaceholder}
              aria-label={t.searchModelsAria}
            />
          </span>
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
        {loading && totalCount === 0 ? (
          <div className="picker-loading"><span className="loader" /> {t.loadingModels}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">{t.noModels}</div>
        ) : (
          <div className="model-list">
            {!searching && pinnedModels.length > 0 ? (
              <section className="model-group pinned-group" aria-label={t.pinnedModels}>
                <button
                  type="button"
                  className="model-group-toggle"
                  aria-expanded={pinnedOpen}
                  onClick={() => setPinnedOpen((previous) => !previous)}
                >
                  <span className="model-group-caret" aria-hidden="true">{pinnedOpen ? "▾" : "▸"}</span>
                  <span className="model-group-title" dir="ltr">📌 {t.pinnedModels} <span>({pinnedModels.length}/{PINNED_MODELS_LIMIT})</span></span>
                </button>
                {pinnedOpen ? (
                <div className="model-group-models">
                  {pinnedModels.map((model) => renderModelRow(model))}
                </div>
                ) : null}
              </section>
            ) : null}
            {groups.map((group) => {
              const open = searching || expanded.has(group.providerID)
              return (
              <section className="model-group" key={group.providerID}>
                <button
                  type="button"
                  className="model-group-toggle"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.providerID)}
                >
                  <span className="model-group-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                  <span className="model-group-title" dir="ltr">{group.providerID} <span>({group.models.length})</span></span>
                </button>
                {open ? (
                <div className="model-group-models">
                {group.models.map((model) => renderModelRow(model))}
                </div>
                ) : null}
              </section>
              )
            })}
          </div>
        )}
      </aside>
    </div>
  )
}
