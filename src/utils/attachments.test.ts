import { describe, expect, it } from "vitest"
import type { ComposerAttachment, ModelInfo } from "../types"
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  attachmentLimitError,
  attachmentModality,
  documentAccept,
  formatBytes,
  modelSupports,
} from "./attachments"

function model(input?: string[]): ModelInfo {
  return {
    id: "m",
    providerID: "p",
    name: "M",
    free: false,
    enabled: true,
    ...(input ? { capabilities: { input } } : {}),
  }
}

function attachment(size: number): ComposerAttachment {
  return { id: "a", name: "f.txt", mime: "text/plain", size, uri: "data:text/plain;base64,AA==" }
}

describe("attachmentModality", () => {
  it("يصنّف الصور والـ PDF والنص حسب النوع أو الامتداد", () => {
    expect(attachmentModality("photo.png", "image/png")).toBe("image")
    expect(attachmentModality("doc.pdf", "application/pdf")).toBe("pdf")
    expect(attachmentModality("notes.txt", "text/plain")).toBe("text")
    expect(attachmentModality("data.json", "")).toBe("text")
    expect(attachmentModality("main.ts", "application/octet-stream")).toBe("text")
  })

  it("يرفض الأنواع غير المدعومة", () => {
    expect(attachmentModality("archive.zip", "application/zip")).toBeNull()
    expect(attachmentModality("app.exe", "application/octet-stream")).toBeNull()
  })
})

describe("modelSupports", () => {
  it("النص متاح دايماً حتى للنموذج النصي", () => {
    expect(modelSupports(model(["text"]), "text")).toBe(true)
    expect(modelSupports(null, "text")).toBe(true)
  })

  it("الصورة وPDF حسب قدرات الإدخال", () => {
    const vision = model(["text", "image", "pdf"])
    expect(modelSupports(vision, "image")).toBe(true)
    expect(modelSupports(vision, "pdf")).toBe(true)

    const textOnly = model(["text"])
    expect(modelSupports(textOnly, "image")).toBe(false)
    expect(modelSupports(textOnly, "pdf")).toBe(false)
  })

  it("غياب القدرات = الصور وPDF غير مدعومة", () => {
    expect(modelSupports(model(), "image")).toBe(false)
    expect(modelSupports(model(), "pdf")).toBe(false)
  })
})

describe("documentAccept", () => {
  it("PDF يتضاف للقبول بس لما النموذج يدعمه", () => {
    expect(documentAccept(true)).toContain(".pdf")
    expect(documentAccept(false)).not.toContain(".pdf")
    expect(documentAccept(false)).toContain(".txt")
  })
})

describe("attachmentLimitError", () => {
  it("يرفض الزيادة عن العدد الأقصى", () => {
    const existing = Array.from({ length: MAX_ATTACHMENT_COUNT }, () => attachment(1))
    expect(attachmentLimitError(existing, 1)).toBe("tooMany")
  })

  it("يرفض الملف الأكبر من حد المرفق الواحد", () => {
    expect(attachmentLimitError([], MAX_ATTACHMENT_BYTES + 1)).toBe("tooLarge")
  })

  it("يرفض تجاوز الحجم الكلي", () => {
    const existing = [attachment(MAX_ATTACHMENT_BYTES), attachment(MAX_ATTACHMENT_BYTES)]
    expect(attachmentLimitError(existing, MAX_ATTACHMENT_BYTES)).toBe("totalTooLarge")
  })

  it("يقبل الملف الصغير ضمن الحدود", () => {
    expect(attachmentLimitError([attachment(1024)], 2048)).toBeNull()
  })
})

describe("formatBytes", () => {
  it("يعرض البايت والكيلوبايت والميجابايت", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2 KB")
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB")
  })
})
