// جسر التطبيق: يبني كائن السياق ومنفّذي الإجراءات من حالة RemoteCode
// الفعلية ومعالجاتها. الوكلاء هنا رقيقة عن قصد — كل واحد بينادي دالة
// موجودة بالفعل (openProject/selectSession/...) وبيرجّع نتيجة مفهومة
// للطبقة الصوتية، من غير أي منطق عمل جديد.
import { samePath } from "../display"
import type { Language } from "../i18n"
import type { AppTheme } from "../theme"
import type { ActiveSession, AttentionItem, AuthState, ConversationQuestionRequest, GitChanges, ModelInfo, Permission, Project, Session, SessionModelRef } from "../types"
import { voiceScreenOf, type VoiceAppContext, type VoicePanelId, type VoicePanelsState } from "./context"
import type { VoiceExecutorOutcome, VoiceExecutors } from "./registry"

export interface VoiceAppState {
  authState: AuthState
  selectedProject: Project | null
  projects: Project[]
  recentProjects: string[]
  sessions: Session[]
  activeId: string | null
  isBusy: boolean
  waitingOnUser: boolean
  requestsCount: number
  requestsRunning: boolean
  requestsQueued: boolean
  requestsStalled: boolean
  running: ActiveSession[]
  attentionItems: AttentionItem[]
  permissions: Permission[]
  questions: ConversationQuestionRequest[]
  models: ModelInfo[]
  modelsLoading: boolean
  currentModel: SessionModelRef | null
  defaultModel: SessionModelRef | null
  projectDefaultModel: SessionModelRef | null
  pendingModel: SessionModelRef | null
  pinnedModelKeys: string[]
  gitChanges: GitChanges | null
  sending: boolean
  theme: AppTheme
  language: Language
  soundOn: boolean
  switchingProject: boolean
  panels: VoicePanelsState
  // آخر محادثة محفوظة للمشروع الحالي (loadLastSessions) لدعم مرجع "اللي كنت شغال عليها"
  rememberedSessionId: string | null
}

// نفس شكل openedVoicePanels — بنحسبه هنا من الأعلام مباشرة
export function buildVoiceContext(state: VoiceAppState): VoiceAppContext {
  const currentSession = state.activeId ? state.sessions.find((session) => session.id === state.activeId) ?? null : null
  const gitFiles = state.gitChanges?.available ? state.gitChanges.files : []
  const changedCount = gitFiles.filter((file) => file.status === "added" || file.status === "modified" || file.status === "deleted").length
  return {
    signedIn: state.authState === "signedIn",
    screen: voiceScreenOf(state.panels),
    panels: state.panels,
    project: {
      selected: state.selectedProject,
      available: state.projects,
      recentPaths: state.recentProjects,
    },
    conversations: {
      current: currentSession,
      available: state.sessions,
      pinned: [],
      remembered: state.rememberedSessionId,
    },
    running: state.running,
    attention: {
      items: state.attentionItems,
      permissions: state.permissions,
      questions: state.questions,
    },
    models: {
      available: state.models,
      current: state.currentModel,
      defaultRef: state.defaultModel,
      projectDefault: state.projectDefaultModel,
      pending: state.pendingModel,
      pinned: state.pinnedModelKeys,
      loading: state.modelsLoading,
      busy: state.isBusy,
    },
    requests: {
      count: state.requestsCount,
      running: state.requestsRunning,
      queued: state.requestsQueued,
      stalled: state.requestsStalled,
      waitingOnUser: state.waitingOnUser,
    },
    git: {
      available: Boolean(state.gitChanges?.available),
      changedCount,
      unpushed: state.gitChanges?.unpushed ?? 0,
      busy: state.sending,
    },
    theme: state.theme,
    language: state.language,
    soundOn: state.soundOn,
    projectSwitching: state.switchingProject,
  }
}

