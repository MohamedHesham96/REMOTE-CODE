import { describe, expect, it } from "vitest"
import { parseMarkdownBlocks } from "./markdown-table"

describe("parseMarkdownBlocks", () => {
  it("returns a single text block when there is no table", () => {
    expect(parseMarkdownBlocks("سطر أول\nسطر تاني")).toEqual([
      { kind: "text", text: "سطر أول\nسطر تاني" },
    ])
  })

  it("parses a table with header and rows", () => {
    const text = ["| Name | Age |", "| --- | --- |", "| Ali | 30 |", "| Sara | 25 |"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      {
        kind: "table",
        table: {
          headers: ["Name", "Age"],
          aligns: [null, null],
          rows: [["Ali", "30"], ["Sara", "25"]],
        },
      },
    ])
  })

  it("parses the alignment colons in the separator row", () => {
    const text = ["| a | b | c |", "| :--- | :---: | ---: |", "| 1 | 2 | 3 |"].join("\n")
    const [block] = parseMarkdownBlocks(text)
    expect(block).toEqual({
      kind: "table",
      table: {
        headers: ["a", "b", "c"],
        aligns: ["left", "center", "right"],
        rows: [["1", "2", "3"]],
      },
    })
  })

  // الجداول من غير أنابيب على الأطراف شائعة في ردود OpenCode؛ لازم تتقري بنفس
  // الشكل مش كأنها ناقصة.
  it("accepts rows without outer pipes", () => {
    const text = ["a | b", "--- | ---", "1 | 2"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      { kind: "table", table: { headers: ["a", "b"], aligns: [null, null], rows: [["1", "2"]] } },
    ])
  })

  it("keeps the text before and after a table as separate blocks", () => {
    const text = ["الخلاصة:", "| a | b |", "| --- | --- |", "| 1 | 2 |", "وشكرًا"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      { kind: "text", text: "الخلاصة:" },
      { kind: "table", table: { headers: ["a", "b"], aligns: [null, null], rows: [["1", "2"]] } },
      { kind: "text", text: "وشكرًا" },
    ])
  })

  it("does not treat a pipe line as a table without a valid separator", () => {
    const text = ["a | b", "1 | 2"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([{ kind: "text", text: "a | b\n1 | 2" }])
  })

  it("does not treat a separator with a different column count as a table", () => {
    const text = ["| a | b |", "| --- | --- | --- |", "| 1 | 2 |"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      { kind: "text", text: "| a | b |\n| --- | --- | --- |\n| 1 | 2 |" },
    ])
  })

  it("requires three dashes for the separator", () => {
    const text = ["| a | b |", "| -- | -- |", "| 1 | 2 |"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      { kind: "text", text: "| a | b |\n| -- | -- |\n| 1 | 2 |" },
    ])
  })

  it("handles an escaped pipe inside a cell", () => {
    const text = ["| cmd | note |", "| --- | --- |", "| a \\| b | ok |"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      { kind: "table", table: { headers: ["cmd", "note"], aligns: [null, null], rows: [["a | b", "ok"]] } },
    ])
  })

  it("renders a header-only table with no body rows", () => {
    const text = ["| a | b |", "| --- | --- |"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      { kind: "table", table: { headers: ["a", "b"], aligns: [null, null], rows: [] } },
    ])
  })

  it("pads short rows and trims long rows to the header width", () => {
    const text = ["| a | b |", "| --- | --- |", "| 1 |", "| 1 | 2 | 3 |"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      { kind: "table", table: { headers: ["a", "b"], aligns: [null, null], rows: [["1", ""], ["1", "2"]] } },
    ])
  })

  it("ends the table at a blank line and resumes normal text", () => {
    const text = ["| a | b |", "| --- | --- |", "| 1 | 2 |", "", "كلام تاني"].join("\n")
    expect(parseMarkdownBlocks(text)).toEqual([
      { kind: "table", table: { headers: ["a", "b"], aligns: [null, null], rows: [["1", "2"]] } },
      { kind: "text", text: "كلام تاني" },
    ])
  })
})
