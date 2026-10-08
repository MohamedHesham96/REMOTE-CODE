import { formatRelative } from "../display"
import type { Language, Strings } from "../i18n"
import type { ActiveSession, AttentionItem, Project } from "../types"
import { normalizeProjectPath } from "./paths"

// ملخص المشروع لكل مشروع: أعداد بتتحسب من الحالات الحية الموجودة أصلًا في
// العميل — المحادثات الشغالة (من /api/activity اللي بيجمّع كل المشاريع في
// نداء واحد)، والمحتاجة انتباه (من /api/attention)، وعدد المحادثات (رقم
// السيرفر اللي بيتحسب من نفس ليستة الجلسات اللي /api/project بيقراها أصلًا).
// مفيش N+1 ولا poll جديد: البناء Map واحدة مع كل تغيير حقيقي في الـ state،
// والتحديث لحظي لأن الـ SSE هو اللي بيحرّك المصادر دي من الأساس.
export interface ProjectSummary {
  running: number
  attention: number
  sessions: number
  lastActivity: number
}

export function buildProjectSummaries(
  projects: Project[],
  activity: ActiveSession[],
  attention: AttentionItem[],
  selectedWorktree: string | null,
  selectedSessionCount: number,
): Map<string, ProjectSummary> {
  const summaries = new Map<string, ProjectSummary>()
  for (const project of projects) {
    summaries.set(normalizeProjectPath(project.worktree), {
      running: 0,
      attention: 0,
      sessions: project.sessionCount ?? 0,
      lastActivity: project.time.updated,
    })
  }
  for (const item of activity) {
    const summary = summaries.get(normalizeProjectPath(item.worktree || item.directory))
    if (summary) {
      summary.running += 1
    }
  }
  for (const item of attention) {
    const summary = summaries.get(normalizeProjectPath(item.directory))
    if (summary) {
      summary.attention += 1
    }
  }
  // المشروع المفتوح عدده من قائمة المحادثات الحية (بتتحدّث فور الإنشاء أو
  // الحذف)، والباقي من رقم السيرفر اللي بيتجدد مع فتح المشروع.
  if (selectedWorktree) {
    const summary = summaries.get(normalizeProjectPath(selectedWorktree))
    if (summary) {
      summary.sessions = selectedSessionCount
    }
  }
  return summaries
}

// نص الملخص: الشغل الجاري والمحتاج انتباه أولًا ومعاهم عدد المحادثات،
// ولما مفيش أي شغل "خامل · آخر نشاط منذ…". مشروع بلا محادثات لسه واخد نص
// فراغ واضح بدل "خامل" اللي توحي إن فيه شغل قديم.
export function formatProjectSummary(summary: ProjectSummary | undefined, t: Strings, lang: Language, now: number = Date.now()): string {
  if (!summary) {
    return ""
  }
  const parts: string[] = []
  if (summary.running > 0) {
    parts.push(`${summary.running} ${t.projectSummaryRunning}`)
  }
  if (summary.attention > 0) {
    parts.push(`${summary.attention} ${t.projectSummaryAttention}`)
  }
  if (parts.length > 0) {
    parts.push(`${summary.sessions} ${summary.sessions === 1 ? t.conversation : t.conversations}`)
    return parts.join(" · ")
  }
  if (summary.sessions === 0) {
    return t.projectSummaryEmpty
  }
  const relative = summary.lastActivity > 0 ? formatRelative(summary.lastActivity, lang, now) : ""
  return relative
    ? `${t.projectSummaryIdle} · ${t.projectSummaryLastActivity} ${relative}`
    : t.projectSummaryIdle
}
