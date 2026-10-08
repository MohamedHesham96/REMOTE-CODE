import type { OpenCodeEvent } from "@opencode/client"

export function questionEvent(event: OpenCodeEvent): { type: string; properties: { sessionID: string; requestID?: string } } | null {
  const eventType: string = event.type
  // v2 يستبدل الأسئلة باستمارات — نُبقي أسماء v1 على السلك حتى لا تتغير الواجهة.
  if (eventType === "form.created" || eventType === "form.replied" || eventType === "form.cancelled") {
    const data = event.data as { sessionID?: unknown; form?: { id?: unknown; sessionID?: unknown }; id?: unknown } | undefined
    const sessionID = typeof data?.sessionID === "string"
      ? data.sessionID
      : typeof data?.form?.sessionID === "string"
        ? data.form.sessionID
        : undefined
    if (!sessionID) {
      return null
    }
    const requestID = typeof data?.form?.id === "string" ? data.form.id : typeof data?.id === "string" ? data.id : undefined
    const renamed = eventType === "form.created" ? "question.asked" : eventType === "form.replied" ? "question.replied" : "question.rejected"
    return { type: renamed, properties: requestID ? { sessionID, requestID } : { sessionID } }
  }
  return null
}

export function clientEvent(event: OpenCodeEvent): Record<string, unknown> | null {
  const question = questionEvent(event)
  if (question) {
    return question
  }
  // نوع الحدث اتحاد لفظي مغلق — ننسخه لنص حر حتى لا يتكسر كل اسم جديد
  // يضيفه المحرك، والمقارنات التالية أسماء سلكية معروفة فقط.
  const eventType: string = event.type
  if (eventType === "session.status" || eventType === "session.idle") {
    return { type: eventType, properties: event.data }
  }
  // v2 يبلّغ الفشل عبر session.execution.failed — يُترجَم لاسم v1 على السلك.
  if (eventType === "session.execution.failed") {
    return { type: "session.error", properties: { sessionID: (event.data as { sessionID?: unknown }).sessionID } }
  }
  if (eventType === "permission.asked") {
    const data = event.data as unknown as { id: string; sessionID: string; action: string; resources: string[]; message?: unknown }
    return {
      type: "permission.updated",
      properties: {
        id: data.id,
        sessionID: data.sessionID,
        title: typeof data.message === "string" && data.message.trim() ? data.message : data.action,
        pattern: data.resources,
      },
    }
  }
  if (eventType === "permission.replied") {
    const data = event.data as unknown as { sessionID: string; requestID: string }
    return { type: eventType, properties: { sessionID: data.sessionID, permissionID: data.requestID } }
  }
  if (eventType === "session.created" || eventType === "session.deleted") {
    return { type: eventType, properties: event.data }
  }
  // فرع جديد (fork) بيتعامل كجلسة جديدة: العميل بيحدّث قوائمه على الحدث
  // ده، فالفروع اللي بتتعمل من جهاز تاني تبان من غير poll.
  if (eventType === "session.forked") {
    return { type: "session.created", properties: event.data }
  }
  // v2 يفرّق التحديث (renamed/moved) — الواجهة تعرف session.updated فقط.
  // تغيير الموديل/الوكيل من الديسكتوب تحديث أيضًا (يحدّث الموديل المعروض).
  if (
    eventType === "session.renamed"
    || eventType === "session.moved"
    || eventType === "session.model.selected"
    || eventType === "session.agent.selected"
  ) {
    return { type: "session.updated", properties: event.data }
  }
  // عائلة البثّ الحي (نص/أدوات/خطوات/ضغط/تنفيذ): محفّز تحديث فقط،
  // فيُترجَم لاسم v1 الذي تتعرف عليه الواجهة — دون أي معنى إضافي.
  if (
    eventType.startsWith("session.text.")
    || eventType.startsWith("session.reasoning.")
    || eventType.startsWith("session.tool.")
    || eventType.startsWith("session.step.")
    || eventType.startsWith("session.compaction.")
    || eventType === "session.message.content.updated"
    || eventType === "session.execution.started"
    || eventType === "session.execution.succeeded"
    || eventType === "session.execution.interrupted"
    || eventType === "session.retry.scheduled"
  ) {
    return { type: "message.part.updated", properties: { sessionID: (event.data as { sessionID?: unknown }).sessionID } }
  }
  if (
    eventType.startsWith("session.revert.")
    || eventType === "session.permissions"
    || eventType === "session.metadata.updated"
  ) {
    return { type: "session.diff", properties: { sessionID: (event.data as { sessionID?: unknown }).sessionID } }
  }
  return null
}

