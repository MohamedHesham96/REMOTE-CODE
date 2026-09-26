import express, { type Express } from "express"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

// سياسة كاش: ملفات /assets فيها hash فصالحة للأبد، والـ SW والـ manifest
// لازم no-cache عشان التحديثات توصل من أول refresh.
// مستخرجة من server/index.ts بدون تغيير في السلوك.
export function registerStatic(app: Express): void {
  const distDirectory = resolve(process.cwd(), "dist")
  if (!existsSync(distDirectory)) {
    return
  }
  app.use(express.static(distDirectory, {
    index: false,
    setHeaders: (response, filePath) => {
      const relative = filePath.replace(distDirectory, "").replace(/\\/g, "/")
      if (relative.startsWith("/assets/")) {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable")
      } else if (relative === "/sw.js" || relative.endsWith(".webmanifest")) {
        response.setHeader("Cache-Control", "no-cache")
      }
    },
  }))
  app.use((request, response, next) => {
    if (request.method === "GET" && !request.path.startsWith("/api/")) {
      response.setHeader("Cache-Control", "no-cache")
      response.sendFile(join(distDirectory, "index.html"))
      return
    }
    next()
  })
}
