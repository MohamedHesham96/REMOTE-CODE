// سجل الإجراءات: العقد الوحيد بين وكيل الصوت والتطبيق. كل إجراء بيعرّف
// معرّفه، درجة أمانه (تأكيد مطلوب أو آمن)، تحققه من السياق، سؤال التأكيد،
// ومُنفّذه — والمُنفّذ دايمًا بيلفّ حول معالج موجود في RemoteCode نفسه
// (openProject/selectSession/...). طبقة الفهم لا تنادي أي دالة عشوائية:
// القصد يتحول لمعرّف إجراء مسجّل هنا، وبس.
import { displayTitle, projectName } from "../display"
import type { Strings } from "../i18n"
import { themeLabel } from "../theme"
import type { ModelInfo, Project, Session, SessionModelRef } from "../types"
import { openedVoicePanels, type VoiceAppContext } from "./context"
import type { AnyVoicePlanStep, VoiceActionId, VoiceActionParamsMap, VoiceIssue } from "./intents"
import { resolveConversationReference, type VoiceResolutionMemory } from "./planner"
import { fillTemplate } from "./text"

export interface VoiceExecutorOutcome {
  ok: boolean
  // "الوجهة مفتوحة أصلًا" — مش فشل، بس الرسالة بتفرق
  alreadyActive?: boolean
}

// منفّذو التطبيق: كلهم ملفوفين حول المعالجات الموجودة، ومفيش نسخة تانية من
// منطق التنفيذ هنا. القيم اللي مش بترجّع نتيجة (فتح لوحة) بترجّع ok مباشرة.
export interface VoiceExecutors {
  openProject: (project: Project) => Promise<VoiceExecutorOutcome>
  openConversation: (session: Session) => Promise<VoiceExecutorOutcome>
  revealRequests: () => VoiceExecutorOutcome
  openRunning: () => VoiceExecutorOutcome
  openAttention: () => VoiceExecutorOutcome
  openHistory: () => VoiceExecutorOutcome
  openPinned: () => VoiceExecutorOutcome
  openGit: () => VoiceExecutorOutcome
  openSettings: () => VoiceExecutorOutcome
  openModels: () => VoiceExecutorOutcome
  openReleases: () => VoiceExecutorOutcome
  createConversation: () => Promise<VoiceExecutorOutcome>
  goBack: () => VoiceExecutorOutcome
  stopTask: () => Promise<VoiceExecutorOutcome>
  changeModel: (ref: SessionModelRef, info: ModelInfo | null) => Promise<VoiceExecutorOutcome>
  setTheme: (theme: VoiceActionParamsMap["SET_THEME"]["theme"]) => VoiceExecutorOutcome
  setLanguage: (language: VoiceActionParamsMap["SET_LANGUAGE"]["language"]) => VoiceExecutorOutcome
  setSound: (enabled: boolean) => VoiceExecutorOutcome
  gitRevertAll: () => Promise<VoiceExecutorOutcome>
  gitCommitPush: () => Promise<VoiceExecutorOutcome>
  gitPull: () => Promise<VoiceExecutorOutcome>
}

export type VoiceSafety = "safe" | "confirm"

export interface VoiceActionDefinition<K extends VoiceActionId> {
  id: K
  safety: VoiceSafety
  // تحقق سياقي: بيترجّع مشكلة بتوقف الخطة أو null. "info" حالة طبيعية
  // (مفيش ما يمكن تنفيذه)، و"problem" فشل حقيقي.
  validate: (params: VoiceActionParamsMap[K], context: VoiceAppContext, t: Strings) => VoiceIssue | null
  // سؤال التأكيد الأفعال غير الآمنة — بيتعرض للمستخدم قبل أي تنفيذ
  confirmQuestion?: (t: Strings) => string
  execute: (params: VoiceActionParamsMap[K], executors: VoiceExecutors, context: VoiceAppContext, t: Strings) => Promise<{ outcome: VoiceExecutorOutcome; message: string }>
}

function panelOpened(name: string, t: Strings, outcome: VoiceExecutorOutcome): { outcome: VoiceExecutorOutcome; message: string } {
  return { outcome, message: fillTemplate(t.voiceOpenedWith, { name }) }
}

