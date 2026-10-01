import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { unpushedCommitCount } from "./git-ahead.js"

// الاختبار بيبني مستودع git حقيقي في مجلد مؤقت: الـ helper ده بيشغّل git
// فعلاً، فأي mock هيتكلّم عن تخمينا بدل السلوك الحقيقي. مستودع محلي +
// bare "remote" عشان نبني حالة الـ upstream من غير شبكة.

const temps: string[] = []

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    // هوية محلية على المستودع نفسه: ما亿吨رقش إعدادات المستخدم العامة
    // ولا نطلب من git ما يطلبش passphrase أثناء الاختبار.
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  })
}

function commit(repo: string, name: string): void {
  writeFileSync(join(repo, name), name)
  git(repo, "add", ".")
  git(repo, "commit", "-m", `add ${name}`)
}

// مستودع عادي من غير أي remote ولا upstream.
function bareRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "remote-code-git-ahead-"))
  temps.push(dir)
  git(dir, "init")
  return dir
}

// "remote" لازم يكون --bare: git بيرفض الـ push على فرع checked out في
// مستودع عادي، فمستودع عادي كـ remote بيخلي الاختبار يفشل لأسباب مش
// ليها علاقة بالـ helper.
function bareRemote(): string {
  const dir = mkdtempSync(join(tmpdir(), "remote-code-git-remote-"))
  temps.push(dir)
  git(dir, "init", "--bare")
  return dir
}

// مستودع عليه remote متتبَّع: نقوده بـ push -u عشان يتكوّن الـ upstream.
function repoWithUpstream(): string {
  const remote = bareRemote()
  const repo = bareRepo()
  git(repo, "remote", "add", "origin", remote)
  commit(repo, "one.txt")
  git(repo, "push", "-u", "origin", "HEAD")
  return repo
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe("unpushedCommitCount", () => {
  it("يعدّ الـ commits اللي بعد الـ upstream", async () => {
    const repo = repoWithUpstream()
    commit(repo, "two.txt")
    commit(repo, "three.txt")

    await expect(unpushedCommitCount(repo)).resolves.toBe(2)
  })

  it("يرجع صفر لما الفرع متطابق مع البعيد", async () => {
    const repo = repoWithUpstream()

    await expect(unpushedCommitCount(repo)).resolves.toBe(0)
  })

  // مفهوم "غير مدفوع" نفسه مش موجود من غير upstream، فالصفر هو العرض الصح
  // مش رقم مخترع. دي الحالة اللي بتحصل في أول commit في أي مستودع.
  it("يرجع صفر لما مفيش upstream متظبط", async () => {
    const repo = bareRepo()
    commit(repo, "one.txt")

    await expect(unpushedCommitCount(repo)).resolves.toBe(0)
  })

  // الطلب بيوصل لكل مجلد شغل، فلازم يفشل بهدوء على غير المستودعات بدل ما
  // يرمي exception يخلي فتح درج الـ git يوقع.
  it("يرجع صفر لمجلد مش مستودع git", async () => {
    const dir = mkdtempSync(join(tmpdir(), "remote-code-git-ahead-"))
    temps.push(dir)

    await expect(unpushedCommitCount(dir)).resolves.toBe(0)
  })

  it("يرجع صفر لمجلد مش موجود أصلاً", async () => {
    await expect(unpushedCommitCount(join(tmpdir(), "remote-code-does-not-exist"))).resolves.toBe(0)
  })
})
