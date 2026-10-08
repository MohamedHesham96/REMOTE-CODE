// سياق التطبيق كما يراه وكيل الصوت: مرآة لحالة RemoteCode الحية لحظة
// معالجة الأمر. مفيش أي نسخة موازية من الحالة ومفيش تخزين — الكائن ده
// يتقرأ من الحالة الفعلية في App وقت الحاجة فقط، وعليه يعتمد الحلّ
// السياقي (currentProject، latestConversation، المشروع النشط...).
import type { Language } from "../i18n"
import type { AppTheme } from "../theme"
import type { ActiveSession, AttentionItem, ConversationQuestionRequest, ModelInfo, Permission, PinnedConversation, Project, Session, SessionModelRef } from "../types"

export type VoicePanelId = "sessions" | "settings" | "models" | "history" | "activity" | "attention" | "pinned" | "releases" | "git"

export type VoiceScreen = "main" | VoicePanelId

export type VoicePanelsState = Record<VoicePanelId, boolean>

// ترتيب أولوية الإغلاق عند "ارجع": الألواح اللي بتفتح فوق في التجربة اليومية
// أولًا. قائمة واحدة يعتمد عليها سياق الواجهة وApp معًا فلا يحصل انحراف.
export const VOICE_PANEL_ORDER: readonly VoicePanelId[] = ["git", "models", "settings", "releases", "pinned", "history", "attention", "activity", "sessions"]

export function openedVoicePanels(panels: VoicePanelsState): VoicePanelId[] {
  return VOICE_PANEL_ORDER.filter((panel) => panels[panel])
}

export function topOpenVoicePanel(panels: VoicePanelsState): VoicePanelId | null {
  return openedVoicePanels(panels)[0] ?? null
}

export function voiceScreenOf(panels: VoicePanelsState): VoiceScreen {
  return topOpenVoicePanel(panels) ?? "main"
}

export interface VoiceAppContext {
  // التحكم الصوتي بيشتغل بعد الدخول ببساطة؛ الحقل موجود للتحقق الوقائي
  signedIn: boolean
  screen: VoiceScreen
  panels: VoicePanelsState
  project: {
    selected: Project | null
    // بترتيب العرض نفسه اللي المستخدم شايفه في القائمة (الحالي/الأحدث/أبجدي)
    available: Project[]
    recentPaths: readonly string[]
  }
  conversations: {
    current: Session | null
    // بترتيب العرض (الأحدث إنشاءً أولًا) — هو اللي بيحكم "الأول/التاني"
    available: Session[]
    pinned: PinnedConversation[]
    // آخر محادثة محفوظة للمشروع (loadLastSessions) — لدعم "اللي كنت شغال عليها"
    remembered: string | null
  }
  running: ActiveSession[]
  attention: {
    items: AttentionItem[]
    permissions: Permission[]
    questions: ConversationQuestionRequest[]
  }
  models: {
    available: ModelInfo[]
    current: SessionModelRef | null
    defaultRef: SessionModelRef | null
    projectDefault: SessionModelRef | null
    pending: SessionModelRef | null
    // مفاتيح المثبّتة "providerID/modelID" — كسر تعادل موجّه عند الوصف
    pinned: readonly string[]
    loading: boolean
    busy: boolean
  }
  requests: {
    count: number
    running: boolean
    queued: boolean
    stalled: boolean
    waitingOnUser: boolean
  }
  git: {
    available: boolean
    changedCount: number
    unpushed: number
    busy: boolean
  }
  theme: AppTheme
  language: Language
  soundOn: boolean
  projectSwitching: boolean
}
