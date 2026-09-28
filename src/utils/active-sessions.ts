import type { ActiveSession, Session, SessionStatus } from "../types"

export interface ActiveProjectRef {
  worktree: string
  name: string
}

// العدّاد على أيقونة النشاط كان بياخد رقمه من /api/activity لوحدها، وده أضيق من
// المصدر اللي الشريط الجانبي بيحكم بيه: statuses من /api/session/status + الطلبات
// المعلّقة + نفس قائمة النشاط. وأبسط من كده إن السيرفر بيطبّق على النشاط
// heuristics (effectiveStatus) مش موجودة في /api/session/status، وبيبلع فشل
// upstream ويرجّع []. النتيجة إن العدّاد كان بيختفي ومحادثات شغالة قدام
// المستخدم. فبنجمع القايمتين: كل ما السيرفر قال إنه نشط، زائد كل جلسة الشريط
// الجانبي الشغالة دلوقتي ونفسها لسه مش في القائمة.
export function mergeActiveSessions(
  items: ActiveSession[],
  sessions: Session[],
  workingIds: ReadonlySet<string>,
  statuses: Record<string, SessionStatus>,
  project: ActiveProjectRef | null,
): ActiveSession[] {
  // مفيش مشروع مفتوح = مفيش جلسات محلية نقدر نبني منها صف. سيب قائمة السيرفر
  // زي ما هي بدل ما نخمّن worktree ونعنّي مشروع غلط.
  if (!project || workingIds.size === 0) {
    return items
  }
  const known = new Set(items.map((item) => item.id))
  const merged = [...items]
  for (const session of sessions) {
    // اللي في قائمة السيرفر هو الأصح: العنوان والـ worktree جايبين من OpenCode
    // وما ينفعش نبنيهم من بيانات العميل. فلوSession موجودة هناك سيبها هي.
    if (known.has(session.id) || !workingIds.has(session.id)) {
      continue
    }
    known.add(session.id)
    const status = statuses[session.id]
    const busy = status?.type === "busy" || status?.type === "retry"
    merged.push({
      id: session.id,
      title: session.title,
      directory: session.directory,
      worktree: project.worktree,
      projectName: project.name,
      // نفس حكم الشريط الجانبي: جلسة شغالة نحسبها busy حتى لو الحالة
      // المحفوظة لسه idle (الجلسة المعتمدة شغالة بسبب طلب في الطابور).
      status: busy ? status : { type: "busy" },
      updatedAt: session.time.updated,
    })
  }
  return merged.sort((left, right) => right.updatedAt - left.updatedAt)
}
