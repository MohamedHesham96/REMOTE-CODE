import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    // لازم 0.0.0.0 عشان الموبايل يوصل من نفس Wi-Fi — لا تغيّرها لـ localhost
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // الموبايل بيفتح بـ IP مباشر (192.168.x.x) فاقبل أي host بدل حظر Vite الافتراضي
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7171",
        changeOrigin: true,
        ws: true,
        timeout: 30000,
        configure: (proxy) => {
          // الباك دلوقتي بيفتح بورت 7171 فورًا ويفضل شغال، فالخطأ هنا معناه
          // لحظة بدء فقط — اطبع تنبيه عربي واضح بدل سيل ECONNREFUSED، ومتوقّعش Vite.
          proxy.on("error", (err, _req, res) => {
            const target = "127.0.0.1:7171"
            if ("code" in err && (err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
              console.error(`[vite] الباك (${target}) لسه بيقوم — استنى ثواني وحدّث الصفحة (ECONNREFUSED)`)
            } else {
              console.error(`[vite] proxy error /api -> ${target}:`, err instanceof Error ? err.message : err)
            }
            const nodeRes = res as unknown as { writeHead?: unknown; end?: unknown } | undefined
            if (
              nodeRes
              && typeof nodeRes.writeHead === "function"
              && typeof nodeRes.end === "function"
              && !(res as { headersSent?: boolean }).headersSent
            ) {
              try {
                (nodeRes.writeHead as (status: number, headers: Record<string, string>) => void)(503, { "Content-Type": "application/json" })
                ;(nodeRes.end as (body: string) => void)(
                  JSON.stringify({
                    error: "BACKEND_STARTING",
                    message: "السيرفر لسه بيقوم — استنى 5 ثواني وحدّث الصفحة",
                  }),
                )
              } catch {
                // تجاهل — الرد قد يكون اتقفل
              }
            }
          })
        },
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  build: {
    sourcemap: true,
  },
})
