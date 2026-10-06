// OpenCode بيرجّع "النتيجة النهائية" نصًا خامًا، والمشروع مافيهوش مكتبة ماركداون.
// يعني جدول ماركداون اللي بيتكتب في الرد كان بيظهر كسطور مبطّطة "| a | b |" مش
// كجدول. هنا بنفكّك النص لكتل: نص عادي، وجداول ماركداون حقيقية، عشان الواجهة
// ترسم الجدول عنصر <table> مرتّب بأعمدة مصفوفة بدل ما ترميه كما هو.
//
// الفصل ده مقصود يكون في utils بحتة من غير React: أسهل في الاختبار، والكومبوننت
// يفضل مسؤول عن العرض بس.

export type MarkdownTableAlign = "left" | "center" | "right" | null

export interface MarkdownTable {
  headers: string[]
  aligns: MarkdownTableAlign[]
  rows: string[][]
}

export type MarkdownBlock =
  | { kind: "text"; text: string }
  | { kind: "table"; table: MarkdownTable }

// خلية الفاصل في ماركداون: ٣ شرطات على الأقل، وجوّز نقطتين اختياري على
// الطرفين للتحاذي. اشترطنا ٣ شرطات (مش واحدة) عشان سطر زي "| -- |" اللي ممكن
// يكون نص عادي ما يتقريش غلط كجدول.
const SEPARATOR_CELL = /^:?-{3,}:?$/

function splitCells(line: string): string[] {
  // الشرطة المائلة قبل الأنبوب \| معناها أنبوب حرفي مش فاصل، فنستبدله مؤقتًا
  // بمحرف نادر قبل التقسيم ونرجّعه بعده.
  const escaped = line.replace(/\\\|/g, "\u0000")
  const trimmed = escaped.trim()
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed
  const body = inner.endsWith("|") ? inner.slice(0, -1) : inner
  return body.split("|").map((cell) => cell.replace(/\u0000/g, "|").trim())
}

function parseAlign(cell: string): MarkdownTableAlign {
  const starts = cell.startsWith(":")
  const ends = cell.endsWith(":")
  if (starts && ends) {
    return "center"
  }
  if (ends) {
    return "right"
  }
  if (starts) {
    return "left"
  }
  return null
}

// صف الفاصل لازم يوافق عدد أعمدة الترويسة بالظبط، وكل خلية فيه تطابق صيغة
// الفاصل. ده اللي بيمنع أي سطر فيه "|" إنه يتقري كجدول من غير فاصل صحيح.
function isSeparator(line: string, columns: number): boolean {
  if (columns === 0) {
    return false
  }
  const cells = splitCells(line)
  return cells.length === columns && cells.every((cell) => SEPARATOR_CELL.test(cell))
}

function isTableHeader(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && trimmed.includes("|")
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split("\n")
  const blocks: MarkdownBlock[] = []
  let buffer: string[] = []

  // الكتل النصية بتتجمّع في مخزن وبتتفضّى عند أول جدول، عشان ترتيب النص
  // والجداول يفضل زي ما جاي من OpenCode.
  const flush = () => {
    if (buffer.length === 0) {
      return
    }
    // نطبّع أسطر الفراغ على أطراف الكتلة بس، لأن الجدول ليه هامشه الخاص —
    // من غيرها تبان مسافات ميتة قبل الجدول وبعده.
    const joined = buffer.join("\n").replace(/^\n+/, "").replace(/\n+$/, "")
    if (joined !== "") {
      blocks.push({ kind: "text", text: joined })
    }
    buffer = []
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const next = lines[index + 1]
    if (isTableHeader(line) && next !== undefined) {
      const headers = splitCells(line)
      if (isSeparator(next, headers.length)) {
        flush()
        const aligns = splitCells(next).map(parseAlign)
        const rows: string[][] = []
        index += 2
        // جسم الجدول بيفضل يمتد طول ما السطر فيه أنبوب وفيه محتوى؛ أول سطر
        // فاضي أو من غير أنبوب بيقفل الجدول ويرجع نص عادي.
        while (index < lines.length) {
          const rowLine = lines[index]
          if (rowLine.trim() === "" || !rowLine.includes("|")) {
            break
          }
          const cells = splitCells(rowLine)
          // الخلايا بتتوسّط أو تتقص لعدد أعمدة الترويسة عشان كل الصفوف تفضل
          // على نفس عدد الأعمدة حتى لو ماركداون مشدود.
          rows.push(headers.map((_, column) => cells[column] ?? ""))
          index += 1
        }
        blocks.push({ kind: "table", table: { headers, aligns, rows } })
        continue
      }
    }
    buffer.push(line)
    index += 1
  }
  flush()
  return blocks
}