// حالة الجلسات على السلك بتتكلم عن الجلسة نفسها، ومهمة Task جلسات ابن:
// كل مهمة فرعية بتبعت `busy` و `idle` باسمها هي. فلو العميل سمعها كأنها
// محادثات مستقلة، محادثة واحدة شغّالة على أربع مهام بتعدّ أربع محادثات
// نشطة، وصوت الإتمام بيرنّ مع كل مهمة تخلص مش مع خلوص المحادثة. فبننسب
// كل حالة لجذرها — نفس القاعدة المطبّقة على `/api/session` و
// `/api/session/status`.
export interface ConversationLookup {
  conversationOf(sessionId: string): string
  conversationBusy(sessionId: string): boolean
}

// حالة `idle` بتتعلن على مستوى المحادثة لا المهمة: طول ما الجذر أو مهمة
// تانية في نفس الشجرة شغّالة، الشغل لسه جاري. مهم في حالتين: مهمة بتخلص
// وأختها شغّالة (ما نعلنش خلاص)، والعميل بيسمع حالة الجذر نفسها فنمرّرها
// زي ما هي.
export function conversationEvent(event: OpenCodeEvent, conversations: ConversationLookup): OpenCodeEvent | null {
  // الاتحاد اللفظي المغلق يُنسخ لنص حر — نفس علة clientEvent بالظبط.
  const eventType: string = event.type
  if (eventType !== "session.status" && eventType !== "session.idle") {
    return event
  }
  const properties = event.data as { sessionID?: unknown; status?: { type?: unknown } } | undefined
  const sessionId = typeof properties?.sessionID === "string" ? properties.sessionID : ""
  if (!sessionId) {
    return event
  }
  const root = conversations.conversationOf(sessionId)
  const idle = eventType === "session.idle" || properties?.status?.type === "idle"
  if (idle && conversations.conversationBusy(sessionId)) {
    return null
  }
  if (root === sessionId) {
    return event
  }
  // الحدث الأصلي بيتساب كما هو غير الـ sessionID؛ باقي الحقول (زي
  // `status`) بتتقرا من نفس البيانات.
  return { ...event, data: { ...properties, sessionID: root } } as OpenCodeEvent
}

// v2 غالبًا بيبلّغ نهاية التنفيذ عبر `session.execution.succeeded/failed/interrupted`
// من غير حدث idle صريح بعده، والـ filter بيترجمهم لـ message.part.updated/session.error
// فمفيش انتقال idle بيوصل الواجهة. والواجهة بتبني "شغّالة" من حالة السيرفر وقائمة
// النشاط، والـ polls الدورية واقفة طول ما الـ SSE حي — فالمحادثة تفضل "شغّالة"
// لحد ما المستخدم يعمل refresh. علشان كده بنبني هنا حدث `session.status:idle`
// مصنّع للجذر وقت ما التنفيذ يخلص، بس لو الشجرة كلها فاضية فعلًا (مفيش مهمة
// فرعية شغّالة ولا شغل معلّق في الطابور). الحدث الحقيقي (session.idle/status)
// بيمرّ من مساره الطبيعي، فده مكمّل مش بديل.
export function finishedRunEvent(
  event: OpenCodeEvent,
  conversations: ConversationLookup & { hasPendingWork(sessionId: string): boolean },
): { type: string; properties: { sessionID: string; status: { type: string } } } | null {
  const eventType: string = event.type
  if (
    eventType !== "session.execution.succeeded"
    && eventType !== "session.execution.failed"
    && eventType !== "session.execution.interrupted"
  ) {
    return null
  }
  const sessionId = (event.data as { sessionID?: unknown } | undefined)?.sessionID
  if (typeof sessionId !== "string" || !sessionId) {
    return null
  }
  const root = conversations.conversationOf(sessionId)
  if (conversations.conversationBusy(root) || conversations.hasPendingWork(root)) {
    return null
  }
  return { type: "session.status", properties: { sessionID: root, status: { type: "idle" } } }
}

export function isIdleEvent(event: Record<string, unknown>): boolean {
  if (event.type === "session.idle") {
    return true
  }
  if (event.type !== "session.status") {
    return false
  }
  const status = (event.properties as { status?: { type?: string } } | undefined)?.status
  return status?.type === "idle"
}

export function eventSessionId(event: Record<string, unknown>): string {
  const properties = event.properties as { sessionID?: unknown } | undefined
  return typeof properties?.sessionID === "string" ? properties.sessionID : ""
}
