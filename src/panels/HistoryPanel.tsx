import { useMemo, useState } from "react"
import { fileDownloadUrl } from "../api"
import { MarkdownText } from "../components/MarkdownText"
import { parseMarkdownBlocks } from "../utils/markdown-table"
import { formatDateTime } from "../display"
import type { Language, Strings } from "../i18n"
import type { HistoryTurn } from "../types"

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
              // الرد اللي فيه جدول ما بنقصّوش نصيًا عشان الجدول يبان مرتّب؛
              // صندوق السجل بيسكول لوحده لما يطول.
              const hasTable = result.includes("|") && parseMarkdownBlocks(result).some((block) => block.kind === "table")
              const collapsible = result.length > 400 && !hasTable
              const visibleResult = collapsible && !isOpen ? `${result.slice(0, 400)}…` : result
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
                        <div className={collapsible && !isOpen ? "history-result-text is-collapsed" : "history-result-text"}>{collapsible && !isOpen ? visibleResult : <MarkdownText text={result} />}</div>
                        <div className="history-actions">
                          {collapsible ? (
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
