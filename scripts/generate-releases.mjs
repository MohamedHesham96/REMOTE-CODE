#!/usr/bin/env node
// مولّد ملاحظات الإصدار من تاريخ Git — أداة تطوير مساعدة، لا تعمل وقت التشغيل.
//
// الفكرة: التطبيق لا يقرأ Git أبدًا؛ ملف `src/releases-data.ts` ثابت ومُراجَع
// بشريًا. هذا السكربت ياخد صورة جديدة من التاريخ ويطبع كل commit ببادئته
// القصيرة وتاريخه، حتى تكون إضافة إصدار جديد عملية ميكانيكية واضحة:
//
//   node scripts/generate-releases.mjs            # كل التاريخ
//   node scripts/generate-releases.mjs v1.4.0     # commits من الوسم/الإصدار الأخير فقط
//   node scripts/generate-releases.mjs HEAD~10..HEAD
//
// ثم انسخ الدفعة الجديدة إلى `releases-data.ts` وصنّف التغييرات (features /
// improvements / fixes / performance / uiux / technical) قبل النشر.
import { execFileSync } from "node:child_process"

const FORMAT = "%h|%ad|%an|%s"
const range = process.argv[2]

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

const logArgs = ["log", `--pretty=format:${FORMAT}`, "--date=short"]
if (range) {
  logArgs.push(range)
}

let raw = ""
try {
  raw = git(...logArgs)
} catch (error) {
  console.error(`تعذّر قراءة تاريخ Git: ${error.message}`)
  process.exit(1)
}

if (!raw) {
  console.log("لا توجد commits في النطاق المطلوب.")
  process.exit(0)
}

const commits = raw.split("\n").map((line) => {
  const [hash, date, author, subject] = line.split("|")
  return { hash, date, author, subject }
})

const byDay = new Map()
for (const commit of commits.reverse()) {
  if (!byDay.has(commit.date)) {
    byDay.set(commit.date, [])
  }
  byDay.get(commit.date).push(commit)
}

console.log(`إجمالي الـ commits: ${commits.length}`)
console.log("اقتراح تجميع أولي حسب يوم العمل (راجع التصنيف يدويًا):\n")
for (const [date, dayCommits] of byDay) {
  console.log(`${date}  —  ${dayCommits.length} commit`)
  for (const commit of dayCommits) {
    console.log(`  ${commit.hash}  ${commit.subject}`)
  }
  console.log("")
}
