import { useMemo } from "react"
<<<<<<< HEAD
import { EMPTY_GIT_FILES, GitBranchIcon, GitCommitIcon, GitPullIcon, GitPushIcon, GitRefreshIcon, GitRevertIcon, SpinnerIcon, gitStatusMeta, splitChangePath } from "../display"
import type { Strings } from "../i18n"
import type { GitChangeFile, GitChanges } from "../types"

export function GitChangesPanel({ changes, loading, busy, confirming, confirmingCommit, confirmingPush, confirmingPull, onRefresh, onCommit, onAskCommit, onCancelCommit, onPush, onAskPush, onCancelPush, onPull, onAskPull, onCancelPull, onAskRevertAll, onRevertAll, onCancelRevertAll, onRevertFile, onClose, t }: {
=======
import { EMPTY_GIT_FILES, GitBranchIcon, GitCommitIcon, GitCommitOnlyIcon, GitPullIcon, GitRefreshIcon, GitRevertIcon, SpinnerIcon, gitStatusMeta, splitChangePath } from "../display"
import type { Strings } from "../i18n"
import type { GitChangeFile, GitChanges } from "../types"

export function GitChangesPanel({ changes, loading, busy, confirming, confirmingPush, onRefresh, onCommitPush, onAskCommitPush, onCancelCommitPush, onCommit, onPull, onAskRevertAll, onRevertAll, onCancelRevertAll, onRevertFile, onClose, t }: {
>>>>>>> 98c21da5e8e1c142310ae293c0cb824998592340
  changes: GitChanges | null
  loading: boolean
  busy: boolean
  confirming: boolean
  confirmingCommit: boolean
  confirmingPush: boolean
  confirmingPull: boolean
  onRefresh: () => void
<<<<<<< HEAD
  onCommit: () => void
  onAskCommit: () => void
  onCancelCommit: () => void
  onPush: () => void
  onAskPush: () => void
  onCancelPush: () => void
  onPull: () => void
  onAskPull: () => void
  onCancelPull: () => void
=======
  onCommitPush: () => void
  onAskCommitPush: () => void
  onCancelCommitPush: () => void
  onCommit: () => void
  onPull: () => void
>>>>>>> 98c21da5e8e1c142310ae293c0cb824998592340
  onAskRevertAll: () => void
  onRevertAll: () => void
  onCancelRevertAll: () => void
  onRevertFile: (file: GitChangeFile) => void
  onClose: () => void
  t: Strings
}) {
  // قائمة الملفات المتغيّرة في git للمشروع الحالي، مع ملخص سريع فوقها
  const files = changes?.files ?? EMPTY_GIT_FILES
  const hasFiles = Boolean(changes?.available) && files.length > 0
  // الـ commit والتراجع محتاجين ملفات متغيّرة، لكن الـ push والـ pull مزامنة
  // فبيفضلوا شغّالين على شجرة نضيفة بعد الـ commit — القفل وقت أي تأكيد بس
  // عشان المستخدم ميضربش action تاني وهو بيأكد واحد شغّال.
<<<<<<< HEAD
  const confirmingAny = confirming || confirmingCommit || confirmingPush || confirmingPull
  const canAct = hasFiles && !loading && !busy && !confirmingAny
  const canSync = Boolean(changes?.available) && !loading && !busy && !confirmingAny
=======
  const idle = !loading && !busy && !confirming && !confirmingPush
  const canAct = hasFiles && idle
  // السحب مش محتاج تغييرات محلية — شغله الأساسي على مجلد نضيف، فبيشترط
  // إن المشروع git بس.
  const canPull = Boolean(changes?.available) && idle
>>>>>>> 98c21da5e8e1c142310ae293c0cb824998592340
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
              <GitBranchIcon /> {t.gitChangesBranch}: <span dir="ltr">{changes?.branch || t.gitChangesNoBranch}</span>
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
          <div className="git-toolbar-actions">
            <button className="icon-button" onClick={onRefresh} aria-label={t.refreshList} title={t.refreshList} disabled={loading}><GitRefreshIcon /></button>
<<<<<<< HEAD
            {/* زراري التراجع والـ commit والـ push والـ pull بيفضلوا ظاهرين حتى وقت
                التأكيد: الإخفاء كان بيحرّك التولبار ويلخبط العين، فالزرار المضغوط
                بيفضل ظاهر بس مقفول بـ canAct زي الباقي. */}
            <button
              type="button"
              className="icon-button git-revert-button"
              disabled={!canAct}
              onClick={onAskRevertAll}
              aria-label={t.gitRevertAll}
              title={t.gitRevertAll}
            >
              <GitRevertIcon />
            </button>
            <button
              type="button"
              className="icon-button git-commit-button"
              disabled={!canAct}
              onClick={onAskCommit}
              aria-busy={busy}
              aria-label={t.gitCommit}
              title={t.gitCommit}
            >
              {busy ? <SpinnerIcon /> : <GitCommitIcon />}
            </button>
            <button
              type="button"
              className="icon-button git-push-button"
              disabled={!canSync}
              onClick={onAskPush}
              aria-busy={busy}
              aria-label={t.gitPush}
              title={t.gitPush}
            >
              {busy ? <SpinnerIcon /> : <GitPushIcon />}
            </button>
            <button
              type="button"
              className="icon-button git-pull-button"
              disabled={!canSync}
              onClick={onAskPull}
              aria-busy={busy}
              aria-label={t.gitPull}
              title={t.gitPull}
            >
              {busy ? <SpinnerIcon /> : <GitPullIcon />}
            </button>
=======
            {/* أزرار الـ git كلها (التراجع، الـ commit، والـ push والسحب) بتفضل
                ظاهرة حتى لو مفيش تغييرات: زرار بيختفي وقت ما يبقى مفيش حاجة
                يعمله المستخدم بيدور عليه وميشوفش إن الأداة موجودة أصلاً.
                بتتقفل بـ canAct/canPull بدل ما تتشال من الشجرة. */}
            {!confirming ? (
              <>
                <button
                  type="button"
                  className="icon-button git-revert-button"
                  disabled={!canAct}
                  onClick={onAskRevertAll}
                  aria-label={t.gitRevertAll}
                  title={t.gitRevertAll}
                >
                  <GitRevertIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={!canAct}
                  onClick={onCommit}
                  aria-label={t.gitCommit}
                  title={t.gitCommit}
                >
                  <GitCommitOnlyIcon />
                </button>
                <button
                  type="button"
                  className="icon-button git-commit-button"
                  disabled={!canAct}
                  onClick={onAskCommitPush}
                  aria-busy={busy}
                  aria-label={t.gitCommitPush}
                  title={t.gitCommitPush}
                >
                  {busy ? <SpinnerIcon /> : <GitCommitIcon />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={!canPull}
                  onClick={onPull}
                  aria-label={t.gitPull}
                  title={t.gitPull}
                >
                  <GitPullIcon />
                </button>
              </>
            ) : null}
>>>>>>> 98c21da5e8e1c142310ae293c0cb824998592340
          </div>
        </div>
        {/* التراجع عن الكل مدمّر ومش بيرجع — عشان كده بيتأكد جوه الدرج بدل ما ينفّذ طول */}
        {confirming ? (
          <div className="git-confirm" role="alertdialog" aria-label={t.gitRevertAllConfirm}>
            <p className="git-confirm-text">{t.gitRevertAllConfirm}</p>
            <div className="git-confirm-actions">
              <button type="button" className="git-confirm-cancel" onClick={onCancelRevertAll} disabled={busy}>
                {t.cancel}
              </button>
              <button type="button" className="git-confirm-accept" onClick={onRevertAll} disabled={busy || !hasFiles}>
                {t.gitRevertAllConfirmYes}
              </button>
            </div>
          </div>
        ) : null}
        {/* الـ commit بيبعت رسالة للعميل — بيتأكد جوه الدرج بحالة منفصلة عن التراجع */}
        {confirmingCommit ? (
          <div className="git-confirm" role="alertdialog" aria-label={t.gitCommitConfirm}>
            <p className="git-confirm-text">{t.gitCommitConfirm}</p>
            <div className="git-confirm-actions">
              <button type="button" className="git-confirm-cancel" onClick={onCancelCommit} disabled={busy}>
                {t.cancel}
              </button>
              <button type="button" className="git-confirm-accept" onClick={onCommit} disabled={busy || !hasFiles}>
                {t.gitCommitConfirmYes}
              </button>
            </div>
          </div>
        ) : null}
        {/* الـ push بيعدّل الفرع البعيد، فبيتأكد جوه الدرج زي التراجع عن الكل */}
        {confirmingPush ? (
          <div className="git-confirm" role="alertdialog" aria-label={t.gitPushConfirm}>
            <p className="git-confirm-text">{t.gitPushConfirm}</p>
            <div className="git-confirm-actions">
              <button type="button" className="git-confirm-cancel" onClick={onCancelPush} disabled={busy}>
                {t.cancel}
              </button>
              <button type="button" className="git-confirm-accept" onClick={onPush} disabled={busy || !changes?.available}>
                {t.gitPushConfirmYes}
              </button>
            </div>
          </div>
        ) : null}
        {/* الـ pull بيعدّل الملفات المحلية بالبعيد، فبيتأكد كمان */}
        {confirmingPull ? (
          <div className="git-confirm" role="alertdialog" aria-label={t.gitPullConfirm}>
            <p className="git-confirm-text">{t.gitPullConfirm}</p>
            <div className="git-confirm-actions">
              <button type="button" className="git-confirm-cancel" onClick={onCancelPull} disabled={busy}>
                {t.cancel}
              </button>
              <button type="button" className="git-confirm-accept" onClick={onPull} disabled={busy || !changes?.available}>
                {t.gitPullConfirmYes}
              </button>
            </div>
          </div>
        ) : null}
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
                  <button
                    type="button"
                    className="git-file-revert"
                    onClick={() => onRevertFile(file)}
                    disabled={!canAct}
                    aria-label={`${t.gitRevertFile}: ${file.path}`}
                    title={t.gitRevertFile}
                  >
                    <GitRevertIcon />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="model-footnote">{t.gitChangesNote}</div>
      </aside>
    </div>
  )
}
