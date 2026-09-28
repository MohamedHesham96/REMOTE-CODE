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