export const VOICE_ACTIONS: { [K in VoiceActionId]: VoiceActionDefinition<K> } = {
  OPEN_PROJECT: {
    id: "OPEN_PROJECT",
    safety: "safe",
    validate: (_params, context, t) => context.projectSwitching ? { severity: "problem", message: t.voiceSwitchInProgress } : null,
    execute: async (params, executors, _context, t) => {
      const outcome = await executors.openProject(params.project)
      const name = projectName(params.project)
      return {
        outcome,
        message: outcome.ok && outcome.alreadyActive ? fillTemplate(t.voiceProjectAlreadyOpen, { name }) : outcome.ok ? fillTemplate(t.voiceOpenedProject, { name }) : t.voiceActionFailed,
      }
    },
  },
  OPEN_CONVERSATION: {
    id: "OPEN_CONVERSATION",
    safety: "safe",
    validate: () => null,
    execute: async (params, executors, _context, t) => {
      if (!params.conversation) {
        return { outcome: { ok: false }, message: t.voiceConversationNotFound }
      }
      const outcome = await executors.openConversation(params.conversation)
      return {
        outcome,
        message: outcome.ok ? fillTemplate(t.voiceOpenedConversation, { title: displayTitle(params.conversation.title, t) }) : t.voiceActionFailed,
      }
    },
  },
  SHOW_REQUESTS: {
    id: "SHOW_REQUESTS",
    safety: "safe",
    validate: () => null,
    execute: async (_params, executors, _context, t) => ({ outcome: executors.revealRequests(), message: t.voiceShowedRequests }),
  },
  SHOW_RUNNING: {
    id: "SHOW_RUNNING",
    safety: "safe",
    validate: (_params, context, t) => context.running.length === 0 && !context.requests.running && !context.requests.queued ? { severity: "info", message: t.voiceNoRunning } : null,
    execute: async (_params, executors, _context, t) => panelOpened(t.activeConversations, t, executors.openRunning()),
  },
  OPEN_ATTENTION: {
    id: "OPEN_ATTENTION",
    safety: "safe",
    validate: (_params, context, t) => context.attention.items.length === 0 && context.attention.permissions.length === 0 && context.attention.questions.length === 0 ? { severity: "info", message: t.noAttentionItems } : null,
    execute: async (_params, executors, _context, t) => panelOpened(t.needsAttention, t, executors.openAttention()),
  },
  OPEN_HISTORY: {
    id: "OPEN_HISTORY",
    safety: "safe",
    validate: () => null,
    execute: async (_params, executors, _context, t) => panelOpened(t.historyTitle, t, executors.openHistory()),
  },
  OPEN_PINNED: {
    id: "OPEN_PINNED",
    safety: "safe",
    validate: () => null,
    execute: async (_params, executors, _context, t) => panelOpened(t.pinnedConversations, t, executors.openPinned()),
  },
  OPEN_GIT: {
    id: "OPEN_GIT",
    safety: "safe",
    validate: () => null,
    execute: async (_params, executors, _context, t) => panelOpened(t.gitChangesTitle, t, executors.openGit()),
  },
  OPEN_SETTINGS: {
    id: "OPEN_SETTINGS",
    safety: "safe",
    validate: () => null,
    execute: async (_params, executors, _context, t) => panelOpened(t.settings, t, executors.openSettings()),
  },
  OPEN_MODELS: {
    id: "OPEN_MODELS",
    safety: "safe",
    validate: () => null,
    execute: async (_params, executors, _context, t) => panelOpened(t.chooseModel, t, executors.openModels()),
  },
  OPEN_RELEASES: {
    id: "OPEN_RELEASES",
    safety: "safe",
    validate: () => null,
    execute: async (_params, executors, _context, t) => panelOpened(t.releaseNotes, t, executors.openReleases()),
  },
  CHANGE_MODEL: {
    id: "CHANGE_MODEL",
    safety: "safe",
    validate: (_params, context, t) => {
      if (context.models.busy) {
        return { severity: "info", message: t.waitBeforeModelChange }
      }
      if (context.models.loading && context.models.available.length === 0) {
        return { severity: "info", message: t.voiceModelsLoading }
      }
      return null
    },
    execute: async (params, executors, _context, t) => {
      const outcome = await executors.changeModel(params.ref, params.info)
      const name = params.info ? (params.info.name && params.info.name !== params.info.id ? params.info.name : params.info.id) : params.ref.modelID
      return { outcome, message: outcome.ok ? fillTemplate(t.voiceChangedModel, { name }) : t.modelChangeFailed }
    },
  },
  NEW_CONVERSATION: {
    id: "NEW_CONVERSATION",
    safety: "safe",
    validate: (_params, context, t) => context.projectSwitching ? { severity: "problem", message: t.voiceSwitchInProgress } : null,
    execute: async (_params, executors, _context, t) => ({ outcome: await executors.createConversation(), message: t.voiceStartedNewConversation }),
  },
  GO_BACK: {
    id: "GO_BACK",
    safety: "safe",
    validate: (_params, context, t) => openedVoicePanels(context.panels).length === 0 ? { severity: "info", message: t.voiceNothingToGoBack } : null,
    execute: async (_params, executors, _context, t) => {
      const outcome = executors.goBack()
      return { outcome: { ...outcome, ok: true }, message: outcome.ok ? t.voiceWentBack : t.voiceNothingToGoBack }
    },
  },
  STOP_TASK: {
    id: "STOP_TASK",
    safety: "confirm",
    validate: (_params, context, t) => {
      const busy = context.requests.running || context.requests.queued || context.models.busy
      return busy ? null : { severity: "info", message: t.voiceNothingToStop }
    },
    confirmQuestion: (t) => t.voiceConfirmStopTask,
    execute: async (_params, executors, _context, t) => {
      const outcome = await executors.stopTask()
      return { outcome, message: outcome.ok ? t.voiceStoppedTask : t.abortFailed }
    },
  },
  SET_THEME: {
    id: "SET_THEME",
    safety: "safe",
    validate: () => null,
    execute: async (params, executors, _context, t) => ({ outcome: executors.setTheme(params.theme), message: fillTemplate(t.voiceSetTheme, { name: themeLabel(params.theme, t) }) }),
  },
  SET_LANGUAGE: {
    id: "SET_LANGUAGE",
    safety: "safe",
    validate: () => null,
    execute: async (params, executors, _context, t) => ({
      outcome: executors.setLanguage(params.language),
      message: fillTemplate(t.voiceSetLanguage, { name: params.language === "ar" ? t.voiceLanguageArabic : t.voiceLanguageEnglish }),
    }),
  },
  SET_SOUND: {
    id: "SET_SOUND",
    safety: "safe",
    validate: () => null,
    execute: async (params, executors, _context, t) => ({ outcome: executors.setSound(params.enabled), message: params.enabled ? t.voiceSoundOn : t.voiceSoundOff }),
  },
  REVERT_ALL_CHANGES: {
    id: "REVERT_ALL_CHANGES",
    safety: "confirm",
    validate: (_params, context, t) => {
      if (!context.git.available) {
        return { severity: "info", message: t.voiceGitUnavailable }
      }
      if (context.git.busy) {
        return { severity: "info", message: t.voiceGitBusy }
      }
      if (context.git.changedCount === 0) {
        return { severity: "info", message: t.voiceGitNoChanges }
      }
      return null
    },
    confirmQuestion: (t) => t.voiceConfirmRevertAll,
    execute: async (_params, executors, _context, t) => {
      const outcome = await executors.gitRevertAll()
      return { outcome, message: outcome.ok ? t.voiceSentRevertAll : t.voiceActionFailed }
    },
  },
  COMMIT_PUSH: {
    id: "COMMIT_PUSH",
    safety: "confirm",
    validate: (_params, context, t) => {
      if (!context.git.available) {
        return { severity: "info", message: t.voiceGitUnavailable }
      }
      if (context.git.busy) {
        return { severity: "info", message: t.voiceGitBusy }
      }
      if (context.git.changedCount === 0 && context.git.unpushed === 0) {
        return { severity: "info", message: t.voiceGitNoChanges }
      }
      return null
    },
    confirmQuestion: (t) => t.voiceConfirmCommitPush,
    execute: async (_params, executors, _context, t) => {
      const outcome = await executors.gitCommitPush()
      return { outcome, message: outcome.ok ? t.voiceSentCommitPush : t.voiceActionFailed }
    },
  },
  PULL_CHANGES: {
    id: "PULL_CHANGES",
    safety: "safe",
    validate: (_params, context, t) => {
      if (!context.git.available) {
        return { severity: "info", message: t.voiceGitUnavailable }
      }
      if (context.git.busy) {
        return { severity: "info", message: t.voiceGitBusy }
      }
      return null
    },
    execute: async (_params, executors, _context, t) => {
      const outcome = await executors.gitPull()
      return { outcome, message: outcome.ok ? t.voiceSentPull : t.voiceActionFailed }
    },
  },
}

