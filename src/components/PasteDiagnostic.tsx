import { useEffect, useRef, useState } from "react"

// صفحة تشخيص مؤقتة تُفتح على /paste-test بدون تسجيل دخول. بتطبع كل أحداث
// اللصق (paste / beforeinput / input) وبتعرض بيانات الحافظة عشان نعرف
// المتصفح بيسلّم الصورة إزاي. تُحذف بعد التشخيص.
function describeDataTransfer(dataTransfer: DataTransfer | null): string {
  if (!dataTransfer) {
    return "null"
  }
  const types = Array.from(dataTransfer.types ?? [])
  const items = Array.from(dataTransfer.items ?? []).map((item) => {
    let hasFile = false
    try {
      hasFile = Boolean(item.getAsFile())
    } catch {
      hasFile = false
    }
    return `${item.kind}:${item.type}:${hasFile ? "file" : "null"}`
  })
  const files = Array.from(dataTransfer.files ?? []).map((file) => `${file.name}|${file.type}|${file.size}`)
  return JSON.stringify({ types, items, files })
}

export function PasteDiagnostic() {
  const logRef = useRef<HTMLDivElement>(null)
  const editableRef = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<string[]>(() => {
    const header = [`UA: ${navigator.userAgent}`]
    const uaData = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string; version: string }> } }).userAgentData
    if (uaData?.brands) {
      header.push(`brands: ${uaData.brands.map((brand) => `${brand.brand} ${brand.version}`).join(", ")}`)
    }
    header.push(`secureContext: ${String(window.isSecureContext)}`)
    header.push(`clipboard.read: ${String(typeof navigator.clipboard?.read === "function")}`)
    header.push("---")
    return header
  })

  const log = (message: string): void => {
    setLines((current) => [...current, message])
  }

  useEffect(() => {
    const editable = editableRef.current
    if (!editable) {
      return
    }

    const onPaste = (event: ClipboardEvent): void => {
      log("[paste]")
      log(` clipboardData: ${describeDataTransfer(event.clipboardData)}`)
      try {
        log(` text/plain length: ${(event.clipboardData?.getData("text/plain") ?? "").length}`)
      } catch (error) {
        log(` getData error: ${(error as Error).message}`)
      }
      if (typeof navigator.clipboard?.read === "function") {
        navigator.clipboard.read()
          .then((items) => log(` clipboard.read -> ${items.map((item) => Array.from(item.types).join("+")).join(" / ")}`))
          .catch((error: Error) => log(` clipboard.read error: ${error.name} ${error.message}`))
      }
    }
    const onBeforeInput = (event: Event): void => {
      const input = event as InputEvent
      log(`[beforeinput] inputType=${input.inputType}`)
      log(` dataTransfer: ${describeDataTransfer(input.dataTransfer)}`)
    }
    const onInput = (event: Event): void => {
      const input = event as InputEvent
      log(`[input] inputType=${input.inputType} imgs=${editable.querySelectorAll("img").length}`)
      log(` dataTransfer: ${describeDataTransfer(input.dataTransfer)}`)
    }

    editable.addEventListener("paste", onPaste)
    editable.addEventListener("beforeinput", onBeforeInput)
    editable.addEventListener("input", onInput)
    return () => {
      editable.removeEventListener("paste", onPaste)
      editable.removeEventListener("beforeinput", onBeforeInput)
      editable.removeEventListener("input", onInput)
    }
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines])

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, background: "#0b1020", color: "#e8e8ef", minHeight: "100vh", boxSizing: "border-box" }}>
      <h1 style={{ fontSize: 18 }}>تشخيص لصق الصور</h1>
      <p style={{ color: "#aab", fontSize: 14, lineHeight: 1.6 }}>
        اضغط داخل المربع المتقطّع، ثم الصق الصورة (لصق مطوّل أو من الكيبورد)، وشارك السجل الظاهر تحت.
      </p>
      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        style={{ minHeight: 140, margin: "14px 0", padding: 12, border: "2px dashed #6b6b90", borderRadius: 10, background: "#151a2e" }}
      />
      <button
        type="button"
        onClick={() => setLines([])}
        style={{ font: "inherit", padding: "8px 12px", borderRadius: 8, border: "1px solid #6b6b90", background: "#1d2440", color: "#e8e8ef" }}
      >
        امسح السجل
      </button>
      <div
        ref={logRef}
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.5, background: "#05070f", color: "#6ee7b7", padding: 12, borderRadius: 10, direction: "ltr", textAlign: "left", maxHeight: "55vh", overflow: "auto", marginTop: 12 }}
      >
        {lines.join("\n")}
      </div>
    </div>
  )
}
