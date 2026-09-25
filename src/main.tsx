import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { applyTheme, getSavedTheme } from "./theme"
import "./styles.css"

applyTheme(getSavedTheme())

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed", error)
    })
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
