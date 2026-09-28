import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { isListableProjectDirectory } from "./opencode/utils.js"

// مجلدات مشاريع تطبيق الديسكتوب (v2) تُقرأ من قاعدته مباشرة — قراءة فقط
// وبدون أي كتابة — ثم تُسجَّل في قاعدة الـ PWA المعزولة كمجلدات جاهزة.
// المحادثات القديمة نفسها لا تُنقل (الصيغتان مختلفتان)، فالمجلد يظهر
// لبدء جلسات جديدة عليه من الهاتف.
// أي فشل هنا (لا ديسكتوب، صيغة تغيّرت، القاعدة مقفولة) يعني: لا استيراد،
// والـ PWA يكمل على مشاريعه الخاصة.

const MAX_IMPORTED = 30

const DIRECTORY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  project: ["worktree"],
  session_v2: ["directory"],
  worktree: ["directory"],
  project_directory: ["directory"],
}

export function desktopDatabasePath(): string {
  return join(homedir(), ".local", "share", "opencode", "opencode.db")
}

function usableDirectory(value: unknown, home: string): string | null {
  // الشكل أولًا بلا IO: النسبي (`Workshop` أو `E:`) وجذر القرص (`E:\`) والمقطع
  // المخفي (`.claude/worktrees`) قمامة من أي مصدر، ومقارنة البيت موسّطة
  // الشرطات حتى لا يتسرّب بصيغة شرطات مخالفة على وندوز. بعده وحده نلمس القرص.
  if (!isListableProjectDirectory(value, home)) {
    return null
  }
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  let stats
  try {
    stats = statSync(trimmed)
  } catch {
    return null
  }
  if (!stats.isDirectory()) {
    return null
  }
  return trimmed
}

export function collectDesktopProjectDirectories(databasePath: string = desktopDatabasePath()): string[] {
  if (!existsSync(databasePath)) {
    return []
  }
  const found: string[] = []
  const seen = new Set<string>()
  const home = homedir()
  let db: DatabaseSync
  try {
    db = new DatabaseSync(databasePath, { readOnly: true })
  } catch {
    return []
  }
  try {
    for (const [table, columns] of Object.entries(DIRECTORY_COLUMNS)) {
      if (found.length >= MAX_IMPORTED) {
        break
      }
      let existing: string[] = []
      try {
        // أسماء الجداول من ثابت داخلي — لا مدخلات مستخدم هنا إطلاقًا.
        existing = db
          .prepare(`SELECT name FROM pragma_table_info('${table}')`)
          .all()
          .map((row) => (row as { name: string }).name)
      } catch {
        continue
      }
      const column = columns.find((name) => existing.includes(name))
      if (!column) {
        continue
      }
      let values: unknown[] = []
      try {
        values = db
          .prepare(`SELECT DISTINCT "${column}" AS value FROM "${table}"`)
          .all()
          .map((row) => (row as { value: unknown }).value)
      } catch {
        continue
      }
      for (const value of values) {
        if (found.length >= MAX_IMPORTED) {
          break
        }
        const directory = usableDirectory(value, home)
        if (!directory) {
          continue
        }
        const key = directory.toLowerCase()
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        found.push(directory)
      }
    }
  } finally {
    try {
      db.close()
    } catch {
      // الإغلاق أفضل جهد — القراءة تمت أو فشلت وانتهى الأمر
    }
  }
  return found
}