export function isConfirmAction(action: VoiceActionId): boolean {
  return VOICE_ACTIONS[action].safety === "confirm"
}

// تنفيذ خطوة واحدة مع تحقق مسبق. بيتنادى من المشغّل خطوة بخطوة عشان التحقق
// يفضل على أحدث سياق (مثال: فتح مشروع بيغيّر قائمة المحادثات بعده).
export function validateVoiceStep(step: AnyVoicePlanStep, context: VoiceAppContext, t: Strings): VoiceIssue | null {
  switch (step.action) {
    case "OPEN_PROJECT":
      return VOICE_ACTIONS.OPEN_PROJECT.validate(step.params, context, t)
    case "OPEN_CONVERSATION":
      return VOICE_ACTIONS.OPEN_CONVERSATION.validate(step.params, context, t)
    case "SHOW_REQUESTS":
      return VOICE_ACTIONS.SHOW_REQUESTS.validate(step.params, context, t)
    case "SHOW_RUNNING":
      return VOICE_ACTIONS.SHOW_RUNNING.validate(step.params, context, t)
    case "OPEN_ATTENTION":
      return VOICE_ACTIONS.OPEN_ATTENTION.validate(step.params, context, t)
    case "OPEN_HISTORY":
      return VOICE_ACTIONS.OPEN_HISTORY.validate(step.params, context, t)
    case "OPEN_PINNED":
      return VOICE_ACTIONS.OPEN_PINNED.validate(step.params, context, t)
    case "OPEN_GIT":
      return VOICE_ACTIONS.OPEN_GIT.validate(step.params, context, t)
    case "OPEN_SETTINGS":
      return VOICE_ACTIONS.OPEN_SETTINGS.validate(step.params, context, t)
    case "OPEN_MODELS":
      return VOICE_ACTIONS.OPEN_MODELS.validate(step.params, context, t)
    case "OPEN_RELEASES":
      return VOICE_ACTIONS.OPEN_RELEASES.validate(step.params, context, t)
    case "CHANGE_MODEL":
      return VOICE_ACTIONS.CHANGE_MODEL.validate(step.params, context, t)
    case "NEW_CONVERSATION":
      return VOICE_ACTIONS.NEW_CONVERSATION.validate(step.params, context, t)
    case "GO_BACK":
      return VOICE_ACTIONS.GO_BACK.validate(step.params, context, t)
    case "STOP_TASK":
      return VOICE_ACTIONS.STOP_TASK.validate(step.params, context, t)
    case "SET_THEME":
      return VOICE_ACTIONS.SET_THEME.validate(step.params, context, t)
    case "SET_LANGUAGE":
      return VOICE_ACTIONS.SET_LANGUAGE.validate(step.params, context, t)
    case "SET_SOUND":
      return VOICE_ACTIONS.SET_SOUND.validate(step.params, context, t)
    case "REVERT_ALL_CHANGES":
      return VOICE_ACTIONS.REVERT_ALL_CHANGES.validate(step.params, context, t)
    case "COMMIT_PUSH":
      return VOICE_ACTIONS.COMMIT_PUSH.validate(step.params, context, t)
    case "PULL_CHANGES":
      return VOICE_ACTIONS.PULL_CHANGES.validate(step.params, context, t)
  }
}

