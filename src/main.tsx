import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { PasteDiagnostic } from "./components/PasteDiagnostic"
import { applyTheme, getSavedTheme } from "./theme"
import { applyLanguage, getSavedLanguage } from "./i18n"
import "./styles.css"

applyTheme(getSavedTheme())
applyLanguage(getSavedLanguage())

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // updateViaCache: "none" — يضمن إن sw.js يتقرأ من الشبكة دايمًا
    // من غير ما المتصفح يخدم له نسخة قديمة من الكاش
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error) => {
        console.error("Service worker registration failed", error)
      })

    // الـ SW بيعمل skipWaiting + clients.claim، فلازم نعمل reload مرة واحدة
    // عشان التبويبات المفتوحة تشغّل الحزمة الجديدة بدل القديمة
    let reloading = false
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) {
        return
      }
      reloading = true
      window.location.reload()
    })
  })
}

// /paste-test أو ?pasteTest=1: صفحة تشخيص مؤقتة (بدون تسجيل دخول) للصق الصور.
const pasteTestParams = new URLSearchParams(window.location.search)
const isPasteTest = window.location.pathname.replace(/\/+$/, "") === "/paste-test"
  || pasteTestParams.get("pasteTest") === "1"
  || window.location.hash === "#paste-test"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPasteTest ? <PasteDiagnostic /> : <App />}
  </StrictMode>,
)
