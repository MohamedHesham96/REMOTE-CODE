import { describe, expect, it } from "vitest"
import {
  MAX_ATTACHMENT_COUNT,
  attachmentModality,
  mimeFromDataUri,
  parseRequestAttachments,
  unsupportedAttachment,
} from "./attachments.js"

const IMAGE = "data:image/png;base64,iVBORw0KGgo="
const PDF = "data:application/pdf;base64,JVBERi0="
const TEXT = "data:text/plain;base64,SGVsbG8="

describe("mimeFromDataUri", () => {
  it("يستخرج النوع من رأس الرابط", () => {
    expect(mimeFromDataUri(IMAGE)).toBe("image/png")
    expect(mimeFromDataUri(TEXT)).toBe("text/plain")
  })

  it("يرجّع null لغير روابط data:", () => {
    expect(mimeFromDataUri("https://example.com/a.png")).toBeNull()
    expect(mimeFromDataUri("not-a-uri")).toBeNull()
  })
})

describe("attachmentModality", () => {
  it("يصنّف الصورة والـ PDF والنص", () => {
    expect(attachmentModality("image/jpeg")).toBe("image")
    expect(attachmentModality("application/pdf")).toBe("pdf")
    expect(attachmentModality("text/markdown")).toBe("text")
  })
})

describe("parseRequestAttachments", () => {
  it("يقبل غياب المرفقات", () => {
    expect(parseRequestAttachments(undefined)).toEqual({ ok: true, attachments: [] })
  })

  it("يقبل مرفقات data: صالحة ويحدد نوعها", () => {
    const result = parseRequestAttachments([
      { uri: IMAGE, name: "photo.png" },
      { uri: PDF, name: "doc.pdf" },
      { uri: TEXT, name: "notes.txt" },
    ])
    expect(result).toEqual({
      ok: true,
      attachments: [
        { uri: IMAGE, name: "photo.png", modality: "image" },
        { uri: PDF, name: "doc.pdf", modality: "pdf" },
        { uri: TEXT, name: "notes.txt", modality: "text" },
      ],
    })
  })

  it("يرفض أكثر من الحد الأقصى", () => {
    const many = Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, () => ({ uri: TEXT }))
    expect(parseRequestAttachments(many)).toEqual({ ok: false, reason: "tooMany" })
  })

  it("يرفض الأشكال التالفة", () => {
    expect(parseRequestAttachments("nope")).toEqual({ ok: false, reason: "invalid" })
    expect(parseRequestAttachments([{ uri: "https://example.com/a.png" }])).toEqual({ ok: false, reason: "invalid" })
    expect(parseRequestAttachments([{ name: "no-uri" }])).toEqual({ ok: false, reason: "invalid" })
  })
})

describe("unsupportedAttachment", () => {
  it("النص مقبول دايماً، والصورة تحتاج قدرة image", () => {
    expect(unsupportedAttachment([{ uri: TEXT, modality: "text" }], [])).toBeNull()
    expect(unsupportedAttachment([{ uri: IMAGE, modality: "image" }], ["text"])).toEqual({ uri: IMAGE, modality: "image" })
    expect(unsupportedAttachment([{ uri: IMAGE, modality: "image" }], ["text", "image"])).toBeNull()
  })

  it("يرجّع أول مرفق غير مدعوم", () => {
    const attachments = [
      { uri: TEXT, modality: "text" as const },
      { uri: PDF, modality: "pdf" as const },
      { uri: IMAGE, modality: "image" as const },
    ]
    expect(unsupportedAttachment(attachments, ["text"])).toEqual({ uri: PDF, modality: "pdf" })
  })
})
