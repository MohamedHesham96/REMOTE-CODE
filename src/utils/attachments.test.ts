import { afterEach, describe, expect, it, vi } from "vitest"
import { getStrings } from "../i18n"
import type { ComposerAttachment, ModelInfo } from "../types"
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  addAttachmentFiles,
  attachmentLimitError,
  attachmentModality,
  attachmentRejectionMessage,
  clipboardFiles,
  documentAccept,
  formatBytes,
  modelSupports,
  readClipboardFiles,
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

// FileReader مش موجود في بيئة Node، فبنستبدله بقراءة فورية بترجّع data URL.
class FakeFileReader {
  result: string | null = null
  error: Error | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsDataURL(file: File): void {
    this.result = `data:${file.type || "application/octet-stream"};base64,AA==`
    this.onload?.()
  }
}

function fakeFile(name: string, type: string, size = 8): File {
  const file = new File(["x"], name, { type })
  Object.defineProperty(file, "size", { value: size })
  return file
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("clipboardFiles", () => {
  it("يستخرج ملفات العناصر ويتجاهل العنصر النصي", () => {
    const image = new File(["x"], "shot.png", { type: "image/png" })
    const clipboard = {
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => image },
      ],
      files: [],
    } as unknown as DataTransfer
    expect(clipboardFiles(clipboard)).toEqual([image])
  })

  it("يرجع إلى files لو items فاضية", () => {
    const pdf = new File(["x"], "doc.pdf", { type: "application/pdf" })
    const clipboard = { items: [], files: [pdf] } as unknown as DataTransfer
    expect(clipboardFiles(clipboard)).toEqual([pdf])
  })

  it("يرجّع مصفوفة فاضية لما مفيش ملفات", () => {
    const clipboard = { items: [{ kind: "string", getAsFile: () => null }], files: [] } as unknown as DataTransfer
    expect(clipboardFiles(clipboard)).toEqual([])
  })
})

describe("readClipboardFiles", () => {
  it("يقرا الصور من الحافظة ويحوّلها لملفات", async () => {
    const image = new Blob(["x"], { type: "image/png" })
    vi.stubGlobal("navigator", {
      clipboard: {
        read: async () => [
          { types: ["text/plain", "image/png"], getType: async () => image },
          { types: ["text/plain"], getType: async () => new Blob(["y"], { type: "text/plain" }) },
        ],
      },
    })
    const files = await readClipboardFiles()
    expect(files).toHaveLength(1)
    expect(files[0]?.type).toBe("image/png")
    expect(files[0]?.name).toBe("clipboard.png")
  })

  it("يرجّع فاضي لما Clipboard API مش متاح", async () => {
    vi.stubGlobal("navigator", {})
    expect(await readClipboardFiles()).toEqual([])
  })

  it("يرجّع فاضي لو القراءة اترفضت", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        read: async () => {
          throw new Error("denied")
        },
      },
    })
    expect(await readClipboardFiles()).toEqual([])
  })
})

describe("addAttachmentFiles", () => {
  it("يضيف صورة مدعومة كـ data URL", async () => {
    vi.stubGlobal("FileReader", FakeFileReader)
    const { attachments: next, rejection } = await addAttachmentFiles([], [fakeFile("shot.png", "image/png")], { image: true, pdf: false })
    expect(rejection).toBeNull()
    expect(next).toHaveLength(1)
    expect(next[0]?.mime).toBe("image/png")
    expect(next[0]?.uri).toContain("data:image/png")
  })

  it("يرفض النوع غير المدعوم ولا يضيف شيئاً", async () => {
    const { attachments: next, rejection } = await addAttachmentFiles([], [fakeFile("archive.zip", "application/zip")], { image: true, pdf: true })
    expect(rejection).toBe("unsupported")
    expect(next).toHaveLength(0)
  })

  it("يرفض الصورة لما النموذج ما يدعمهاش", async () => {
    const { attachments: next, rejection } = await addAttachmentFiles([], [fakeFile("shot.png", "image/png")], { image: false, pdf: false })
    expect(rejection).toBe("imageDisabled")
    expect(next).toHaveLength(0)
  })

  it("يرفض PDF لما النموذج ما يدعمهوش", async () => {
    const { rejection } = await addAttachmentFiles([], [fakeFile("doc.pdf", "application/pdf")], { image: true, pdf: false })
    expect(rejection).toBe("pdfDisabled")
  })

  it("يحترم حد العدد", async () => {
    const existing: ComposerAttachment[] = Array.from({ length: MAX_ATTACHMENT_COUNT }, (_, index) => attachment(index))
    const { attachments: next, rejection } = await addAttachmentFiles(existing, [fakeFile("shot.png", "image/png")], { image: true, pdf: true })
    expect(rejection).toBe("tooMany")
    expect(next).toHaveLength(MAX_ATTACHMENT_COUNT)
  })

  it("يحترم الحجم الكلي", async () => {
    const existing = [attachment(MAX_ATTACHMENT_BYTES), attachment(MAX_ATTACHMENT_BYTES)]
    const { rejection } = await addAttachmentFiles(existing, [fakeFile("shot.png", "image/png", 1024)], { image: true, pdf: true })
    expect(rejection).toBe("totalTooLarge")
  })
})

describe("attachmentRejectionMessage", () => {
  it("يترجم أسباب الرفض المختلفة", () => {
    const t = getStrings("en")
    expect(attachmentRejectionMessage("imageDisabled", t)).toBe(t.attachImageDisabled)
    expect(attachmentRejectionMessage("pdfDisabled", t)).toBe(t.attachPdfUnsupported)
    expect(attachmentRejectionMessage("unsupported", t)).toBe(t.attachmentUnsupported)
    expect(attachmentRejectionMessage("tooLarge", t)).toBe(t.attachmentTooLarge)
    expect(attachmentRejectionMessage("tooMany", t)).toBe(t.attachmentTooMany)
    expect(attachmentRejectionMessage("readFailed", t)).toBe(t.attachmentReadFailed)
  })
})
