import type { OpenCodeEvent } from "@opencode/client"
import { describe, expect, it } from "vitest"
import { conversationEvent, finishedRunEvent, type ConversationLookup } from "./filter.js"

// العطل الأصلي: مهمة Task بتفتح جلسات ابن، وحالة كل جلسة بتبعت على الـ id
// بتاعها. فالسيرفر كان بيعدّيها زي ما هي، والعميل كان بيعامل المهمة
// الفرعية كمحادثة مستقلة: `busy` ثم `idle` لكل مهمة، وصوت الإتمام بيرنّ
// مع كل مهمة تخلص مش مع خلوص المحادثة الأم. الجذر هو وحدة العرض والحساب.
function lookup(
  parents: Record<string, string>,
  busy: string[] = [],
  pending: string[] = [],
): ConversationLookup & { hasPendingWork(sessionId: string): boolean } {
  const busySet = new Set(busy)
  const pendingSet = new Set(pending)
  return {
    conversationOf: (sessionId) => {
      let root = sessionId
      const seen = new Set<string>([root])
      let parent = parents[root]
      while (parent && !seen.has(parent)) {
        seen.add(parent)
        root = parent
        parent = parents[root]
      }
      return root
    },
    conversationBusy: (sessionId) => {
      const root = parents[sessionId] ?? sessionId
      if (busySet.has(root)) {
        return true
      }
      return [...busySet].some((id) => (parents[id] ?? id) === root)
    },
    hasPendingWork: (sessionId) => pendingSet.has(sessionId),
  }
}

function status(sessionID: string, type: string): OpenCodeEvent {
  return { type: "session.status", data: { sessionID, status: { type } } } as unknown as OpenCodeEvent
}

function idle(sessionID: string): OpenCodeEvent {
  return { type: "session.idle", data: { sessionID } } as unknown as OpenCodeEvent
}

function sessionIDOf(event: OpenCodeEvent | null): string {
  return String((event?.data as { sessionID?: unknown } | undefined)?.sessionID ?? "")
}

describe("conversationEvent", () => {
  it("ينسب حالة المهمة الفرعية لجذرها", () => {
    const result = conversationEvent(status("ses_kid", "busy"), lookup({ ses_kid: "ses_root" }))

    expect(sessionIDOf(result)).toBe("ses_root")
  })

  it("يحافظ على نوع الحالة بعد النقل", () => {
    const result = conversationEvent(status("ses_kid", "busy"), lookup({ ses_kid: "ses_root" }))

    expect((result?.data as { status?: { type?: string } }).status?.type).toBe("busy")
  })

  it("يعدّ المهمة جوه مهمة على نفس الجذر", () => {
    const result = conversationEvent(status("ses_leaf", "busy"), lookup({ ses_mid: "ses_root", ses_leaf: "ses_mid" }))

    expect(sessionIDOf(result)).toBe("ses_root")
  })

  it("يمرّر المحادثة الأم زي ما هي", () => {
    const event = status("ses_root", "busy")
    const result = conversationEvent(event, lookup({ ses_kid: "ses_root" }))

    expect(result).toBe(event)
  })

  // قلب العطل: مهمة بتخلص وأختها شغّالة — إعلان الخلوص ده بينسب للمحادثة
  // الأم فيسمع المستخدم صوت إتمام وهو لسه شغّال.
  it("لا يعلن خلوص المحادثة لخلوص مهمة وأخوها شغّالة", () => {
    expect(conversationEvent(idle("ses_kid_a"), lookup({ ses_kid_a: "ses_root", ses_kid_b: "ses_root" }, ["ses_kid_b"]))).toBeNull()
  })

  it("لا يعلن الخلاص من نوع status:idle كمان", () => {
    expect(conversationEvent(status("ses_kid_a", "idle"), lookup({ ses_kid_a: "ses_root" }, ["ses_root"]))).toBeNull()
  })

  // الجسر بيشتغل بعد `trackEvent` يشيل الجلسة الخاملة من مجموع الشغّال، فآخر
  // مهمة تخلص بتبقى الحطة فاضية وده هو اللي لازم يعلن الخلوص.
  it("يعلن خلوص المحادثة لآخر مهمة تخلص", () => {
    const result = conversationEvent(idle("ses_kid_b"), lookup({ ses_kid_a: "ses_root", ses_kid_b: "ses_root" }))

    expect(sessionIDOf(result)).toBe("ses_root")
  })

  it("يعلن خلوص المحادثة لخلوص الجذر نفسه", () => {
    const result = conversationEvent(idle("ses_root"), lookup({ ses_kid: "ses_root" }))

    expect(sessionIDOf(result)).toBe("ses_root")
  })

  it("يمرّر الأحداث التانية زي ما هي", () => {
    const event = { type: "session.created", data: { sessionID: "ses_kid", parentID: "ses_root" } } as unknown as OpenCodeEvent

    expect(conversationEvent(event, lookup({ ses_kid: "ses_root" }))).toBe(event)
  })

  it("يترك الحدث كما هو لو مفيش session id", () => {
    const event = { type: "session.idle", data: {} } as unknown as OpenCodeEvent

    expect(conversationEvent(event, lookup({}))).toBe(event)
  })
})

// العطل: v2 بيبلّغ نهاية التنفيذ عبر session.execution.* من غير idle صريح بعده،
// فالواجهة كانت تفضل شايفة المحادثة "شغّالة" لحد refresh يدوي. الحل: حدث idle
// مصنّع للجذر، بس لما الشجرة كلها تبقى فاضية فعلًا.
function execution(sessionID: string, type = "session.execution.succeeded"): OpenCodeEvent {
  return { type, data: { sessionID } } as unknown as OpenCodeEvent
}

describe("finishedRunEvent", () => {
  it("يبني idle مصنّع لجذر المحادثة لما التنفيذ ينجح", () => {
    const result = finishedRunEvent(execution("ses_kid"), lookup({ ses_kid: "ses_root" }))

    expect(result).toEqual({ type: "session.status", properties: { sessionID: "ses_root", status: { type: "idle" } } })
  })

  it("يبني idle مصنّع للجذر نفسه", () => {
    const result = finishedRunEvent(execution("ses_root"), lookup({}))

    expect(result?.properties.sessionID).toBe("ses_root")
  })

  it("يغطّي الفشل والإيقاف كمان", () => {
    expect(finishedRunEvent(execution("ses_root", "session.execution.failed"), lookup({}))).not.toBeNull()
    expect(finishedRunEvent(execution("ses_root", "session.execution.interrupted"), lookup({}))).not.toBeNull()
  })

  it("ميبعتش idle لو مهمة فرعية تانية لسه شغّالة في نفس الشجرة", () => {
    const conversations = lookup({ ses_kid_a: "ses_root", ses_kid_b: "ses_root" }, ["ses_kid_b"])

    expect(finishedRunEvent(execution("ses_kid_a"), conversations)).toBeNull()
  })

  it("ميبعتش idle لو فيه شغل معلّق في الطابور", () => {
    expect(finishedRunEvent(execution("ses_root"), lookup({}, [], ["ses_root"]))).toBeNull()
  })

  it("يتجاهل الأحداث اللي مش نهاية تنفيذ", () => {
    expect(finishedRunEvent({ type: "session.status", data: { sessionID: "ses_root" } } as unknown as OpenCodeEvent, lookup({}))).toBeNull()
  })

  it("يتجاهل حدث ناقص من غير session id", () => {
    expect(finishedRunEvent({ type: "session.execution.succeeded", data: {} } as unknown as OpenCodeEvent, lookup({}))).toBeNull()
  })
})
