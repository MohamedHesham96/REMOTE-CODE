import { memo, useCallback, useDeferredValue, useMemo, useState } from "react"
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
import { usePinnedModels } from "../hooks/usePinnedModels"
import type {
  ModelInfo,
  SessionModelRef,
} from "../types"
import { buildModelCatalog } from "../utils/model-search"
import { modelPinKey } from "../utils/storage"

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
  // النماذج المثبتة (بحد أقصى 5) — مصدرها السيرفر فتبقى زي ما هي على كل
  // الأجهزة (تثبيت من الموبايل يظهر هنا والعكس). القسم العلوي مطوي افتراضيًا
  // زي باقي المجموعات: العنوان بيقول كام مثبت، والمستخدم يفتحه لما يعوزه
  const { keys: pinnedKeys, isPinned: isModelPinned, togglePin: toggleModelPin } = usePinnedModels()
  const [pinnedOpen, setPinnedOpen] = useState(false)
  // مستوى التفكير بيتتبع الموديل اللي ضغطت عليه في القائمة، مش الموديل
  // النشط في الجلسة. الربط بالموديل النشط مباشرة كان بيخلّي القائمة فوق
  // تعرض مستويات الموديل القديم لثواني بعد الضغط على موديل تاني، لحد ما
  // السيرفر يرد ويحدّث الاختيار. الاختيار هنا محلي وفوري، والسيرفر يبقى
  // مصدر الحقيقة بعد التأكيد.
  const [focus, setFocus] = useState<{ key: string; variant: string } | null>(null)
  const togglePin = useCallback((model: ModelInfo): void => {
    toggleModelPin(modelPinKey(model.providerID, model.id))
  }, [toggleModelPin])
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
  //
  // الفهرس (النص المصغّر + الترتيب + خريطة المفاتيح) بيتحسب مرة واحدة لما
  // الكتالوج يتغير، مش مع كل حرف — التفاصيل في src/utils/model-search.ts.
  // الكتابة نفسها بتعمل includes على نصوص جاهزة بس.
  const catalog = useMemo(() => buildModelCatalog(models), [models])

  // البحث بيتنفّذ على القيمة المؤجّلة: الحرف بيتكتب فورًا في الحقل (حالة
  // عاجلة)، وقائمة النتايج تتحدّث في رندر أقل أولوية — فمئات الصفوف ما
  // يعلّقوش الإدخال على الموبايل. على جهاز سريع الفرق مش محسوس.
  const deferredQuery = useDeferredValue(query)
  const needle = useMemo(() => deferredQuery.trim().toLowerCase(), [deferredQuery])
  const searching = needle.length > 0

  // التجميع حسب الموفر مرتبًا أبجديًا — والنماذج داخل كل مجموعة مرتبة بالاسم.
  // المثبتة مستثناة من المجموعات (تظهر في القسم العلوي فقط) عشان مفيش تكرار —
  // لكن أثناء البحث بترجع لمجموعتها الطبيعية: البحث فهرس للنتايج مش قائمة
  // اختصارات، والمستخدم بيدوّر على الموديل مش على مكانه في تثبيته
  const groups = useMemo(() => {
    const pinned = searching ? null : new Set(pinnedKeys)
    return catalog.providers
      .map((group) => ({
        providerID: group.providerID,
        models: group.entries
          .filter((entry) =>
            (!pinned || !pinned.has(entry.key))
            && (!freeOnly || entry.model.free)
            && (!needle || entry.haystack.includes(needle)))
          .map((entry) => entry.model),
      }))
      .filter((group) => group.models.length > 0)
  }, [catalog, pinnedKeys, searching, freeOnly, needle])

  // القسم العلوي بنفس ترتيب التثبيت ("الأحدث أولًا")، ويخضع لنفس الترشيح
  // (مجاني/بحث) عشان البحث ما يسيبش نتائج قديمة ظاهرة فوق
  const pinnedModels = useMemo(() => {
    const result: ModelInfo[] = []
    for (const key of pinnedKeys) {
      const entry = catalog.byKey.get(key)
      if (!entry) {
        continue
      }
      if (freeOnly && !entry.model.free) {
        continue
      }
      if (needle && !entry.haystack.includes(needle)) {
        continue
      }
      result.push(entry.model)
    }
    return result
  }, [catalog, pinnedKeys, freeOnly, needle])
  const pinnedFull = pinnedKeys.length >= PINNED_MODELS_LIMIT

  const totalCount = models.length

  // خيارات الـ variety بتتغير حسب الموديل المختار — بنجيبها من الموديل نفسه
  const currentModel = useMemo(
    () => (current ? catalog.byKey.get(modelPinKey(current.providerID, current.modelID))?.model ?? null : null),
    [catalog, current],
  )
  // الموديل اللي مستوى التفكير متعلق بيه: آخر موديل ضغطه المستخدم في
  // القائمة، وإن لسه مفيش ضغط نرجع للموديل النشط. الرجوع للموديل النشط
  // كمان بيغطي الموديل المركّز عليه لو مش موجود في الكتالوج (سبحان بعد تحديث).
  const focusedModel = useMemo(() => {
    if (!focus) {
      return currentModel
    }
    return catalog.byKey.get(focus.key)?.model ?? currentModel
  }, [catalog, focus, currentModel])
  const focusedIsCurrent = !!focusedModel
    && focusedModel.providerID === current?.providerID
    && focusedModel.id === current?.modelID
  const variants = useMemo(() => (focusedModel ? getVarietyLevels(focusedModel) : []).sort((a, b) => {
    const left = VARIANT_ORDER.indexOf(a)
    const right = VARIANT_ORDER.indexOf(b)
    if (left !== -1 && right !== -1) return left - right
    if (left !== -1) return -1
    if (right !== -1) return 1
    return a.localeCompare(b)
  }), [focusedModel])
  // الموديل لسه ما اتأكدش من السيرفر: اللي نعرضه هو الاختيار المحلي اللي
  // المستخدم ضغطه دلوقتي. بعد التأكيد نرجع لقيمة السيرفر لأنها المرجع.
  const activeVariant = focusedIsCurrent ? current?.variant || "" : focus?.variant || ""
  // أي اختيار من الدروير — صف موديل أو مستوى تفكير — بيسجّل الموديل المعني
  // محليًا الأول، فالقائمة فوق بتتحرك في نفس اللحظة بدل ما تستنى الشبكة.
  const handleSelect = useCallback((model: ModelInfo, variant?: string) => {
    setFocus({ key: modelPinKey(model.providerID, model.id), variant: (variant || "").trim() })
    onSelect(model, variant)
  }, [onSelect])

  // صف النموذج: زر الاختيار + زر التثبيت جنبه — زرّان متجاوران لا متداخلان
  // (زر جوّه زرّ HTML غير صالح)، والتثبيت بينتظر رد السيرفر قبل ما يظهر على
  // الأجهزة التانية. الحساب هنا رخيص (مفتاح + bool) والتكلفة الفعلية في
  // `ModelRow` الـ memo.
  const renderModelRow = (model: ModelInfo) => {
    const key = modelPinKey(model.providerID, model.id)
    const pinned = isModelPinned(key)
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
        onSelect={handleSelect}
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
        {variants.length > 0 && focusedModel ? (
          <div className="variant-options">
            <div className="variant-label">
              <small dir="ltr">{focusedModel.providerID}/{focusedModel.id}</small>
              <span>{t.modelVariety}</span>
            </div>
            <select
              className="variant-select"
              value={activeVariant}
              onChange={(event) => handleSelect(focusedModel, event.target.value)}
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
        ) : groups.length === 0 && pinnedModels.length === 0 ? (
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
