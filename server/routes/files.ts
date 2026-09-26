import type { Express } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

export function registerFileRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/session/:id/file", async (request, response) => {
    try {
      const filePath = typeof request.query.path === "string" ? request.query.path : ""
      if (!filePath.trim()) {
        response.status(400).json({ error: "FILE_PATH_REQUIRED", message: serverMessage("filePathRequired", getServerLang(request)) })
        return
      }
      const file = await ctx.openCode.openResultFile(request.params.id, filePath)
      const stream = file.stream as NodeJS.ReadableStream & { destroy?: (error?: Error) => void }
      const onStreamError = (error: unknown): void => {
        try {
          stream.destroy?.(error instanceof Error ? error : new Error("Stream failed"))
        } catch {
          // ignore
        }
        if (!response.headersSent) {
          response.status(500).end()
        } else {
          response.end()
        }
      }
      ;(stream as { once?: (event: string, listener: (error: unknown) => void) => void }).once?.("error", onStreamError)
      request.on("close", () => {
        try {
          stream.destroy?.()
        } catch {
          // ignore
        }
      })
      response.setHeader("Content-Type", file.mime)
      response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
      response.setHeader("Cache-Control", "no-store")
      response.setHeader("Accept-Ranges", "bytes")
      const range = typeof request.headers.range === "string" ? request.headers.range : ""
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (match) {
        const total = file.size
        const start = match[1] ? Number.parseInt(match[1], 10) : Math.max(0, total - (match[2] ? Number.parseInt(match[2], 10) : 0))
        const end = match[2] ? Number.parseInt(match[2], 10) : total - 1
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= total) {
          response.setHeader("Content-Range", `bytes */${total}`)
          response.status(416).end()
          try {
            stream.destroy?.()
          } catch {
            // ignore
          }
          return
        }
        const clampedEnd = Math.min(end, total - 1)
        response.status(206)
        response.setHeader("Content-Range", `bytes ${start}-${clampedEnd}/${total}`)
        response.setHeader("Content-Length", String(clampedEnd - start + 1))
        let remaining = clampedEnd - start + 1
        let skipped = 0
        const { Transform } = await import("node:stream")
        const ranger = new Transform({
          transform(chunk: Buffer, _encoding, callback): void {
            if (remaining <= 0) {
              callback(null, null)
              return
            }
            let from = 0
            if (skipped < start) {
              from = Math.min(chunk.length, start - skipped)
              skipped += from
            }
            const left = chunk.length - from
            const take = Math.min(left, remaining)
            remaining -= take
            callback(null, take > 0 ? chunk.subarray(from, from + take) : null)
            if (remaining <= 0) {
              try {
                stream.destroy?.()
              } catch {
                // ignore
              }
            }
          },
        })
        ;(stream as unknown as { pipe: (dest: unknown) => void }).pipe(ranger)
        ranger.pipe(response)
        return
      }
      response.setHeader("Content-Length", String(file.size))
      ;(stream as unknown as { pipe: (dest: unknown) => void }).pipe(response)
    } catch (error) {
      const message = error instanceof Error ? error.message : "File download failed"
      const status = /not found/i.test(message) ? 404 : 400
      response.status(status).json({ error: "FILE_DOWNLOAD_FAILED", message })
    }
  })
}
