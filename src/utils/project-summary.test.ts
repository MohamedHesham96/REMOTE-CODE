import { describe, expect, it } from "vitest"
import { formatRelative } from "../display"
import { getStrings } from "../i18n"
import type { ActiveSession, AttentionItem, Project } from "../types"
import { buildProjectSummaries, formatProjectSummary } from "./project-summary"

const t = getStrings("ar")
const en = getStrings("en")
const NOW = 1_700_000_000_000

function project(worktree: string, sessionCount = 0, updated = 0): Project {
  return { id: worktree, worktree, name: worktree, time: { created: 0, updated }, sessionCount }
}

function running(id: string, directory: string): ActiveSession {
  return {
    id,
    title: id,
    directory,
    worktree: directory,
    projectName: "project",
    status: { type: "busy" },
    updatedAt: NOW,
  }
}

function needingAttention(directory: string, sessionID = "ses_1"): AttentionItem {
  return {
    kind: "question",
    sessionID,
    conversationID: sessionID,
    sessionTitle: "title",
    projectName: "project",
    directory,
    request: { id: "form_1", sessionID, questions: [] },
  }
}

describe("buildProjectSummaries", () => {
  it("بيعدّ المحادثات الشغالة والمحتاجة انتباه لكل مشروع من الحالات الحية", () => {
    const summaries = buildProjectSummaries(
      [project("/work/msales", 12), project("/work/remote", 8)],
      [running("a", "/work/msales"), running("b", "/work/msales"), running("c", "/work/remote")],
      [needingAttention("/work/msales")],
      null,
      0,
    )

    expect(summaries.get("/work/msales")).toEqual({ running: 2, attention: 1, sessions: 12, lastActivity: 0 })
    expect(summaries.get("/work/remote")).toEqual({ running: 1, attention: 0, sessions: 8, lastActivity: 0 })
  })

  it("مشروع مفيش فيه أي حاجة بياخد أصفار", () => {
    const summaries = buildProjectSummaries([project("/work/idle", 4, NOW - 7_200_000)], [], [], null, 0)
    expect(summaries.get("/work/idle")).toEqual({ running: 0, attention: 0, sessions: 4, lastActivity: NOW - 7_200_000 })
  })

  it("بيطابق المسارات باختلاف الفواصل وحالة الحروف", () => {
    const summaries = buildProjectSummaries(
      [project("E:/Work/App", 1)],
      [running("a", "E:\\work\\app")],
      [needingAttention("e:/work/app/")],
      null,
      0,
    )
    expect(summaries.get("e:/work/app")).toEqual({ running: 1, attention: 1, sessions: 1, lastActivity: 0 })
  })

  it("بياخد عدد محادثات المشروع المفتوح من القائمة الحية", () => {
    const summaries = buildProjectSummaries(
      [project("/work/msales", 99), project("/work/remote", 8)],
      [],
      [],
      "/work/msales",
      5,
    )
    expect(summaries.get("/work/msales")?.sessions).toBe(5)
    expect(summaries.get("/work/remote")?.sessions).toBe(8)
  })

  it("محادثة/انتباه لمشروع مش في القائمة مبيأثرش على غيره", () => {
    const summaries = buildProjectSummaries([project("/work/known", 1)], [running("a", "/work/unknown")], [needingAttention("/work/unknown")], null, 0)
    expect(summaries.get("/work/known")).toEqual({ running: 0, attention: 0, sessions: 1, lastActivity: 0 })
  })

  it("التحديث اللحظي: نفس المشروع بيتحوّل من شغّال لـ يحتاج انتباه ثم خامل", () => {
    const projects = [project("/work/msales", 4)]
    const busy = buildProjectSummaries(projects, [running("a", "/work/msales")], [], null, 0)
    expect(busy.get("/work/msales")?.running).toBe(1)
    expect(busy.get("/work/msales")?.attention).toBe(0)

    // الجلسة طلبت تدخّل المستخدم: النشاط فضل زي ما هو، والانتباه بقى 1
    const waiting = buildProjectSummaries(projects, [running("a", "/work/msales")], [needingAttention("/work/msales")], null, 0)
    expect(waiting.get("/work/msales")).toMatchObject({ running: 1, attention: 1 })

    // خلص الشغل: النشاط والانتباه اتصفّروا
    const idle = buildProjectSummaries(projects, [], [], null, 0)
    expect(idle.get("/work/msales")).toMatchObject({ running: 0, attention: 0 })
  })

  it("مبيغيّرش كائنات المشاريع الأصلية", () => {
    const target = project("/work/msales", 12)
    buildProjectSummaries([target], [running("a", "/work/msales")], [], null, 3)
    expect(target.sessionCount).toBe(12)
    expect(target.time.updated).toBe(0)
  })
})

describe("formatProjectSummary", () => {
  it("بيجمّع الشغل الجاري والانتباه وعدد المحادثات", () => {
    const text = formatProjectSummary({ running: 3, attention: 1, sessions: 12, lastActivity: 0 }, t, "ar", NOW)
    expect(text).toBe(`3 ${t.projectSummaryRunning} · 1 ${t.projectSummaryAttention} · 12 ${t.conversations}`)
  })

  it("بيستخدم المفرد لمحادثة واحدة", () => {
    const text = formatProjectSummary({ running: 1, attention: 0, sessions: 1, lastActivity: 0 }, t, "ar", NOW)
    expect(text).toBe(`1 ${t.projectSummaryRunning} · 1 ${t.conversation}`)
  })

  it("مشروع خامل بيعرض آخر نشاط نسبي", () => {
    const lastActivity = NOW - 2 * 60 * 60 * 1000
    const text = formatProjectSummary({ running: 0, attention: 0, sessions: 4, lastActivity }, en, "en", NOW)
    expect(text).toBe(`Idle · Last activity ${formatRelative(lastActivity, "en", NOW)}`)
  })

  it("مشروع بلا محادثات بياخد نص فراغ بدل خامل", () => {
    expect(formatProjectSummary({ running: 0, attention: 0, sessions: 0, lastActivity: 0 }, t, "ar", NOW)).toBe(t.projectSummaryEmpty)
  })

  it("مفيش ملخص = نص فاضي", () => {
    expect(formatProjectSummary(undefined, t, "ar", NOW)).toBe("")
  })
})