export interface VoiceAppHandlers {
  // بيرجّعوا نتيجة مفهومة للطبقة الصوتية؛ التنفيذ نفسه هو منطق التطبيق الموجود
  openProject: (project: Project) => Promise<boolean>
  selectSession: (id: string) => Promise<void>
  newConversation: () => Promise<void>
  stopTask: () => Promise<boolean>
  changeModel: (ref: SessionModelRef, info: ModelInfo | null) => Promise<boolean>
  getActiveId: () => string | null
  getSelectedWorktree: () => string | null
  setTheme: (theme: AppTheme) => void
  setLanguage: (language: Language) => void
  setSound: (enabled: boolean) => void
  openPanel: (panel: VoicePanelId) => void
  // يقفل أعلى لوحة مفتوحة بنفس ترتيب VOICE_PANEL_ORDER — يرجّع false لو مفيش
  closeTopPanel: () => boolean
  revealRequests: () => void
  gitActions: {
    revertAll: () => Promise<boolean>
    commitPush: () => Promise<boolean>
    pull: () => Promise<boolean>
  }
}

const OK: VoiceExecutorOutcome = { ok: true }

const EMPTY_VOICE_STATE: VoiceAppState = {
  authState: "loading",
  selectedProject: null,
  projects: [],
  recentProjects: [],
  sessions: [],
  activeId: null,
  isBusy: false,
  waitingOnUser: false,
  requestsCount: 0,
  requestsRunning: false,
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
  gitChanges: null,
  sending: false,
  theme: "dark",
  language: "ar",
  soundOn: true,
  switchingProject: false,
  panels: { sessions: false, settings: false, models: false, history: false, activity: false, attention: false, pinned: false, releases: false, git: false },
  rememberedSessionId: null,
}

// سياق احتياطي لما اللوحة مقفولة — الوكلاء ما بيشتغلوش أصلًا في الحالة دي،
// وده بس عشان قراءة السياق مترميش لو حصل نداء متأخر أثناء الإغلاق.
export function emptyVoiceContext(): VoiceAppContext {
  return buildVoiceContext(EMPTY_VOICE_STATE)
}

// الوكلاء بياخدوا المعالجات عبر دالة قراءة، مش كائن مغلق: كده التنفيذ
// المتعدد الخطوات (فيه فواصل بين الخطوات) بيشوف دايمًا أحدث نسخة من معالجات
// App وحالتها، لأن المراجع دي بتتحدّث مع كل رسم ولحد لحظة النداء الفعلية.
export function buildVoiceExecutors(getHandlers: () => VoiceAppHandlers): VoiceExecutors {
  return {
    openProject: async (project) => {
      const handlers = getHandlers()
      if (samePath(handlers.getSelectedWorktree(), project.worktree)) {
        return { ok: true, alreadyActive: true }
      }
      return { ok: await handlers.openProject(project) }
    },
    openConversation: async (session) => {
      const handlers = getHandlers()
      const activeId = handlers.getActiveId()
      if (activeId === session.id) {
        return { ok: true, alreadyActive: true }
      }
      await handlers.selectSession(session.id)
      return { ok: handlers.getActiveId() === session.id }
    },
    revealRequests: () => {
      getHandlers().revealRequests()
      return OK
    },
    openRunning: () => {
      getHandlers().openPanel("activity")
      return OK
    },
    openAttention: () => {
      getHandlers().openPanel("attention")
      return OK
    },
    openHistory: () => {
      getHandlers().openPanel("history")
      return OK
    },
    openPinned: () => {
      getHandlers().openPanel("pinned")
      return OK
    },
    openGit: () => {
      getHandlers().openPanel("git")
      return OK
    },
    openSettings: () => {
      getHandlers().openPanel("settings")
      return OK
    },
    openModels: () => {
      getHandlers().openPanel("models")
      return OK
    },
    openReleases: () => {
      getHandlers().openPanel("releases")
      return OK
    },
    createConversation: async () => {
      await getHandlers().newConversation()
      return OK
    },
    goBack: () => ({ ok: getHandlers().closeTopPanel() }),
    stopTask: async () => ({ ok: await getHandlers().stopTask() }),
    changeModel: async (ref, info) => ({ ok: await getHandlers().changeModel(ref, info) }),
    setTheme: (theme) => {
      getHandlers().setTheme(theme)
      return OK
    },
    setLanguage: (language) => {
      getHandlers().setLanguage(language)
      return OK
    },
    setSound: (enabled) => {
      getHandlers().setSound(enabled)
      return OK
    },
    gitRevertAll: async () => ({ ok: await getHandlers().gitActions.revertAll() }),
    gitCommitPush: async () => ({ ok: await getHandlers().gitActions.commitPush() }),
    gitPull: async () => ({ ok: await getHandlers().gitActions.pull() }),
  }
}
