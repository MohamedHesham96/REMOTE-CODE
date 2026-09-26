import { useState } from "react"
import { downloadResultFile, fileDownloadUrl, shareResultFile } from "../../api"
import type { Strings } from "../../i18n"
import type { ResultFile, ToastKind } from "../../types"

export function ResultFilesList({ files, sessionId, onToast, t }: { files: ResultFile[]; sessionId: string; onToast: (message: string, kind?: ToastKind) => void; t: Strings }) {
  const [busyId, setBusyId] = useState<string | null>(null)
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
        {files.map((file) => (
          <div className="result-file-item" key={file.id}>
            <span className="result-file-icon" aria-hidden>📄</span>
            <span className="result-file-body">
              <strong title={file.path || file.name}>{file.name}</strong>
              <small>{file.mime}{file.path ? ` · ${file.path}` : ""}</small>
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
        ))}
      </div>
      <div className="result-files-hint">{t.resultFilesHint}</div>
    </div>
  )
}
