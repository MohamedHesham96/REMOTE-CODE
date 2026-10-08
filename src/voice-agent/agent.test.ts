import { describe, expect, it, vi } from "vitest"
import { interpretVoiceTurn, rememberExecutedSteps, voiceCancelPending, voiceChooseCandidate, voiceConfirmPending, type VoiceAgentTurn } from "./agent"
import { arStrings, makeContext, makeModel, makeProject, makeSession, type ContextOptions } from "./context-fixtures"
import { runVoicePlan, VOICE_ACTIONS, type VoiceExecutors, type VoiceExecutorOutcome } from "./registry"
import { createVoiceAgentSession, type VoiceAgentSession } from "./session"
import type { VoiceAppContext } from "./context"

const t = arStrings()

interface Harness {
  executors: VoiceExecutors
  calls: string[]
  contexts: { current: VoiceAppContext }
  run: (turn: Extract<VoiceAgentTurn, { kind: "execute" }>) => Promise<ReturnType<typeof runVoicePlan> extends Promise<infer R> ? R : never>
}

const OK: VoiceExecutorOutcome = { ok: true }

function makeExecutors(contexts: { current: VoiceAppContext }, calls: string[], overrides: Partial<VoiceExecutors> = {}): VoiceExecutors {
  const record = (name: string) => calls.push(name)
  return {
    openProject: async () => { record("openProject"); return OK },
    openConversation: async () => { record("openConversation"); return OK },
    revealRequests: () => { record("revealRequests"); return OK },
    openRunning: () => { record("openRunning"); return OK },
    openAttention: () => { record("openAttention"); return OK },
    openHistory: () => { record("openHistory"); return OK },
    openPinned: () => { record("openPinned"); return OK },
    openGit: () => { record("openGit"); return OK },
    openSettings: () => { record("openSettings"); return OK },
    openModels: () => { record("openModels"); return OK },
    openReleases: () => { record("openReleases"); return OK },
    createConversation: async () => { record("createConversation"); return OK },
    goBack: () => { record("goBack"); return OK },
    stopTask: async () => { record("stopTask"); return OK },
    changeModel: async () => { record("changeModel"); return OK },
    setTheme: () => { record("setTheme"); return OK },
    setLanguage: () => { record("setLanguage"); return OK },
    setSound: () => { record("setSound"); return OK },
    gitRevertAll: async () => { record("gitRevertAll"); return OK },
    gitCommitPush: async () => { record("gitCommitPush"); return OK },
    gitPull: async () => { record("gitPull"); return OK },
    ...overrides,
  }
}

function harness(options: ContextOptions = {}, overrides: Partial<VoiceExecutors> = {}): Harness {
  const contexts = { current: makeContext(options) }
  const calls: string[] = []
  const executors = makeExecutors(contexts, calls, overrides)
  return {
    executors,
    calls,
    contexts,
    run: (turn) => runVoicePlan(turn.steps, executors, () => contexts.current, { lastEntity: null, lastListKind: null }, t, { waitBetweenSteps: async () => undefined }),
  }
}

function turnFor(transcript: string, contexts: { current: VoiceAppContext }, session: VoiceAgentSession = createVoiceAgentSession()): VoiceAgentTurn {
  return interpretVoiceTurn({ transcript, context: contexts.current, session, t })
}

