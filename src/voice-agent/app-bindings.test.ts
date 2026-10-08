import { describe, expect, it, vi } from "vitest"
import { buildVoiceContext, buildVoiceExecutors, emptyVoiceContext, type VoiceAppHandlers, type VoiceAppState } from "./app-bindings"
import { makeContext, makeProject, makeSession } from "./context-fixtures"

function baseState(overrides: Partial<VoiceAppState> = {}): VoiceAppState {
  return {
    authState: "signedIn",
    selectedProject: makeProject("RemoteCode"),
    projects: [makeProject("RemoteCode")],
    recentProjects: ["C:/work/RemoteCode"],
    sessions: [makeSession("s1", "Task", 10)],
    activeId: "s1",
    isBusy: false,
    waitingOnUser: false,
    requestsCount: 2,
    requestsRunning: true,
    requestsQueued: false,
    requestsStalled: false,
    running: [],
    attentionItems: [],
    permissions: [],
    questions: [],
    models: [],
    modelsLoading: false,
    currentModel: null,
    defaultModel: null,
    projectDefaultModel: null,
    pendingModel: null,
    pinnedModelKeys: [],
    gitChanges: { branch: "main", available: true, files: [{ path: "a.ts", status: "modified", added: 1, removed: 0 }], unpushed: 3 },
    sending: false,
    theme: "dark",
    language: "ar",
    soundOn: true,
    switchingProject: false,
    panels: { sessions: false, settings: false, models: false, history: false, activity: false, attention: false, pinned: false, releases: false, git: false },
    rememberedSessionId: null,
    ...overrides,
  }
}

function baseHandlers(overrides: Partial<VoiceAppHandlers> = {}): VoiceAppHandlers {
  return {
    openProject: async () => true,
    selectSession: async () => undefined,
    newConversation: async () => undefined,
    stopTask: async () => true,
    changeModel: async () => true,
    getActiveId: () => "s1",
    getSelectedWorktree: () => "C:/work/RemoteCode",
    setTheme: () => undefined,
    setLanguage: () => undefined,
    setSound: () => undefined,
    openPanel: () => undefined,
    closeTopPanel: () => true,
    revealRequests: () => undefined,
    gitActions: { revertAll: async () => true, commitPush: async () => true, pull: async () => true },
    ...overrides,
  }
}

describe("buildVoiceContext", () => {
  it("ينقل الحالة الحية كما هي من غير نسخ إضافي", () => {
    const context = buildVoiceContext(baseState())
    expect(context.signedIn).toBe(true)
    expect(context.project.selected?.name).toBe("RemoteCode")
    expect(context.conversations.current?.id).toBe("s1")
    expect(context.requests.running).toBe(true)
    expect(context.git.changedCount).toBe(1)
    expect(context.git.unpushed).toBe(3)
  })

  it("يحدد الشاشة من أعلى لوحة مفتوحة", () => {
    const state = baseState({ panels: { ...baseState().panels, settings: true, activity: true } })
    expect(buildVoiceContext(state).screen).toBe("settings")
  })

  it("السياق الاحتياطي فاضي وما بيرميش", () => {
    const context = emptyVoiceContext()
    expect(context.project.available).toEqual([])
    expect(context.conversations.current).toBeNull()
  })
})

describe("buildVoiceExecutors", () => {
  it("فتح المشروع المفتوح بالفعل ما بيناديش openProject", async () => {
    const openProject = vi.fn(async () => true)
    const executors = buildVoiceExecutors(() => baseHandlers({ openProject }))
    const outcome = await executors.openProject(makeProject("RemoteCode", "C:/work/RemoteCode"))
    expect(outcome).toEqual({ ok: true, alreadyActive: true })
    expect(openProject).not.toHaveBeenCalled()
  })

  it("فتح مشروع مختلف بينادي openProject الحقيقي", async () => {
    const openProject = vi.fn(async () => true)
    const executors = buildVoiceExecutors(() => baseHandlers({ openProject }))
    const outcome = await executors.openProject(makeProject("Other", "C:/work/Other"))
    expect(outcome).toEqual({ ok: true })
    expect(openProject).toHaveBeenCalledTimes(1)
  })

  it("فتح المحادثة بيتحقق من النتيجة عبر معرّف النشاط الفعلي", async () => {
    let active = "s1"
    const selectSession = vi.fn(async () => { active = "s2" })
    const executors = buildVoiceExecutors(() => baseHandlers({
      selectSession,
      getActiveId: () => active,
    }))
    const outcome = await executors.openConversation(makeSession("s2", "Two", 20))
    expect(outcome.ok).toBe(true)
    expect(selectSession).toHaveBeenCalledWith("s2")
  })

  it("فتح المحادثة المفتوحة بالفعل ما بيناديش selectSession", async () => {
    const selectSession = vi.fn(async () => undefined)
    const executors = buildVoiceExecutors(() => baseHandlers({ selectSession, getActiveId: () => "s1" }))
    const outcome = await executors.openConversation(makeSession("s1", "One", 10))
    expect(outcome).toEqual({ ok: true, alreadyActive: true })
    expect(selectSession).not.toHaveBeenCalled()
  })

  it("الرجوع بيرجع نتيجة قفل اللوحة", async () => {
    const executors = buildVoiceExecutors(() => baseHandlers({ closeTopPanel: () => false }))
    expect(await executors.goBack()).toEqual({ ok: false })
  })

  it("إجراءات Git بتمرر للـ gitActions نفسه", async () => {
    const revertAll = vi.fn(async () => true)
    const executors = buildVoiceExecutors(() => baseHandlers({
      gitActions: { revertAll, commitPush: async () => true, pull: async () => true },
    }))
    expect(await executors.gitRevertAll()).toEqual({ ok: true })
    expect(revertAll).toHaveBeenCalledTimes(1)
  })
})

// السياق الناتج من fixture حقيقي لازم يطابق نفس عقد planner
describe("التوافق مع سياق المخطط", () => {
  it("السياق المبني من حالة التطبيق بيشتغل مع planner", async () => {
    const { prepareVoicePlan } = await import("./planner")
    const { resolveVoiceIntents } = await import("./resolver")
    const { arStrings } = await import("./context-fixtures")
    const context = buildVoiceContext(baseState())
    const intents = resolveVoiceIntents("افتح آخر محادثة").filter((intent) => intent.kind === "open-conversation")
    const plan = prepareVoicePlan(intents, context, { lastEntity: null, lastListKind: null }, arStrings())
    expect(plan.issue).toBeNull()
    expect(plan.steps[0]?.action).toBe("OPEN_CONVERSATION")
  })
})

// دالة الفحص السريع للسياق الاصطناعي المستخدم في اختبارات تانية
describe("makeContext", () => {
  it("يرجّع سياقًا صالحًا للاختبارات", () => {
    const context = makeContext()
    expect(context.project.selected).not.toBeNull()
    expect(context.signedIn).toBe(true)
  })
})
