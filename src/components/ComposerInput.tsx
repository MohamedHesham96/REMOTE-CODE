import { useCallback, useEffect, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent, type RefObject } from "react"
import { COMPOSER_MAX_LINES } from "../constants"
import { clipboardFiles, readClipboardFiles } from "../utils/attachments"
import { isTouchComposer } from "../utils/device"

interface ComposerInputProps {
  value: string
  placeholder: string
  inputRef: RefObject<HTMLDivElement | null>
  onChange: (value: string) => void
  onSubmit: () => void
  onFiles: (files: File[]) => void
}

// حقل الكتابة كمحرر نصي (contenteditable) بدل textarea. السبب إن المتصفحات
// على الموبايل ما بتوصّلش صور الحافظة لحقل textarea أصلاً (كروم بيقول
// "does not support image pasting here")، لكنها بتلزقها بنفسها في محرر قابل
// للتحرير — فبنسيب الفعل الافتراضي يحصل ثم نجمع الصور من المحرر.
export function ComposerInput({ value, placeholder, inputRef, onChange, onSubmit, onFiles }: ComposerInputProps) {
  // آخر نص صدّرناه بنفسنا. بنفرّق بيه بين تعديل المستخدم جوه الحقل (نسيبه
  // زي ما هو ونحافظ على مكان المؤشر) والتعديل القادم من بره (المايك/اقتراح)
  // اللي لازم يتكتب في الحقل.
  const lastEmitted = useRef(value)

  const resize = useCallback(() => {
    const element = inputRef.current
    if (!element) {
      return
    }
    element.style.height = "auto"
    const styles = window.getComputedStyle(element)
    const lineHeight = Number.parseFloat(styles.lineHeight) || Number.parseFloat(styles.fontSize) * 1.5 || 22
    const maxHeight = Math.round(lineHeight * COMPOSER_MAX_LINES)
    const contentHeight = element.scrollHeight
    element.style.height = `${Math.min(contentHeight, maxHeight)}px`
    element.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden"
  }, [inputRef])

  const emit = useCallback(() => {
    const element = inputRef.current
    if (!element) {
      return
    }
    const next = element.innerText
    lastEmitted.current = next
    onChange(next)
    resize()
  }, [inputRef, onChange, resize])

  useEffect(() => {
    const element = inputRef.current
    if (!element) {
      return
    }
    if (value !== lastEmitted.current) {
      element.innerText = value
      if (value === "") {
        // من غير مسح ده سيبقى <br> والمكان الفاضي ما يظهرش كـ :empty
        element.innerHTML = ""
      }
      lastEmitted.current = value
    }
    resize()
  }, [value, inputRef, resize])

  const handleInput = (event: FormEvent<HTMLDivElement>) => {
    const element = inputRef.current
    if (element && element.innerText === "") {
      element.innerHTML = ""
    }
    // مسار كروم 143+: حدث الإدخال نفسه بيحمل الملفات في dataTransfer
    const native = event.nativeEvent as InputEvent
    const dataTransfer = native.dataTransfer
    if (dataTransfer) {
      const files = clipboardFiles(dataTransfer)
      if (files.length > 0) {
        onFiles(files)
      }
    }
    if (native.inputType === "insertFromPaste") {
      // أي صورة لزقها المتصفح بنفسه نجمّعها ونشيلها من المحرر
      window.setTimeout(() => void harvestImages(), 0)
    }
    emit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter يبعت على الديسكتوب بس؛ على الموبايل يسلك سطر جديد. isComposing
    // عشان تكملة الكلمات (عربي/إنجليزي) ما تتبعتش كطلب.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !isTouchComposer()) {
      event.preventDefault()
      onSubmit()
    }
  }

  // جمع الصور اللي المتصفح لزقها بنفسه في المحرر: كل <img> بيتحوّل لملف
  // وينشال من المحرر، والنص المتبقي يتزامن.
  const harvestImages = useCallback(async () => {
    const element = inputRef.current
    if (!element) {
      return
    }
    const images = Array.from(element.querySelectorAll("img"))
    if (images.length === 0) {
      return
    }
    const files: File[] = []
    for (const image of images) {
      const source = image.getAttribute("src")
      image.remove()
      if (!source) {
        continue
      }
      try {
        const response = await fetch(source)
        const blob = await response.blob()
        const type = blob.type || "image/png"
        const extension = type.split("/")[1] || "png"
        files.push(new File([blob], `clipboard.${extension}`, { type }))
      } catch {
        // صورة تعذّرت قراءتها — نتجاهلها بدل ما نكسر اللصق
      }
    }
    emit()
    if (files.length > 0) {
      onFiles(files)
    }
  }, [inputRef, emit, onFiles])

  // إدراج وسائط من الموبايل (كروم 149 بيوصّل صور/ملصقات لوحة المفاتيح عبر
  // مسار الإدخال): قبلinput/input بيجيبوا الملفات في dataTransfer. بنمسكهم
  // قبل ما يتلزقوا في المحرر عشان يتحوّلوا مرفقات.
  useEffect(() => {
    const element = inputRef.current
    if (!element) {
      return
    }
    const handleBeforeInput = (event: InputEvent): void => {
      const dataTransfer = event.dataTransfer
      if (!dataTransfer) {
        return
      }
      const files = clipboardFiles(dataTransfer)
      if (files.length === 0) {
        return
      }
      event.preventDefault()
      onFiles(files)
    }
    element.addEventListener("beforeinput", handleBeforeInput)
    return () => element.removeEventListener("beforeinput", handleBeforeInput)
  }, [inputRef, onFiles])

  // إدراج نص عادي عند نقطة المؤشر. insertText بتشمله الـ undo وتولّد حدث
  // input، ولو المتصفح رفضها (execCommand مهملة) بنستخدم Range يدوي.
  const insertPlainText = (text: string): void => {
    if (document.execCommand("insertText", false, text)) {
      return
    }
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      selection.deleteFromDocument()
      const node = document.createTextNode(text)
      selection.getRangeAt(0).insertNode(node)
      selection.collapseToEnd()
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const clipboard = event.clipboardData
    const files = clipboard ? clipboardFiles(clipboard) : []
    if (files.length > 0) {
      event.preventDefault()
      onFiles(files)
      return
    }
    const text = clipboard?.getData("text/plain") ?? ""
    if (text) {
      // نص عادي مش HTML عشان المحرر يفضل نصي ومفيهوش تنسيق غريب
      event.preventDefault()
      insertPlainText(text)
      emit()
      return
    }
    // لا ملفات ولا نص: على الأغلب صورة (خصوصاً على الموبايل). بنمنع الفعل
    // الافتراضي عشان ما تظهرش رسالة "Chrome does not support image pasting
    // here"، وبنجرب نقرا الحافظة من سياق اللصق الموثوق نفسه. لو ماوصلناش
    // حاجة بنجمّع أي صورة يكون المتصفح لزقها بنفسه.
    event.preventDefault()
    void readClipboardFiles().then((imageFiles) => {
      if (imageFiles.length > 0) {
        onFiles(imageFiles)
        return
      }
      void harvestImages()
    })
  }

  return (
    <div
      ref={inputRef}
      className="composer-input"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  )
}
