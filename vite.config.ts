import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const backendPort = Number.parseInt(env.APP_PORT?.trim() || "7171", 10) || 7171
  const backendTarget = `http://127.0.0.1:${backendPort}`
  return {
  plugins: [react()],
  // وضع هادئ: إخفاء سطور "ready" وإعادة التحسين — التحذيرات والأخطاء تظهر فقط
  logLevel: "warn",
  clearScreen: false,
  server: {
    // لازم 0.0.0.0 عشان الموبايل يوصل من نفس Wi-Fi — لا تغيّرها لـ localhost
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // HMR عبر LAN: الموبايل فاتح بـ IP (192.168.x.x) فلازم الـ WebSocket
    // يرجع لنفس hostname اللي جاي منه المتصفح، على نفس بورت 5173.
    // من غير clientPort الموبايل بيحاول يكلم localhost فالتحديث الفوري بيقف
    // وبتضطر تعمل refresh يدوي.
    hmr: {
      clientPort: 5173,
    },
    // الموبايل بيفتح بـ IP مباشر (192.168.x.x) فاقبل أي host بدل حظر Vite الافتراضي
    allowedHosts: true,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
        timeout: 30000,
        configure: (proxy) => {
          // الباك بيفتح فورًا ويفضل شغال، فالخطأ هنا معناه
          // لحظة بدء فقط — اطبع تنبيه عربي واضح بدل سيل ECONNREFUSED، ومتوقّعش Vite.
          proxy.on("error", (err, _req, res) => {
            const target = `127.0.0.1:${backendPort}`
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
    // لا sourcemaps في الإنتاج: كانت ~1.2MB تُبنى وتُخدم مع كل تحميل.
    // للتشخيص استخدم `vite build --sourcemap` يدويًا عند الحاجة فقط.
    sourcemap: false,
    rollupOptions: {
      output: {
        // React في chunk مستقل طويل الكاش + لوحات panels في chunk يُحمّل عند الطلب
        manualChunks: (id) => {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "vendor"
          }
          return undefined
        },
      },
    },
  },
  }
})
