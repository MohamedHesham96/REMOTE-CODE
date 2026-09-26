import { useMemo } from "react"
import { EMPTY_GIT_FILES, gitStatusMeta, splitChangePath } from "../display"
import type { Strings } from "../i18n"
import type { GitChanges } from "../types"

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
