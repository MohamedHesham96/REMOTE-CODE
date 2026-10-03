import { useMemo } from "react"
import { EMPTY_GIT_FILES, GitBranchIcon, GitCommitIcon, GitCommitOnlyIcon, GitPullIcon, GitRefreshIcon, GitRevertIcon, SpinnerIcon, gitStatusMeta, splitChangePath } from "../display"
import type { Strings } from "../i18n"
import type { GitChangeFile, GitChanges } from "../types"

export function GitChangesPanel({ changes, loading, busy, confirming, confirmingPush, onRefresh, onCommitPush, onAskCommitPush, onCancelCommitPush, onCommit, onPull, onAskRevertAll, onRevertAll, onCancelRevertAll, onRevertFile, onClose, t }: {
  changes: GitChanges | null
  loading: boolean
  busy: boolean
  confirming: boolean
  confirmingPush: boolean
  onRefresh: () => void
  onCommitPush: () => void
  onAskCommitPush: () => void
  onCancelCommitPush: () => void
  onCommit: () => void
  onPull: () => void
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
  // كل أزرار التحكم بتتقفل لما مفيش ملفات، وبتتقفل كمان وقت أي تأكيد
  // عشان المستخدم ميضربش action تاني وهو بيأكد واحد شغّال.
  const idle = !loading && !busy && !confirming && !confirmingPush
  const canAct = hasFiles && idle
  // السحب مش محتاج تغييرات محلية — شغله الأساسي على مجلد نضيف، فبيشترط
  // إن المشروع git بس.
  const canPull = Boolean(changes?.available) && idle
  // عدد الـ commits اللي لسه على الفرع المحلي ومش وصلتش للفرع البعيد. صفر
  // معناه "مفيش حاجة مستنية push" أو "مفيش upstream متظبط" — والاتنين
  // معناه إننا متكلّمين عن push أصلاً فمفيش حاجة نلفت النظر ليها.
  const unpushed = changes?.unpushed ?? 0
  // زرار commit & push بيفضل شغال على شجرة نضيفة لو فيه commits مستنية
  // الـ push: الحاجة المطلوبة (الـ push) موجودة حتى لو مفيش ملفات.
  const canPush = idle && Boolean(changes?.available) && (hasFiles || unpushed > 0)
  // الرقم في نص الزر (aria-label) كمان: الشارة مرئية للعين بس،
  // فبدونها قارئ الشاشة هيسمع "commit & push" من غير أي رقم. والاسم
  // بيتغيّر لـ "push" لما مفيش حاجة تتعملها commit عشان الزرار مايوعدش
  // بحاجة مش هتحصل.
  const pushLabel = unpushed > 0
    ? `${hasFiles ? t.gitCommitPush : t.gitPush} — ${unpushed} ${unpushed === 1 ? t.gitUnpushedOne : t.gitUnpushedMany}`
    : t.gitCommitPush
  const pushConfirm = t.gitPushConfirm.replace("{count}", String(unpushed))
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
                  className="icon-button git-push-button"
                  disabled={!canPush}
                  onClick={onAskCommitPush}
                  aria-busy={busy}
                  aria-label={pushLabel}
                  title={pushLabel}
                >
                  {busy ? <SpinnerIcon /> : <GitCommitIcon />}
                  {/* شارة عدد الـ commits غير المدفوعة. بتظهر فوق زرار
                      commit & push لأنها هي اللي بتدفع، وزرار commit لوحده
                      مش بيعمل push فالشارة عليه كانت هتكذب. */}
                  {unpushed > 0 ? <span className="count-badge git-push-badge">{unpushed}</span> : null}
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
        {/* الـ push بيعدّل الفرع البعيد، فبيتأكد جوه الدرج زي التراجع عن الكل.
            النص بيتبع اللي هيحصل فعلًا: فيه ملفات ⇒ commit و push، وشجرة
            نضيفة ⇒ push بس. تأكيد بيقول "commit" وحاجة مش موجودة بيوهّم. */}
        {confirmingPush ? (
          <div className="git-confirm" role="alertdialog" aria-label={hasFiles ? t.gitCommitPushConfirm : pushConfirm}>
            <p className="git-confirm-text">{hasFiles ? t.gitCommitPushConfirm : pushConfirm}</p>
            <div className="git-confirm-actions">
              <button type="button" className="git-confirm-cancel" onClick={onCancelCommitPush} disabled={busy}>
                {t.cancel}
              </button>
              <button type="button" className="git-confirm-accept" onClick={onCommitPush} disabled={busy || (!hasFiles && unpushed === 0)}>
                {t.gitCommitPushConfirmYes}
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
