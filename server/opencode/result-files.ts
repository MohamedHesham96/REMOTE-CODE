import { isAbsolute, relative, resolve } from "node:path"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client"
import { serverMessage, type ServerLang } from "../i18n.js"
import type { ResultFile } from "./types.js"
import { fileNameFromPath, mimeFromName } from "./utils.js"

// ملفات النتيجة كانت بتُجمع من snapshot رسالة الـ assistant فقط، والـ snapshot
// ده مبني على Git في المحرك (v2): مشروع بدون مستودع Git ما لوش snapshot خالص،
// فالمهام اللي بتنتج ملفات فعلية كانت تفضل بلا أي ملف قابل للتحميل. عشان كده
// بنقرأ كذلك من نداءات الأدوات نفسها (write/edit) ومن ملفات الـ metadata اللي
// المحرك بيسجلها للتعديلات — دي بتشتغل مع أي مشروع، Git أو لا.

interface FileCandidate {
  id: string
  name: string
  mime?: string
  path: string
  url: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

// الـ uri بصيغة file:// يُحوَّل لمسار، وhttp(s) يُترك رابطًا، وأي نص تاني
// (مسار نسبي أو مطلق) يُترك كما هو ليتحلّ بالنسبة لمجلد الجلسة عند التحميل.
function filePathFromUri(uri: string): { path: string; url: string } {
  const trimmed = (uri || "").trim()
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return { path: resolve(decodeURIComponent(trimmed.replace(/^file:\/\/\/?/i, ""))), url: "" }
    } catch {
      return { path: "", url: "" }
    }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { path: "", url: trimmed }
  }
  return { path: trimmed, url: "" }
}

// أدوات الكتابة: أسماء الأدوات في المحرك نص حر، فبنطابق جزئيًا. لازم نستبعد
// أدوات القراءة صراحةً لأنها بتستخدم نفس حقل `path` (read/grep)، ولو دخلت
// كانت كل قراءة اتعرضت كملف ناتج.
function isWriteTool(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.includes("read") || lower.includes("list") || lower.includes("delete") || lower.includes("remove")) {
    return false
  }
  return ["write", "create", "edit", "patch", "apply"].some((hint) => lower.includes(hint))
}

// ملفات نداء أداة واحدة: metadata.files للمحرر (مسارات نسبية مع حالة)، أو
// حقل path لمخرجات write. لو metadata موجودة بنينا عليها وما نكررهاش من
// الـ input.
function toolFileCandidates(part: SessionMessageAssistantTool, fileFallback: string): FileCandidate[] {
  const state = part.state
  if (state.status !== "completed" && state.status !== "error") {
    return []
  }
  const candidates: FileCandidate[] = []
  const metadata = asRecord(state.metadata)
  const metadataFiles = metadata && Array.isArray(metadata.files) ? metadata.files : []

  for (const raw of metadataFiles) {
    const item = asRecord(raw)
    const file = item && typeof item.file === "string" ? item.file : ""
    if (!file.trim() || item?.status === "deleted") {
      continue
    }
    const name = fileNameFromPath(file, fileFallback)
    candidates.push({ id: `${part.id}:${file}`, name, mime: mimeFromName(name), path: file, url: "" })
  }
  if (candidates.length > 0 || !isWriteTool(part.name)) {
    return candidates
  }

  const input = asRecord(state.input)
  const path = typeof input?.path === "string" ? input.path : typeof input?.filePath === "string" ? input.filePath : ""
  if (!path.trim()) {
    return candidates
  }
  const name = fileNameFromPath(path, fileFallback)
  candidates.push({ id: `${part.id}:${path}`, name, mime: mimeFromName(name), path, url: "" })
  return candidates
}

// بعض المهام بتكتب ملفات مساعدة خارج مجلد المشروع (سكربتات مؤقتة مثلًا).
// دي ما ينفعش تتحمّل لأن راوت التحميل محصور في مجلد الجلسة، فعرضها كان
// هيطلع لينك مكسور — بنستبعدها من البداية.
function isWithinProject(value: string, projectDirectory: string): boolean {
  if (!projectDirectory || !value) {
    return true
  }
  const base = resolve(projectDirectory)
  const absolute = isAbsolute(value) ? resolve(value) : resolve(base, value)
  const relativePath = relative(base, absolute)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

// مفتاح الدمج: بنوحّد المسارات المطلقة والنسبية لنفس الصورة (نسبةً لمجلد
// المشروع) عشان نفس الملف ما يتكررش لما ييجي من snapshot ومن نداء أداة.
function pathKey(value: string, projectDirectory: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ""
  }
  if (!projectDirectory) {
    return (isAbsolute(trimmed) ? resolve(trimmed) : trimmed).toLowerCase()
  }
  const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(projectDirectory, trimmed)
  return relative(resolve(projectDirectory), absolute).toLowerCase()
}

// ملفات النتيجة من محتوى v2: مرفقات file داخل الأدوات المكتملة، وملفات نداء
// الأدوات (write/edit)، وملفات الـ snapshot للرسالة (بديل patch في v1).
export function collectResultFiles(
  sessionId: string,
  messages: SessionMessageAssistant[],
  lang: ServerLang = "ar",
  projectDirectory = "",
): ResultFile[] {
  const files = new Map<string, ResultFile>()
  const fileFallback = serverMessage("fileFallback", lang)

  const pushFile = (candidate: FileCandidate): void => {
    if (!candidate.path && !candidate.url) {
      return
    }
    if (candidate.path && !isWithinProject(candidate.path, projectDirectory)) {
      return
    }
    const key = candidate.path
      ? `path:${pathKey(candidate.path, projectDirectory)}`
      : `url:${candidate.url}`
    if (files.has(key)) {
      return
    }
    const downloadUrl = candidate.path
      ? `/api/session/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(candidate.path)}`
      : candidate.url
    files.set(key, {
      id: candidate.id,
      name: candidate.name || fileFallback,
      mime: candidate.mime || mimeFromName(candidate.name),
      path: candidate.path,
      downloadUrl,
    })
  }

  for (const entry of messages) {
    for (const part of entry.content) {
      if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) {
        continue
      }
      for (const item of part.state.content ?? []) {
        if (item.type !== "file") {
          continue
        }
        const { path, url } = filePathFromUri(item.uri)
        const name = item.name || (path ? fileNameFromPath(path, fileFallback) : fileNameFromPath(url, fileFallback))
        pushFile({ id: `${part.id}:${item.uri}`, name, mime: item.mime || mimeFromName(name), path, url })
      }
      for (const candidate of toolFileCandidates(part, fileFallback)) {
        pushFile(candidate)
      }
    }
    for (const filePath of entry.snapshot?.files ?? []) {
      if (typeof filePath !== "string" || !filePath.trim()) {
        continue
      }
      const name = fileNameFromPath(filePath, fileFallback)
      pushFile({
        id: `${entry.id}:${filePath}`,
        name,
        mime: mimeFromName(name),
        path: filePath,
        url: "",
      })
    }
  }

  return [...files.values()].slice(-20)
}