async function executeVoiceStep(step: AnyVoicePlanStep, executors: VoiceExecutors, context: VoiceAppContext, t: Strings): Promise<{ outcome: VoiceExecutorOutcome; message: string }> {
  switch (step.action) {
    case "OPEN_PROJECT":
      return VOICE_ACTIONS.OPEN_PROJECT.execute(step.params, executors, context, t)
    case "OPEN_CONVERSATION":
      return VOICE_ACTIONS.OPEN_CONVERSATION.execute(step.params, executors, context, t)
    case "SHOW_REQUESTS":
      return VOICE_ACTIONS.SHOW_REQUESTS.execute(step.params, executors, context, t)
    case "SHOW_RUNNING":
      return VOICE_ACTIONS.SHOW_RUNNING.execute(step.params, executors, context, t)
    case "OPEN_ATTENTION":
      return VOICE_ACTIONS.OPEN_ATTENTION.execute(step.params, executors, context, t)
    case "OPEN_HISTORY":
      return VOICE_ACTIONS.OPEN_HISTORY.execute(step.params, executors, context, t)
    case "OPEN_PINNED":
      return VOICE_ACTIONS.OPEN_PINNED.execute(step.params, executors, context, t)
    case "OPEN_GIT":
      return VOICE_ACTIONS.OPEN_GIT.execute(step.params, executors, context, t)
    case "OPEN_SETTINGS":
      return VOICE_ACTIONS.OPEN_SETTINGS.execute(step.params, executors, context, t)
    case "OPEN_MODELS":
      return VOICE_ACTIONS.OPEN_MODELS.execute(step.params, executors, context, t)
    case "OPEN_RELEASES":
      return VOICE_ACTIONS.OPEN_RELEASES.execute(step.params, executors, context, t)
    case "CHANGE_MODEL":
      return VOICE_ACTIONS.CHANGE_MODEL.execute(step.params, executors, context, t)
    case "NEW_CONVERSATION":
      return VOICE_ACTIONS.NEW_CONVERSATION.execute(step.params, executors, context, t)
    case "GO_BACK":
      return VOICE_ACTIONS.GO_BACK.execute(step.params, executors, context, t)
    case "STOP_TASK":
      return VOICE_ACTIONS.STOP_TASK.execute(step.params, executors, context, t)
    case "SET_THEME":
      return VOICE_ACTIONS.SET_THEME.execute(step.params, executors, context, t)
    case "SET_LANGUAGE":
      return VOICE_ACTIONS.SET_LANGUAGE.execute(step.params, executors, context, t)
    case "SET_SOUND":
      return VOICE_ACTIONS.SET_SOUND.execute(step.params, executors, context, t)
    case "REVERT_ALL_CHANGES":
      return VOICE_ACTIONS.REVERT_ALL_CHANGES.execute(step.params, executors, context, t)
    case "COMMIT_PUSH":
      return VOICE_ACTIONS.COMMIT_PUSH.execute(step.params, executors, context, t)
    case "PULL_CHANGES":
      return VOICE_ACTIONS.PULL_CHANGES.execute(step.params, executors, context, t)
  }
}

