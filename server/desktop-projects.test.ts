import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { collectDesktopProjectDirectories } from "./desktop-projects.js"

// قاعدة ديسكتوب مزيفة: صيغة v2 مصغّرة بمجلدات حقيقية وقمامة يجب تجاهلها.
function fakeDesktopDb(): { dir: string; dbPath: string; real: string } {
  const dir = mkdtempSync(join(tmpdir(), "projects-database-test-"))
  const real = join(dir, "Workshop")
  mkdirSync(real, { recursive: true })
  const dbPath = join(dir, "opencode.db")
  const db = new DatabaseSync(dbPath)
  db.exec("CREATE TABLE project (id TEXT, worktree TEXT)")
  db.exec("CREATE TABLE session_v2 (id TEXT, directory TEXT)")
  const insertProject = db.prepare("INSERT INTO project (id, worktree) VALUES (?, ?)")
  insertProject.run("p1", real)
  insertProject.run("p2", real)
  insertProject.run("junk-root", "/")
  insertProject.run("junk-drive", "E:\\")
  insertProject.run("junk-drive-relative", "E:")
  insertProject.run("junk-relative", "Workshop")
  insertProject.run("junk-home", homedir())
  insertProject.run("junk-home-slashes", homedir().replace(/\\/g, "/"))
  insertProject.run("junk-nested", join(real, ".claude", "worktrees", "x"))
  insertProject.run("junk-missing", join(dir, "gone"))
  const insertSession = db.prepare("INSERT INTO session_v2 (id, directory) VALUES (?, ?)")
  insertSession.run("s1", real)
  db.close()
  return { dir, dbPath, real }
}

describe("collectDesktopProjectDirectories", () => {
  it("يرجع [] لمسار غير موجود", () => {
    expect(collectDesktopProjectDirectories(join(tmpdir(), "no-such-opencode.db"))).toEqual([])
  })

  it("يجمع المجلدات الموجودة فقط وبدون تكرار", () => {
    const { dir, dbPath, real } = fakeDesktopDb()
    try {
      // الجذور (`/` و`E:\`) والنسبي (`Workshop` و`E:`) والبيت بأي شرطات
      // والعشّ المخفي تُرفض كلها قبل لمس القرص، فلا يبقى إلا المجلد الحقيقي.
      expect(collectDesktopProjectDirectories(dbPath)).toEqual([real])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
