import { useCallback, useMemo, useState } from "react"
import { fileDownloadUrl } from "./api"
import {
  displayTitle,
  EMPTY_GIT_FILES,
  formatCountdown,
  formatDateTime,
  getVarietyLevels,
  gitStatusMeta,
  modelLabel,
  shortModelName,
  splitChangePath,
  statusLabel,
  variantLabel,
  VARIANT_ORDER,
} from "./display"
import type { Language, Strings } from "./i18n"
import type {
  ActiveSession,
  GitChanges,
  HistoryTurn,
  ModelInfo,
  SessionModelRef,
} from "./types"

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

export function ActiveSessionsPanel({ items, recent, graceLeft, activeId, jumpingId, onJump, onClose, t, lang }: {
  items: ActiveSession[]
  recent: ActiveSession[]
  graceLeft: (id: string) => number
  activeId: string | null
  jumpingId: string | null
  onJump: (item: ActiveSession) => void
  onClose: () => void
  t: Strings
  lang: Language
}) {
  // تجميع المحادثات النشطة حسب المشروع — كل المشاريع في مكان واحد
  const groupByProject = useCallback((list: ActiveSession[]) => {
    const map = new Map<string, ActiveSession[]>()
    for (const item of list) {
      const bucket = map.get(item.projectName) || []
      bucket.push(item)
      map.set(item.projectName, bucket)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [])

  const grouped = useMemo(() => groupByProject(items), [groupByProject, items])
  const recentGrouped = useMemo(() => groupByProject(recent), [groupByProject, recent])

  const renderRow = (item: ActiveSession, working: boolean) => {
    const isCurrent = item.id === activeId
    const left = graceLeft(item.id)
    const body = (
      <>
        {working ? <span className="working-spinner" aria-hidden /> : <span className="status-dot" aria-hidden />}
        <span className="activity-row-body">
          <strong>{displayTitle(item.title, t)}</strong>
          <small>
            {working ? statusLabel(item.status, t) : t.activeRecently}
            {' · '}
            {formatDateTime(item.updatedAt, lang)}
            {!working && left > 0 ? <> · <span className="session-grace-timer">{formatCountdown(left)}</span></> : null}
          </small>
        </span>
        {isCurrent ? <span className="current-badge">{t.currentBadge} ✓</span> : null}
      </>
    )
    if (isCurrent) {
      return <div className={`activity-row ${working ? "" : "activity-row-recent"}`} key={item.id}>{body}</div>
    }
    return (
      <button
        type="button"
        className={`activity-row activity-row-tap ${working ? "" : "activity-row-recent"}`}
        key={item.id}
        disabled={jumpingId !== null}
        onClick={() => onJump(item)}
      >
        {body}
      </button>
    )
  }

  const renderProjectGroups = (entries: [string, ActiveSession[]][], working: boolean) => entries.map(([projectName, group]) => (
    <section className="activity-group" key={projectName}>
      <div className="activity-group-header">
        <span className="activity-group-icon" aria-hidden>📁</span>
        <strong>{projectName}</strong>
        <span className="activity-group-count">{group.length}</span>
      </div>
      {group.map((item) => renderRow(item, working))}
    </section>
  ))

  const empty = items.length === 0 && recent.length === 0

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer activity-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">⚡ {t.activeNow} · {items.length > 0 ? `${items.length} ${items.length === 1 ? t.conversation : t.conversations}` : t.none} · {t.allProjects}</div>
            <h2>{t.activeConversations}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {empty ? (
          <div className="empty-state">{t.noActiveConversations}</div>
        ) : (
          <div className="activity-groups">
            {grouped.length > 0 ? (
              <div className="activity-section" aria-label={t.activeNow}>
                <div className="activity-section-header">
                  <strong><span aria-hidden>⚡</span> {t.activeNow}</strong>
                  <span className="activity-section-count" aria-label={`${items.length} ${t.conversations}`}>{items.length}</span>
                </div>
                {renderProjectGroups(grouped, true)}
              </div>
            ) : null}
            {recentGrouped.length > 0 ? (
              <div className="activity-section" aria-label={t.recentlyActiveConversations}>
                <div className="activity-section-header">
                  <strong><span aria-hidden>⏳</span> {t.activeRecently}</strong>
                  <span className="activity-section-count" aria-label={`${recent.length} ${t.conversations}`}>{recent.length}</span>
                </div>
                {renderProjectGroups(recentGrouped, false)}
              </div>
            ) : null}
          </div>
        )}
        <div className="model-footnote">{t.activityLiveNote}</div>
      </aside>
    </div>
  )
}

export function GitChangesPanel({ changes, loading, onRefresh, onCommitPush, commitBusy, onClose, t }: {
  changes: GitChanges | null
  loading: boolean
  onRefresh: () => void
  onCommitPush: () => void
  commitBusy: boolean
  onClose: () => void
  t: Strings
}) {
  // قائمة الملفات المتغيّرة في git للمشروع الحالي، مع ملخص سريع فوقها
  const files = changes?.files ?? EMPTY_GIT_FILES
  const canCommit = Boolean(changes?.available) && files.length > 0 && !loading && !commitBusy
  const summary = useMemo(() => files.reduce((total, file) => {
    if (file.status === "added") {
      total.added += 1
    } else if (file.status === "deleted") {
      total.deleted += 1
    } else {
      total.modified += 1
    }
    return total
  }, { added: 0, modified: 0, deleted: 0 }), [files])

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer git-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">
              <span aria-hidden>⑂</span> {t.gitChangesBranch}: <span dir="ltr">{changes?.branch || t.gitChangesNoBranch}</span>
            </div>
            <h2>{t.gitChangesTitle}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        <div className="git-toolbar">
          <div className="git-summary">
            <span className="git-summary-pill git-status-added">＋{summary.added}</span>
            <span className="git-summary-pill git-status-modified">✎{summary.modified}</span>
            <span className="git-summary-pill git-status-deleted">－{summary.deleted}</span>
          </div>
          <button className="icon-button" onClick={onRefresh} aria-label={t.refreshList} title={`${t.refreshList} ↻`} disabled={loading}>↻</button>
        </div>
        {changes && !changes.available ? (
          <div className="empty-state">{t.gitChangesNotRepo}</div>
        ) : files.length === 0 ? (
          <div className="empty-state">{loading ? "…" : t.gitChangesClean}</div>
        ) : (
          <div className="git-file-list">
            {files.map((file) => {
              const meta = gitStatusMeta(file.status, t)
              const { name, dir } = splitChangePath(file.path)
              return (
                <div className="git-file-item" key={file.path}>
                  <span className={`git-status-mark ${meta.className}`} aria-hidden>{meta.glyph}</span>
                  <span className="git-file-body">
                    <strong dir="ltr" title={file.path}>{name}</strong>
                    <small dir="ltr">{dir || "—"}</small>
                  </span>
                  <span className="git-file-stats">
                    <span className="git-file-label">{meta.label}</span>
                    {file.added > 0 ? <span className="git-diff git-diff-added">+{file.added}</span> : null}
                    {file.removed > 0 ? <span className="git-diff git-diff-removed">−{file.removed}</span> : null}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <div className="model-footnote">{t.gitChangesNote}</div>
        {changes?.available && files.length > 0 ? (
          <button
            type="button"
            className="button button-primary git-commit-button"
            disabled={!canCommit}
            onClick={onCommitPush}
          >
            {commitBusy ? t.gitCommitPushBusy : `⑂ ${t.gitCommitPush}`}
          </button>
        ) : null}
      </aside>
    </div>
  )
}

export function HistoryPanel({
  turns,
  loading,
  error,
  sessionId,
  onClose,
  onCopy,
  onRetry,
  t,
  lang,
}: {
  turns: HistoryTurn[]
  loading: boolean
  error: string
  sessionId: string | null
  onClose: () => void
  onCopy: (text: string) => void
  onRetry: () => void
  t: Strings
  lang: Language
}) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return turns
    }
    return turns.filter((turn) =>
      `${turn.prompt}\n${turn.finalResult}`.toLowerCase().includes(q),
    )
  }, [turns, query])

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer history-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">{t.conversationLog} · {turns.length > 0 ? `${turns.length} ${turns.length === 1 ? t.message : t.messages}` : t.historyEyebrowNone}</div>
            <h2>{t.historyTitle} 🕘</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        <div className="history-toolbar">
          <input
            className="history-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.historySearchPlaceholder}
            aria-label={t.historySearchAria}
          />
          {query ? <button className="icon-button" onClick={() => setQuery("")} aria-label={t.clearSearch}>×</button> : null}
        </div>
        {loading ? (
          <div className="picker-loading"><span className="loader" /> {t.loadingHistory}</div>
        ) : error ? (
          <div className="empty-state">{error}<br /><button className="button button-secondary" onClick={onRetry}>{t.retry}</button></div>
        ) : turns.length === 0 ? (
          <div className="empty-state">{t.noHistoryYet}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">{t.noMatchFor} «{query}».<br />{t.tryAnotherWord}</div>
        ) : (
          <div className="history-list">
            {filtered.map((turn) => {
              const isOpen = expanded.has(turn.id)
              const result = turn.finalResult.trim()
              const isLong = result.length > 400
              const visibleResult = !isLong || isOpen ? result : `${result.slice(0, 400)}…`
              return (
                <article className="history-card" key={turn.id}>
                  <div className="history-card-top">
                    <span className="history-index">#{turn.index}</span>
                    <span className="history-date">{formatDateTime(turn.createdAt, lang)}</span>
                    {turn.steps > 0 ? <span className="history-steps">⚙️ {turn.steps} {turn.steps === 1 ? t.step : t.steps}</span> : null}
                  </div>
                  <div className="history-block history-question">
                    <div className="history-label">💬 {t.yourQuestion}</div>
                    <p>{turn.prompt || "—"}</p>
                    <button className="history-copy" onClick={() => onCopy(turn.prompt)}>{t.copyQuestion}</button>
                  </div>
                  <div className="history-block history-answer">
                    <div className="history-label">✅ {t.finalResult}</div>
                    {result ? (
                      <>
                        <div className="history-result-text">{visibleResult}</div>
                        <div className="history-actions">
                          {isLong ? (
                            <button className="history-copy" onClick={() => toggleExpanded(turn.id)}>
                              {isOpen ? `${t.showLess} ↑` : `${t.showMore} ↓`}
                            </button>
                          ) : null}
                          <button className="history-copy" onClick={() => onCopy(turn.finalResult)}>{t.copyResult}</button>
                        </div>
                      </>
                    ) : (
                      <div className="result-pending">{t.noFinalResultYet}</div>
                    )}
                    {sessionId && turn.files.length > 0 ? (
                      <div className="history-files">
                        <div className="history-label">📎 {t.files} ({turn.files.length})</div>
                        {turn.files.map((file) => (
                          <a
                            key={file.id}
                            className="file-part file-download-link"
                            href={fileDownloadUrl(sessionId, file)}
                            download={file.name}
                            rel="noopener"
                          >
                            ⬇ {file.name}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <div className="model-footnote">{t.historyNote}</div>
      </aside>
    </div>
  )
}