describe("تنفيذ الأوامر البسيطة الآمنة", () => {
  it("صيغ متعددة لعرض الطلبات تنفّذ نفس الإجراء", async () => {
    for (const phrase of ["Open requests", "Show me the requests", "عرض الطلبات", "عايز أشوف الطلبات"]) {
      const test = harness()
      const turn = turnFor(phrase, test.contexts)
      expect(turn.kind, phrase).toBe("execute")
      if (turn.kind !== "execute") {
        continue
      }
      const result = await test.run(turn)
      expect(result.ok, phrase).toBe(true)
      expect(test.calls, phrase).toEqual(["revealRequests"])
    }
  })

  it("فتح مشروع بالاسم ينادي openProject نفسه", async () => {
    let opened = ""
    const test = harness({ projects: [makeProject("Other"), makeProject("RemoteCode")] }, {
      openProject: async (project) => { opened = project.name ?? ""; return OK },
    })
    const turn = turnFor("Take me to the RemoteCode project", test.contexts)
    expect(turn.kind).toBe("execute")
    const result = await test.run(turn as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(result.ok).toBe(true)
    expect(opened).toBe("RemoteCode")
    expect(result.message).toContain("RemoteCode")
  })

  it("فتح الإعدادات ينادي openSettings", async () => {
    const test = harness()
    const turn = turnFor("افتح الإعدادات", test.contexts)
    const result = await test.run(turn as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(test.calls).toEqual(["openSettings"])
    expect(result.ok).toBe(true)
  })

  it("تبديل النموذج الأسرع ينفّذ CHANGE_MODEL على النموذج الصحيح", async () => {
    let changed = ""
    const test = harness({
      models: [makeModel("gpt-4o", "GPT-4o"), makeModel("gpt-4o-mini", "GPT-4o mini")],
      currentModel: { providerID: "test", modelID: "gpt-4o" },
    }, {
      changeModel: async (ref) => { changed = ref.modelID; return OK },
    })
    const turn = turnFor("Switch to the faster model", test.contexts)
    const result = await test.run(turn as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(result.ok).toBe(true)
    expect(changed).toBe("gpt-4o-mini")
  })
})

describe("السياق", () => {
  it("المشروع الحالي يتجسّد من التحديد الفعلي", async () => {
    let opened = ""
    const test = harness({
      projects: [makeProject("Alpha"), makeProject("RemoteCode")],
      selected: makeProject("Alpha"),
    }, {
      openProject: async (project) => { opened = project.name ?? ""; return OK },
    })
    const turn = turnFor("Open the current project", test.contexts)
    await test.run(turn as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(opened).toBe("Alpha")
  })

  it("آخر محادثة تُتجسّد من ترتيب العرض في المشروع الحالي", async () => {
    let opened = ""
    const test = harness({
      sessions: [makeSession("newest", "Newest", 30), makeSession("older", "Older", 10)],
    }, {
      openConversation: async (session) => { opened = session.id; return OK },
    })
    const turn = turnFor("افتح آخر محادثة", test.contexts)
    await test.run(turn as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(opened).toBe("newest")
  })

  it("المشروع التاني يتجسّد من ترتيب القائمة المعروضة", async () => {
    let opened = ""
    const test = harness({
      projects: [makeProject("RemoteCode"), makeProject("Alpha")],
      selected: makeProject("RemoteCode"),
    }, {
      openProject: async (project) => { opened = project.name ?? ""; return OK },
    })
    const turn = turnFor("افتح المشروع التاني", test.contexts)
    await test.run(turn as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(opened).toBe("Alpha")
  })
})

describe("الالتباس والتوضيح", () => {
  it("لا يخمّن لما يلاقي أكتر من تطابق ويسأل", () => {
    const test = harness({ projects: [makeProject("RemoteCode"), makeProject("RemoteCode Tools")] })
    const turn = turnFor("افتح مشروع RemoteCode", test.contexts)
    expect(turn.kind).toBe("clarify")
    if (turn.kind === "clarify") {
      expect(turn.candidates).toHaveLength(2)
      expect(turn.question).toBe(t.voiceWhichProject)
    }
  })

  it("يكمل الخطة بعد إجابة بالترتيب", async () => {
    let opened = ""
    const test = harness({ projects: [makeProject("RemoteCode"), makeProject("RemoteCode Tools")] }, {
      openProject: async (project) => { opened = project.name ?? ""; return OK },
    })
    const first = turnFor("افتح مشروع RemoteCode", test.contexts)
    expect(first.kind).toBe("clarify")
    const second = interpretVoiceTurn({ transcript: "التاني", context: test.contexts.current, session: first.session, t })
    expect(second.kind).toBe("execute")
    await test.run(second as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(opened).toBe("RemoteCode Tools")
  })

  it("يكمل الخطة بعد إجابة باسم العنصر", async () => {
    let opened = ""
    const test = harness({ projects: [makeProject("RemoteCode"), makeProject("RemoteCode Tools")] }, {
      openProject: async (project) => { opened = project.name ?? ""; return OK },
    })
    const first = turnFor("افتح مشروع RemoteCode", test.contexts)
    const second = interpretVoiceTurn({ transcript: "Tools", context: test.contexts.current, session: first.session, t })
    expect(second.kind).toBe("execute")
    await test.run(second as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(opened).toBe("RemoteCode Tools")
  })

  it("اختيار المرشح باللمس يسلك نفس المسار", async () => {
    const first = turnFor("افتح مشروع RemoteCode", harness({ projects: [makeProject("RemoteCode"), makeProject("RemoteCode Tools")] }).contexts)
    expect(first.kind).toBe("clarify")
    if (first.kind !== "clarify") {
      return
    }
    const chosen = first.candidates[1]!
    const turn = voiceChooseCandidate(first.session, chosen, makeContext({ projects: [makeProject("RemoteCode"), makeProject("RemoteCode Tools")] }), t)
    expect(turn.kind).toBe("execute")
  })

  it("إجابة غير مفهومة تُبقي السؤال معلّقًا", () => {
    const test = harness({ projects: [makeProject("RemoteCode"), makeProject("RemoteCode Tools")] })
    const first = turnFor("افتح مشروع RemoteCode", test.contexts)
    const second = interpretVoiceTurn({ transcript: "حاجة غريبة خالص", context: test.contexts.current, session: first.session, t })
    expect(second.kind).toBe("reply")
    expect(second.session.pending?.kind).toBe("clarify")
  })
})

describe("الأوامر المتعددة الخطوات", () => {
  it("جملة مركّبة تُعرض كمعاينة قبل التنفيذ ثم تتنفّذ بالترتيب", async () => {
    const other = makeProject("Other")
    const remote = makeProject("RemoteCode")
    const contexts: { current: VoiceAppContext } = {
      current: makeContext({
        projects: [other, remote],
        selected: other,
        sessions: [makeSession("o1", "Other work", 10, "C:/work/Other")],
      }),
    }
    const calls: string[] = []
    let openedConversation = ""
    const executors = makeExecutors(contexts, calls, {
      openProject: async (project) => {
        calls.push("openProject")
        // محاكاة التطبيق الحقيقي: فتح المشروع بيغيّر السياق الحيّ
        contexts.current = makeContext({
          projects: [other, remote],
          selected: project,
          sessions: [makeSession("rc1", "RemoteCode task", 40, "C:/work/RemoteCode"), makeSession("rc0", "Old task", 20, "C:/work/RemoteCode")],
        })
        return OK
      },
      openConversation: async (session) => { calls.push("openConversation"); openedConversation = session.id; return OK },
    })
    const turn = interpretVoiceTurn({
      transcript: "Open RemoteCode, then open the latest conversation and show me the requests",
      context: contexts.current,
      session: createVoiceAgentSession(),
      t,
    })
    expect(turn.kind).toBe("preview")
    if (turn.kind !== "preview") {
      return
    }
    expect(turn.steps.map((step) => step.action)).toEqual(["OPEN_PROJECT", "OPEN_CONVERSATION", "SHOW_REQUESTS"])

    const executeTurn = voiceConfirmPending(turn.session, t)
    expect(executeTurn.kind).toBe("execute")
    const result = await runVoicePlan((executeTurn as Extract<VoiceAgentTurn, { kind: "execute" }>).steps, executors, () => contexts.current, { lastEntity: null, lastListKind: null }, t, { waitBetweenSteps: async () => undefined })
    expect(result.ok).toBe(true)
    expect(calls).toEqual(["openProject", "openConversation", "revealRequests"])
    // "آخر محادثة" اتجسّدت من مشروع RemoteCode بعد فتحه، مش من المشروع القديم
    expect(openedConversation).toBe("rc1")
  })

  it("خطوة غير قابلة للحل توقف الخطة كلها بلا تنفيذ جزئي", async () => {
    const test = harness({ projects: [makeProject("RemoteCode")] })
    const turn = interpretVoiceTurn({
      transcript: "Open RemoteCode, then open project Xyzzy",
      context: test.contexts.current,
      session: createVoiceAgentSession(),
      t,
    })
    expect(turn.kind).toBe("reply")
    expect(turn.kind === "reply" && turn.tone).toBe("error")
    expect(test.calls).toEqual([])
  })
})

describe("الأمان والتأكيد", () => {
  it("إيقاف المهمة يطلب تأكيدًا قبل التنفيذ", () => {
    const test = harness({ requests: { running: true } })
    const turn = turnFor("stop the task", test.contexts)
    expect(turn.kind).toBe("confirm")
    expect(turn.kind === "confirm" && turn.question).toBe(t.voiceConfirmStopTask)
  })

  it("الرفض يلغي المعلّق بلا تنفيذ", () => {
    const test = harness({ requests: { running: true } })
    const first = turnFor("stop the task", test.contexts)
    const second = interpretVoiceTurn({ transcript: "لا", context: test.contexts.current, session: first.session, t })
    expect(second.kind).toBe("reply")
    expect(second.kind === "reply" && second.message).toBe(t.voicePendingCancelled)
    expect(second.session.pending).toBeNull()
    expect(test.calls).toEqual([])
  })

  it("التأكيد ينفّذ نفس الإجراء المعلّق", async () => {
    const test = harness({ requests: { running: true } })
    const first = turnFor("stop the task", test.contexts)
    const second = interpretVoiceTurn({ transcript: "نعم", context: test.contexts.current, session: first.session, t })
    expect(second.kind).toBe("execute")
    await test.run(second as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(test.calls).toEqual(["stopTask"])
  })

  it("أمر جديد واضح يلغي المعلّق ولا ينفّذه أبدًا", async () => {
    const test = harness({ requests: { running: true } })
    const first = turnFor("stop the task", test.contexts)
    const second = interpretVoiceTurn({ transcript: "افتح الإعدادات", context: test.contexts.current, session: first.session, t })
    expect(second.kind).toBe("execute")
    await test.run(second as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(test.calls).toEqual(["openSettings"])
  })

  it("التراجع عن التغييرات يطلب تأكيدًا", () => {
    const test = harness({ git: { available: true, changedCount: 3 } })
    const turn = turnFor("Rollback this change.", test.contexts)
    expect(turn.kind).toBe("confirm")
    expect(turn.kind === "confirm" && turn.question).toBe(t.voiceConfirmRevertAll)
  })

  it("الـ push يطلب تأكيدًا", () => {
    const test = harness({ git: { available: true, changedCount: 3, unpushed: 1 } })
    const turn = turnFor("push my changes", test.contexts)
    expect(turn.kind).toBe("confirm")
  })

  it("التراجع بلا تغييرات يرد بمعلومة ولا يطلب تأكيدًا", () => {
    const test = harness({ git: { available: true, changedCount: 0 } })
    const turn = turnFor("revert all changes", test.contexts)
    expect(turn.kind).toBe("reply")
    expect(turn.kind === "reply" && turn.message).toBe(t.voiceGitNoChanges)
  })

  it("إيقاف مهمة غير جارية يرد بمعلومة", () => {
    const test = harness()
    const turn = turnFor("أوقف المهمة", test.contexts)
    expect(turn.kind).toBe("reply")
    expect(turn.kind === "reply" && turn.message).toBe(t.voiceNothingToStop)
  })

  it("التحقق بيتعاد وقت التنفيذ: حالة اتغيرت بعد التأكيد توقف الخطة", async () => {
    const contexts = { current: makeContext({ requests: { running: true } }) }
    const calls: string[] = []
    const executors = makeExecutors(contexts, calls)
    const turn = turnFor("stop the task", contexts)
    expect(turn.kind).toBe("confirm")
    // المهمة خلصت قبل ما يقول "نعم"
    contexts.current = makeContext({ requests: { running: false } })
    const executeTurn = interpretVoiceTurn({ transcript: "نعم", context: contexts.current, session: turn.session, t })
    expect(executeTurn.kind).toBe("execute")
    const result = await runVoicePlan((executeTurn as Extract<VoiceAgentTurn, { kind: "execute" }>).steps, executors, () => contexts.current, { lastEntity: null, lastListKind: null }, t, { waitBetweenSteps: async () => undefined })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(t.voiceNothingToStop)
    expect(calls).toEqual([])
  })
})

describe("عدم الاختراع والردود الطبيعية", () => {
  it("أمر غير مفهوم يرد بصدق", () => {
    const test = harness()
    const turn = turnFor("Make my application fly", test.contexts)
    expect(turn.kind).toBe("reply")
    expect(turn.kind === "reply" && turn.tone).toBe("error")
    expect(turn.kind === "reply" && turn.message).toBe(t.voiceDidNotUnderstand)
  })

  it("حذف مشروع يرد بأن الإجراء غير متاح بلا أي تنفيذ", () => {
    const test = harness()
    const turn = turnFor("Delete the entire project", test.contexts)
    expect(turn.kind).toBe("reply")
    expect(turn.kind === "reply" && turn.message).toBe(t.voiceUnsupportedAction)
    expect(test.calls).toEqual([])
  })

  it("طلب المساعدة يفتح قسم الأمثلة", () => {
    const test = harness()
    const turn = turnFor("what can you do?", test.contexts)
    expect(turn.kind).toBe("reply")
    expect(turn.kind === "reply" && turn.openHelp).toBe(true)
  })

  it("إيقاف الاستماع أمر محلي بلا تنفيذ إجراءات", () => {
    const test = harness()
    const turn = turnFor("stop listening", test.contexts)
    expect(turn.kind).toBe("stop-listening")
  })
})

describe("الجلسة الحوارية والذاكرة القصيرة", () => {
  it("أمر متابعة يعتمد على السياق المحدَّث بعد التنفيذ", async () => {
    const other = makeProject("Other")
    const remote = makeProject("RemoteCode")
    const contexts: { current: VoiceAppContext } = {
      current: makeContext({ projects: [other, remote], selected: other, sessions: [makeSession("o1", "Other", 10, "C:/work/Other")] }),
    }
    const calls: string[] = []
    const executors = makeExecutors(contexts, calls, {
      openProject: async (project) => {
        calls.push("openProject")
        contexts.current = makeContext({
          projects: [other, remote],
          selected: project,
          sessions: [makeSession("rc1", "Latest RC", 50, "C:/work/RemoteCode")],
        })
        return OK
      },
      openConversation: async (session) => { calls.push(`openConversation:${session.id}`); return OK },
    })
    let session = createVoiceAgentSession()
    const first = interpretVoiceTurn({ transcript: "Open RemoteCode", context: contexts.current, session, t })
    expect(first.kind).toBe("execute")
    const firstResult = await runVoicePlan((first as Extract<VoiceAgentTurn, { kind: "execute" }>).steps, executors, () => contexts.current, { lastEntity: session.lastEntity, lastListKind: null }, t, { waitBetweenSteps: async () => undefined })
    session = rememberExecutedSteps(first.session, firstResult)
    expect(session.lastEntity).toMatchObject({ kind: "project", label: "RemoteCode" })

    const second = interpretVoiceTurn({ transcript: "Now open the latest conversation", context: contexts.current, session, t })
    expect(second.kind).toBe("execute")
    await runVoicePlan((second as Extract<VoiceAgentTurn, { kind: "execute" }>).steps, executors, () => contexts.current, { lastEntity: session.lastEntity, lastListKind: null }, t, { waitBetweenSteps: async () => undefined })
    expect(calls).toEqual(["openProject", "openConversation:rc1"])
  })

  it("الضمير يحل إلى آخر كيان اتفتح", async () => {
    const contexts = { current: makeContext({ sessions: [makeSession("s1", "One", 10), makeSession("s2", "Two", 20)] }) }
    const calls: string[] = []
    const executors = makeExecutors(contexts, calls, {
      openConversation: async (session) => { calls.push(`openConversation:${session.id}`); return OK },
    })
    let session = createVoiceAgentSession()
    const first = interpretVoiceTurn({ transcript: "افتح المحادثة التانية", context: contexts.current, session, t })
    expect(first.kind).toBe("execute")
    const firstResult = await runVoicePlan((first as Extract<VoiceAgentTurn, { kind: "execute" }>).steps, executors, () => contexts.current, { lastEntity: null, lastListKind: null }, t, { waitBetweenSteps: async () => undefined })
    session = rememberExecutedSteps(first.session, firstResult)
    expect(session.lastEntity).toMatchObject({ kind: "conversation", id: "s2" })

    const second = interpretVoiceTurn({ transcript: "افتحه", context: contexts.current, session, t })
    expect(second.kind).toBe("execute")
    await runVoicePlan((second as Extract<VoiceAgentTurn, { kind: "execute" }>).steps, executors, () => contexts.current, { lastEntity: session.lastEntity, lastListKind: null }, t, { waitBetweenSteps: async () => undefined })
    expect(calls).toEqual(["openConversation:s2", "openConversation:s2"])
  })

  it("قائمة المشاريع ثم 'التاني' يفتح المشروع التاني من نفس القائمة", async () => {
    let opened = ""
    const test = harness({
      projects: [makeProject("RemoteCode"), makeProject("Alpha"), makeProject("Beta")],
      selected: makeProject("RemoteCode"),
    }, {
      openProject: async (project) => { opened = project.name ?? ""; return OK },
    })
    const listed = turnFor("إيه المشاريع المتاحة؟", test.contexts)
    expect(listed.kind).toBe("reply")
    if (listed.kind !== "reply") {
      return
    }
    expect(listed.message).toContain("Alpha")
    expect(listed.session.lastList?.kind).toBe("projects")

    const followUp = interpretVoiceTurn({ transcript: "افتح التاني", context: test.contexts.current, session: listed.session, t })
    expect(followUp.kind).toBe("execute")
    await test.run(followUp as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(opened).toBe("Alpha")
  })

  it("إلغاء المعلّق من الواجهة لا ينفّذ شيئًا", () => {
    const test = harness({ requests: { running: true } })
    const first = turnFor("stop the task", test.contexts)
    const cancelled = voiceCancelPending(first.session, t)
    expect(cancelled.kind).toBe("reply")
    expect(cancelled.session.pending).toBeNull()
    expect(test.calls).toEqual([])
  })
})

describe("عقد السجل", () => {
  it("كل إجراء معرّف له validate و execute وسؤال تأكيد للخطير", () => {
    for (const [id, action] of Object.entries(VOICE_ACTIONS)) {
      expect(action.id).toBe(id)
      expect(typeof action.validate).toBe("function")
      expect(typeof action.execute).toBe("function")
      if (action.safety === "confirm") {
        expect(typeof action.confirmQuestion).toBe("function")
      }
    }
  })

  it("الفشل من المنفّذ يوقف الخطة برسالة مفهومة", async () => {
    const test = harness({}, { openProject: async () => ({ ok: false }) })
    const turn = turnFor("افتح مشروع RemoteCode", test.contexts)
    const result = await test.run(turn as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(result.ok).toBe(false)
    expect(result.message).toBe(t.voiceActionFailed)
  })

  it("فتح مشروع مفتوح بالفعل رسالته مختلفة", async () => {
    const test = harness({}, { openProject: async () => ({ ok: true, alreadyActive: true }) })
    const turn = turnFor("افتح مشروع RemoteCode", test.contexts)
    const result = await test.run(turn as Extract<VoiceAgentTurn, { kind: "execute" }>)
    expect(result.message).toBe(t.voiceProjectAlreadyOpen.replace("{name}", "RemoteCode"))
  })
})

// نستخدم vi لمراقبة عدم استدعاء أي منفّذ في مسارات الرفض — تأكيد إضافي
describe("سلامة التنفيذ", () => {
  it("مسارات الالتباس لا تنادي أي منفّذ", () => {
    const spy = vi.fn()
    const test = harness({ projects: [makeProject("RemoteCode"), makeProject("RemoteCode Tools")] }, {
      openProject: async (project) => { spy(project.name); return OK },
    })
    turnFor("افتح مشروع RemoteCode", test.contexts)
    expect(spy).not.toHaveBeenCalled()
  })
})
