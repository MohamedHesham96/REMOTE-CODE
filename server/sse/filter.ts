import type { Event } from "@opencode-ai/sdk"

export function questionEvent(event: Event): { type: string; properties: { sessionID: string; requestID?: string } } | null {
  const candidate = event as unknown as { type?: unknown; properties?: unknown; data?: unknown }
  if (typeof candidate.type !== "string") {
    return null
  }
  if (
    candidate.type !== "question.asked"
    && candidate.type !== "question.replied"
    && candidate.type !== "question.rejected"
    && candidate.type !== "question.v2.asked"
    && candidate.type !== "question.v2.replied"
    && candidate.type !== "question.v2.rejected"
  ) {
    return null
  }
  const source = (candidate.properties ?? candidate.data) as { sessionID?: unknown; id?: unknown; requestID?: unknown } | undefined
  if (!source || typeof source.sessionID !== "string") {
    return null
  }
  const requestID = typeof source.id === "string" ? source.id : typeof source.requestID === "string" ? source.requestID : undefined
  return { type: candidate.type, properties: requestID ? { sessionID: source.sessionID, requestID } : { sessionID: source.sessionID } }
}

export function clientEvent(event: Event): Record<string, unknown> | null {
  const question = questionEvent(event)
  if (question) {
    return question
  }
  if (event.type === "session.status" || event.type === "session.idle" || event.type === "session.error") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "todo.updated") {
    return { type: event.type, properties: { sessionID: event.properties.sessionID, todos: event.properties.todos } }
  }
  if (event.type === "permission.updated") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "permission.replied") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "message.updated") {
    const sessionID = (event.properties.info as { sessionID?: unknown } | undefined)?.sessionID
    return {
      type: event.type,
      properties: typeof sessionID === "string"
        ? { sessionID, info: event.properties.info }
        : { info: event.properties.info },
    }
  }
  if (event.type === "message.removed") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "message.part.updated") {
    const part = event.properties.part as { sessionID?: unknown } | undefined
    const sessionID = typeof part?.sessionID === "string" ? part.sessionID : undefined
    return {
      type: event.type,
      properties: sessionID ? { sessionID, ...event.properties } : event.properties,
    }
  }
  if (event.type === "message.part.removed") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "session.diff") {
    return { type: event.type, properties: event.properties }
  }
  if (event.type === "session.compacted") {
    return { type: event.type, properties: event.properties }
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