export interface VoicePlanRunResult {
  ok: boolean
  message: string
  // الخطوات اللي اتنفّذت فعلًا — بتستخدمها الذاكرة القصيرة للجلسة
  executed: AnyVoicePlanStep[]
}

export interface VoicePlanRunnerOptions {
  // فاصل قصير بين الخطوات: التنقل بيحصل عبر state في React، والخطوة اللي
  // بعدها (مثل تجسيد "آخر محادثة" بعد فتح مشروع) لازم تقرأ سياق محدَّث.
  waitBetweenSteps?: () => Promise<void>
}

// تنفيذ خطة كاملة بالتسلسل: تحقق كل خطوة على السياق الطازج ثم تنفيذها.
// أي مشكلة توقف الباقي برسالة مفهومة — مفيش تنفيذ جزئي صامت.
export async function runVoicePlan(
  steps: readonly AnyVoicePlanStep[],
  executors: VoiceExecutors,
  getContext: () => VoiceAppContext,
  memory: VoiceResolutionMemory,
  t: Strings,
  options: VoicePlanRunnerOptions = {},
): Promise<VoicePlanRunResult> {
  const wait = options.waitBetweenSteps ?? (() => new Promise<void>((resolve) => { window.setTimeout(resolve, 160) }))
  const executed: AnyVoicePlanStep[] = []
  const messages: string[] = []
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!
    const context = getContext()
    let effective = step
    if (step.action === "OPEN_CONVERSATION" && !step.params.conversation) {
      // تجسيد مؤجل: المشروع المستهدف اتفتح في خطوة سابقة، وعايزين جلساته
      // الفعلية دلوقتي مش تخمين من قبل الفتح
      const resolution = resolveConversationReference(step.params.reference, context, memory, t)
      if (resolution.kind !== "ok") {
        const message = resolution.kind === "issue" ? resolution.issue.message : resolution.ambiguity.question
        return { ok: false, message, executed }
      }
      effective = { ...step, params: { ...step.params, conversation: resolution.value } }
    }
    const issue = validateVoiceStep(effective, context, t)
    if (issue) {      return { ok: false, message: issue.message, executed }
    }
    const result = await executeVoiceStep(effective, executors, context, t)
    if (!result.outcome.ok) {
      return { ok: false, message: result.message, executed }
    }
    messages.push(result.message)
    executed.push(effective)
    if (index < steps.length - 1) {
      await wait()
    }
  }
  return { ok: true, message: messages.join(" "), executed }
}
