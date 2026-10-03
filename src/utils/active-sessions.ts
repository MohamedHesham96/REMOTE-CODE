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
//
// التجميع بيقبل دليلين مستقلين بس: `busyIds` (حالة السيرفر نفسها: busy/retry)
// و`pendingIds` (طلب في العميل لسه شغّال أو مستني في الطابور). اللي كان بيكسر
// القاعدة هو إن القائمة المدمجة نفسها كانت بتدخل في حكم "الجلسة دي شغالة" —
// يعني وجودها في استجابة النشاط السابقة بيخلّيها تنضم لنفسها في الجاية كـ busy
// حتى بعد ما السيرفر شالها. النتيجة إن كل جلسة شفتها نشطة مرة واحدة كانت
// بتفضل في اللوحة للأبد، فالعدّاد بيقفز من واحد لأربعة وما بينزلش. القاعدة هنا
// إن العميل يقدر يزيد جلسة على السيرفر بدليل، بس ما يقدرش يناقض حكمه: لو
// السيرفر قال idle، ما بنحوّلهاش لـ busy لمجرد إنها ظهرت قبل كده.
export function mergeActiveSessions(
  items: ActiveSession[],
  sessions: Session[],
  busyIds: ReadonlySet<string>,
  pendingIds: ReadonlySet<string>,
  statuses: Record<string, SessionStatus>,
  project: ActiveProjectRef | null,
): ActiveSession[] {
  // مفيش مشروع مفتوح = مفيش جلسات محلية نقدر نبني منها صف. سيب قائمة السيرفر
  // زي ما هي بدل ما نخمّن worktree ونعنّي مشروع غلط.
  if (!project || (busyIds.size === 0 && pendingIds.size === 0)) {
    return items
  }
  const known = new Set(items.map((item) => item.id))
  const merged = [...items]
  for (const session of sessions) {
    // اللي في قائمة السيرفر هو الأصح: العنوان والـ worktree جايبين من OpenCode
    // وما ينفعش نبنيهم من بيانات العميل. فلو Session موجودة هناك سيبها هي.
    if (known.has(session.id) || (!busyIds.has(session.id) && !pendingIds.has(session.id))) {
      continue
    }
    known.add(session.id)
    // حالة السيرفر هي المصدر: لو قال busy/retry بنعرضها زي ما هي (الـ retry
    // بيوريه رسالة المحاولة الجاية). غير كده — يعني مفيش حالة محفوظة، أو
    // الحالة idle والطلب المعلّق هو دليلنا الوحيد — بنعرض شغالة، زي ما الشريط
    // الجانبي بيحكم.
    const stored = statuses[session.id]
    const status: SessionStatus = stored?.type === "busy" || stored?.type === "retry" ? stored : { type: "busy" }
    merged.push({
      id: session.id,
      title: session.title,
      directory: session.directory,
      worktree: project.worktree,
      projectName: project.name,
      status,
      updatedAt: session.time.updated,
    })
  }
  return merged.sort((left, right) => right.updatedAt - left.updatedAt)
}
