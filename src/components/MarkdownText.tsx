import { memo, useMemo } from "react"
import { parseMarkdownBlocks, type MarkdownTable, type MarkdownTableAlign } from "../utils/markdown-table"

function alignClass(align: MarkdownTableAlign): string | undefined {
  if (align === "center") {
    return "md-align-center"
  }
  if (align === "right") {
    return "md-align-right"
  }
  if (align === "left") {
    return "md-align-left"
  }
  return undefined
}

function TableView({ table }: { table: MarkdownTable }) {
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {table.headers.map((header, column) => (
              <th key={column} className={alignClass(table.aligns[column])}>{header}</th>
            ))}
          </tr>
        </thead>
        {table.rows.length > 0 ? (
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {table.headers.map((_, column) => (
                  <td key={column} className={alignClass(table.aligns[column])}>{row[column]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : null}
      </table>
    </div>
  )
}

// عرض نص OpenCode مع تحويل جداول ماركداون لعناصر <table> حقيقية. النص العادي
// بيفضل زي ما هو (الـ pre-wrap جاي من الحاوية) عشان أي محتوى تاني ما يتأثرش.
//
// memo: النتيجة النهائية والنص المباشر بيتعاد رسمهم مع كل تحديث بثّ أثناء
// الكتابة، والتحليل مش رخيص مع نص طويل، فمن غير memo كان بيتحلّل من جديد مع كل
// نبضة حتى لو النص ما اتغيّرش.
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text])
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "table" ? (
          <TableView key={index} table={block.table} />
        ) : (
          <span className="md-text" key={index}>{block.text}</span>
        ),
      )}
    </>
  )
})
