import { describe, expect, it } from "vitest"
import { resolveVoiceIntents } from "./resolver"
import { prepareVoicePlan, type VoiceResolutionMemory } from "./planner"
import { arStrings, enStrings, makeContext, makeModel, makeProject, makeRunningSession, makeSession } from "./context-fixtures"
import type { AnyVoicePlanStep, ResolvedVoiceIntent } from "./intents"
import { createVoiceAgentSession } from "./session"

const t = arStrings()

function actionIntents(transcript: string): ResolvedVoiceIntent[] {
  const actionKinds = new Set(["open-project", "open-conversation", "open-named", "open-reference", "show-requests", "show-running", "open-attention", "open-history", "open-pinned", "open-git", "open-settings", "open-models", "open-releases", "change-model", "new-conversation", "go-back", "stop-task", "set-theme", "set-language", "set-sound", "revert-changes", "commit-push", "pull-changes"])
  return resolveVoiceIntents(transcript).filter((intent) => actionKinds.has(intent.kind))
}

function emptyMemory(): VoiceResolutionMemory {
  return { lastEntity: null, lastListKind: null }
}

function stepActions(steps: AnyVoicePlanStep[]): string[] {
  return steps.map((step) => step.action)
}

describe("prepareVoicePlan — تجسيد الكيانات من السياق", () => {
  it("يفتح مشروعًا بالاسم", () => {
    const context = makeContext({ projects: [makeProject("RemoteCode"), makeProject("Other")] })
    const plan = prepareVoicePlan(actionIntents("Open the RemoteCode project"), context, emptyMemory(), t)
    expect(plan.issue).toBeNull()
    expect(plan.ambiguity).toBeNull()
    expect(stepActions(plan.steps)).toEqual(["OPEN_PROJECT"])
    const step = plan.steps[0]
    expect(step?.action === "OPEN_PROJECT" && step.params.project.worktree).toBe("C:/work/RemoteCode")
  })

  it("يفتح آخر محادثة من ترتيب العرض", () => {
    const sessions = [makeSession("s3", "Newest", 30), makeSession("s2", "Middle", 20), makeSession("s1", "Oldest", 10)]
    const context = makeContext({ sessions, currentSessionId: "s2" })
    const plan = prepareVoicePlan(actionIntents("افتح آخر محادثة"), context, emptyMemory(), t)
    expect(stepActions(plan.steps)).toEqual(["OPEN_CONVERSATION"])
    const step = plan.steps[0]
    expect(step?.action === "OPEN_CONVERSATION" && step.params.conversation?.id).toBe("s3")
  })

  it("يفتح المحادثة الحالية بالوصف", () => {
    const sessions = [makeSession("s3", "Newest", 30), makeSession("s2", "Middle", 20)]
    const context = makeContext({ sessions, currentSessionId: "s2" })
    const plan = prepareVoicePlan(actionIntents("افتح المحادثة الحالية"), context, emptyMemory(), t)
    const step = plan.steps[0]
    expect(step?.action === "OPEN_CONVERSATION" && step.params.conversation?.id).toBe("s2")
  })

  it("يحل مشروعًا بالترتيب الرقمي حسب ترتيب العرض", () => {
    const context = makeContext({ projects: [makeProject("RemoteCode"), makeProject("Alpha")], selected: makeProject("RemoteCode") })
    const plan = prepareVoicePlan(actionIntents("افتح المشروع التاني"), context, emptyMemory(), t)
    const step = plan.steps[0]
    expect(step?.action === "OPEN_PROJECT" && step.params.project.name).toBe("Alpha")
  })

  it("يرفض المشروع غير الموجود برسالة واضحة", () => {
    const context = makeContext({ projects: [makeProject("RemoteCode")] })
    const plan = prepareVoicePlan(actionIntents("افتح مشروع Xyzzy"), context, emptyMemory(), t)
    expect(plan.issue?.severity).toBe("problem")
    expect(plan.issue?.message.toLowerCase()).toContain("xyzzy")
  })

  it("يسأل لما أكتر من مشروع يطابق الاسم", () => {
    const context = makeContext({ projects: [makeProject("RemoteCode"), makeProject("RemoteCode Tools")] })
    const plan = prepareVoicePlan(actionIntents("افتح مشروع RemoteCode"), context, emptyMemory(), t)
    expect(plan.ambiguity?.slot).toBe("project")
    expect(plan.ambiguity?.candidates).toHaveLength(2)
    expect(plan.steps).toHaveLength(0)
  })

  it("يرجّع مشكلة معلوماتية للترتيب خارج النطاق", () => {
    const context = makeContext({ projects: [makeProject("RemoteCode")] })
    const plan = prepareVoicePlan(actionIntents("افتح المشروع الخامس"), context, emptyMemory(), t)
    expect(plan.issue?.severity).toBe("info")
  })

  it("يجسّد الاسم غير المصنّف مشروعًا أو محادثة أو نموذجًا حسب التطابق", () => {
    const context = makeContext({
      projects: [makeProject("RemoteCode")],
      sessions: [makeSession("s1", "RemoteCode mobile", 10)],
    })
    const plan = prepareVoicePlan(actionIntents("Open RemoteCode"), context, emptyMemory(), t)
    // الاسم موجود في المشاريع والمحادثات معًا → سؤال توضيحي ولا تخمين
    expect(plan.ambiguity).not.toBeNull()
  })

  it("يفتح الاسم الفريد كمشروع", () => {
    const context = makeContext({ projects: [makeProject("RemoteCode")] })
    const plan = prepareVoicePlan(actionIntents("Open RemoteCode"), context, emptyMemory(), t)
    expect(stepActions(plan.steps)).toEqual(["OPEN_PROJECT"])
  })

  it("يتعامل مع الصيغة العربية المنطوقة للمشروع الإنجليزي", () => {
    const context = makeContext({ projects: [makeProject("REMOTE-CODE", "C:/work/REMOTE-CODE")] })
    const plan = prepareVoicePlan(actionIntents("افتح مشروع ريموت كود"), context, emptyMemory(), t)
    expect(plan.issue).toBeNull()
    expect(stepActions(plan.steps)).toEqual(["OPEN_PROJECT"])
  })

  it("يؤجل تجسيد المحادثة لما خطوة سابقة بتغيّر المشروع", () => {
    const context = makeContext({
      projects: [makeProject("RemoteCode"), makeProject("Other")],
      selected: makeProject("Other"),
      sessions: [makeSession("o1", "Other session", 10, "C:/work/Other")],
    })
    const plan = prepareVoicePlan(actionIntents("Open RemoteCode, then open the latest conversation"), context, emptyMemory(), t)
    expect(stepActions(plan.steps)).toEqual(["OPEN_PROJECT", "OPEN_CONVERSATION"])
    const conversation = plan.steps[1]
    expect(conversation?.action === "OPEN_CONVERSATION" && conversation.params.conversation).toBeNull()
    expect(conversation?.action === "OPEN_CONVERSATION" && conversation.params.deferredProject?.name).toBe("RemoteCode")
  })

  it("يفسّر الضمير من ذاكرة آخر كيان", () => {
    const context = makeContext({
      projects: [makeProject("RemoteCode"), makeProject("Other")],
      sessions: [makeSession("s1", "One", 10), makeSession("s2", "Two", 20)],
    })
    const memory: VoiceResolutionMemory = { lastEntity: { kind: "conversation", id: "s2", label: "Two" }, lastListKind: null }
    const plan = prepareVoicePlan(actionIntents("open it"), context, memory, t)
    const step = plan.steps[0]
    expect(step?.action === "OPEN_CONVERSATION" && step.params.conversation?.id).toBe("s2")
  })

  it("يفسّر 'الأحدث واحد' بنوع آخر كيان مع مرجع أحدث", () => {
    const context = makeContext({
      sessions: [makeSession("s1", "One", 30), makeSession("s2", "Two", 20)],
      currentSessionId: "s2",
    })
    const memory: VoiceResolutionMemory = { lastEntity: { kind: "conversation", id: "s2", label: "Two" }, lastListKind: null }
    const plan = prepareVoicePlan(actionIntents("Open the latest one"), context, memory, t)
    const step = plan.steps[0]
    expect(step?.action === "OPEN_CONVERSATION" && step.params.conversation?.id).toBe("s1")
  })

  it("يفسّر الترتيب بلا نوع من آخر قائمة عرضها الوكيل", () => {
    const context = makeContext({ projects: [makeProject("RemoteCode"), makeProject("Alpha")] })
    const memory: VoiceResolutionMemory = { lastEntity: null, lastListKind: "projects" }
    const plan = prepareVoicePlan(actionIntents("Open the second one"), context, memory, t)
    const step = plan.steps[0]
    expect(step?.action === "OPEN_PROJECT" && step.params.project.name).toBe("Alpha")
  })

  it("يرفض الترتيب بلا نوع ولا قائمة سابقة", () => {
    const context = makeContext({ projects: [makeProject("RemoteCode"), makeProject("Alpha")] })
    const plan = prepareVoicePlan(actionIntents("افتح التاني"), context, emptyMemory(), t)
    expect(plan.issue?.severity).toBe("info")
    expect(plan.issue?.message).toBe(t.voiceOrdinalNoTarget)
  })

  it("يحل صفة النموذج الأسرع من اسم النموذج", () => {
    const context = makeContext({
      models: [makeModel("gpt-4o", "GPT-4o"), makeModel("gpt-4o-mini", "GPT-4o mini")],
      currentModel: { providerID: "test", modelID: "gpt-4o" },
    })
    const plan = prepareVoicePlan(actionIntents("Switch to the faster model"), context, emptyMemory(), t)
    const step = plan.steps[0]
    expect(step?.action === "CHANGE_MODEL" && step.params.ref.modelID).toBe("gpt-4o-mini")
  })

  it("يحل النموذج بالاسم", () => {
    const context = makeContext({ models: [makeModel("sonnet-4", "Sonnet 4"), makeModel("gpt-4o", "GPT-4o")] })
    const plan = prepareVoicePlan(actionIntents("switch to Sonnet"), context, emptyMemory(), t)
    const step = plan.steps[0]
    expect(step?.action === "CHANGE_MODEL" && step.params.info?.id).toBe("sonnet-4")
  })

  it("يسأل لما صفة النموذج تلاقي أكتر من واحد بنفس الدرجة", () => {
    const context = makeContext({ models: [makeModel("fast-a", "Model A fast"), makeModel("fast-b", "Model B fast")] })
    const plan = prepareVoicePlan(actionIntents("بدّل لأسرع نموذج"), context, emptyMemory(), t)
    expect(plan.ambiguity?.slot).toBe("model")
  })

  it("يبني خطوات فتح الشاشات والإعدادات", () => {
    const context = makeContext()
    expect(stepActions(prepareVoicePlan(actionIntents("عرض الطلبات"), context, emptyMemory(), t).steps)).toEqual(["SHOW_REQUESTS"])
    expect(stepActions(prepareVoicePlan(actionIntents("افتح الإعدادات"), context, emptyMemory(), t).steps)).toEqual(["OPEN_SETTINGS"])
    expect(stepActions(prepareVoicePlan(actionIntents("سجل المحادثة"), context, emptyMemory(), t).steps)).toEqual(["OPEN_HISTORY"])
    expect(stepActions(prepareVoicePlan(actionIntents("ملاحظات الإصدار"), context, emptyMemory(), t).steps)).toEqual(["OPEN_RELEASES"])
    expect(stepActions(prepareVoicePlan(actionIntents("switch to dark mode"), context, emptyMemory(), t).steps)).toEqual(["SET_THEME"])
    expect(stepActions(prepareVoicePlan(actionIntents("اكتم الصوت"), context, emptyMemory(), t).steps)).toEqual(["SET_SOUND"])
  })

  it("يبني خطوات Git الآمنة وغير الآمنة", () => {
    const context = makeContext({ git: { available: true, changedCount: 3, unpushed: 1 } })
    expect(stepActions(prepareVoicePlan(actionIntents("Rollback this change."), context, emptyMemory(), t).steps)).toEqual(["REVERT_ALL_CHANGES"])
    expect(stepActions(prepareVoicePlan(actionIntents("push my changes"), context, emptyMemory(), t).steps)).toEqual(["COMMIT_PUSH"])
    expect(stepActions(prepareVoicePlan(actionIntents("pull the latest changes"), context, emptyMemory(), t).steps)).toEqual(["PULL_CHANGES"])
  })

  it("يبني الردود الإنجليزية بنصوص اللغة الإنجليزية", () => {
    const en = enStrings()
    const context = makeContext({ projects: [] })
    const plan = prepareVoicePlan(actionIntents("Open the project"), context, emptyMemory(), en)
    expect(plan.issue?.message).toBe(en.voiceNoProjects)
  })

  it("يفتح لوحة ما يعمل الآن خطوة واحدة", () => {
    const context = makeContext({ running: [makeRunningSession("s1", "Work")] })
    const plan = prepareVoicePlan(actionIntents("Show me what is currently running"), context, emptyMemory(), t)
    expect(stepActions(plan.steps)).toEqual(["SHOW_RUNNING"])
  })
})

describe("فحص عقد سجل الإجراءات", () => {
  it("كل إجراء في الخطة معرّف في السجل وله معرّف مطابق", async () => {
    const { VOICE_ACTIONS } = await import("./registry")
    const context = makeContext({ projects: [makeProject("RemoteCode")] })
    const plan = prepareVoicePlan(actionIntents("افتح الإعدادات"), context, emptyMemory(), t)
    for (const step of plan.steps) {
      expect(VOICE_ACTIONS[step.action].id).toBe(step.action)
    }
  })

  it("الذاكرة الابتدائية فاضية", () => {
    const session = createVoiceAgentSession()
    expect(session.pending).toBeNull()
    expect(session.lastEntity).toBeNull()
    expect(session.lastList).toBeNull()
  })
})
