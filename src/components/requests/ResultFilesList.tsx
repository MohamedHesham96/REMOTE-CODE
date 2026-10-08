import { useState } from "react"
import { downloadResultFile, fileDownloadUrl, shareResultFile } from "../../api"
import { CopyButton } from "../CopyButton"
import type { Strings } from "../../i18n"
import type { ResultFile, ToastKind } from "../../types"

// ملفات النتيجة النهائية: الاسم أولًا، وتحته المسار الكامل إن ورد من بيانات
// المحرك فعلًا، وإلا فالمسار النسبي كما هو مع تنبيه أن الكامل غير متاح.
// الضغط على المسار يبدّل بين القصّ بصريًا والعرض الكامل، والنسخ متاح دائمًا
// بالقيمة الأصلية كاملة (المخزّنة داخليًا بلا قص).
export function ResultFilesList({ files, sessionId, onToast, onCopy, t }: { files: ResultFile[]; sessionId: string; onToast: (message: string, kind?: ToastKind) => void; onCopy: (text: string) => void; t: Strings }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const canShare = typeof navigator.share === "function"

  if (files.length === 0) {
    return null
  }

  const handleDownload = async (file: ResultFile) => {
    setBusyId(file.id)
    try {
      await downloadResultFile(sessionId, file)
      // المتصفح بيبيّن التحميل بعينك — من غير toast نجاح
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : t.downloadFailed, "error")
    } finally {
      setBusyId(null)
    }
  }

  const handleShare = async (file: ResultFile) => {
    setBusyId(file.id)
    try {
      const shared = await shareResultFile(sessionId, file)
      if (!shared) {
        await handleDownload(file)
      }
      // اتشارك/اتحمّل وشايفه بعينك — من غير toast نجاح
    } catch (error: unknown) {
      if (error instanceof Error && /abort|cancel/i.test(error.message)) {
        return
      }
      onToast(error instanceof Error ? error.message : t.shareFailed, "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="result-files">
      <div className="final-result-label">{t.resultFilesTitle} ({files.length})</div>
      <div className="result-files-list">
        {files.map((file) => {
          const fullPath = (file.fullPath || "").trim()
          const displayPath = fullPath || file.path || ""
          const expanded = expandedId === file.id
          return (
            <div className="result-file-item" key={file.id}>
              <span className="result-file-icon" aria-hidden>📄</span>
              <span className="result-file-body">
                <strong title={file.name}>{file.name}</strong>
                <small className="result-file-meta">{file.mime}</small>
                {displayPath ? (
                  <>
                    <span className="result-file-path-row">
                      <button
                        type="button"
                        className={`result-file-path${expanded ? " is-expanded" : ""}`}
                        dir="ltr"
                        title={displayPath}
                        aria-expanded={expanded}
                        onClick={() => setExpandedId((current) => (current === file.id ? null : file.id))}
                      >
                        {displayPath}
                      </button>
                      <CopyButton text={displayPath} onCopy={onCopy} label={t.copyPath} className="result-file-path-copy" t={t} />
                    </span>
                    {!fullPath ? <small className="result-file-path-note">{t.fullPathUnavailable}</small> : null}
                  </>
                ) : null}
              </span>
              <span className="result-file-actions">
                <a
                  className="button button-secondary"
                  href={fileDownloadUrl(sessionId, file)}
                  download={file.name}
                  rel="noopener"
                >
                  {t.open}
                </a>
                <button
                  className="button button-primary"
                  disabled={busyId === file.id}
                  onClick={() => void handleDownload(file)}
                >
                  {busyId === file.id ? "…" : t.download}
                </button>
                {canShare ? (
                  <button
                    className="button button-ghost"
                    disabled={busyId === file.id}
                    onClick={() => void handleShare(file)}
                    aria-label={`${t.share} ${file.name}`}
                  >
                    {t.share}
                  </button>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
      <div className="result-files-hint">{t.resultFilesHint}</div>
    </div>
  )
}
