import { ApiError } from "./http"
import type { ResultFile } from "../types"

export function fileDownloadUrl(sessionId: string, file: Pick<ResultFile, "path" | "downloadUrl">): string {
  if (file.downloadUrl) {
    return file.downloadUrl
  }
  return `/api/session/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(file.path)}`
}

export async function downloadResultFile(sessionId: string, file: ResultFile): Promise<void> {
  const url = fileDownloadUrl(sessionId, file)
  if (/^(data:|blob:|https?:)/i.test(url)) {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = file.name || "file"
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return
  }
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) {
    let message = `Download failed (${response.status})`
    try {
      const payload = (await response.json()) as { message?: string }
      if (payload.message) {
        message = payload.message
      }
    } catch {
      // Keep default message for binary error responses.
    }
    throw new ApiError(message, response.status)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement("a")
    anchor.href = objectUrl
    anchor.download = file.name || "file"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
  }
}

export async function shareResultFile(sessionId: string, file: ResultFile): Promise<boolean> {
  if (typeof navigator.share !== "function") {
    return false
  }
  const url = fileDownloadUrl(sessionId, file)
  if (/^(data:|blob:|https?:)/i.test(url)) {
    await navigator.share({ title: file.name, text: file.name, url })
    return true
  }
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) {
    throw new ApiError(`Download failed (${response.status})`, response.status)
  }
  const blob = await response.blob()
  const shareFile = new File([blob], file.name || "file", { type: blob.type || file.mime || "application/octet-stream" })
  const navigatorWithShare = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (navigatorWithShare.canShare && !navigatorWithShare.canShare({ files: [shareFile] })) {
    await navigator.share({ title: file.name, text: file.name, url: window.location.href })
    return true
  }
  await navigator.share({ title: file.name, text: file.name, files: [shareFile] })
  return true
}
