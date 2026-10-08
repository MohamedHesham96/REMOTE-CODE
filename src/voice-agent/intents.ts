// نموذج القصد المكتوب: مخرجات مرحلة الفهم قبل أي تنفيذ. الخطة هنا لا تعرف
// شيئًا عن React ولا عن السيرفر — مجرد بيانات. طبقة registry.ts هي اللي
// تربط كل إجراء بمُنفّذه الحقيقي في التطبيق.
import type { Language } from "../i18n"
import type { AppTheme } from "../theme"
import type { ModelInfo, Project, Session, SessionModelRef } from "../types"
import type { VoiceModelQualifier } from "./lexicon"

export type VoiceIntentKind =
  | "open-project"
  | "open-conversation"
  | "open-named"
  | "open-reference"
  | "show-requests"
  | "show-running"
  | "open-attention"
  | "open-history"
  | "open-pinned"
  | "open-git"
  | "open-settings"
  | "open-models"
  | "open-releases"
  | "change-model"
  | "new-conversation"
  | "go-back"
  | "stop-task"
  | "set-theme"
  | "set-language"
  | "set-sound"
  | "revert-changes"
  | "commit-push"
  | "pull-changes"
  | "list-projects"
  | "list-conversations"
  | "list-models"
  | "help"
  | "affirm"
  | "deny"
  | "stop-listening"
  | "unsupported"

// مرجع كيان كما نُطق — الحلّ الفعلي لتجسيده (معرّف/عنصر) يحصل في planner.ts
// ضد سياق التطبيق الحي. "resolved" تُستخدم لما يجيب المستخدم توضيحه فييجي
// الاختيار جاهزًا من بين المرشحين، فما نعيدش تخمين الاسم.
export type EntityReference =
  | { kind: "current" }
  | { kind: "latest" }
  | { kind: "previous" }
  | { kind: "first" }
  | { kind: "oldest" }
  | { kind: "last-used" }
  | { kind: "pronoun" }
  | { kind: "ordinal"; index: number }
  | { kind: "named"; text: string }
  | { kind: "resolved"; id: string; label: string }

export interface ResolvedVoiceIntent {
  kind: VoiceIntentKind
  project?: EntityReference
  conversation?: EntityReference
  model?: EntityReference
  modelQualifier?: VoiceModelQualifier
  variant?: string
  ordinal?: number
  ordinalTarget?: "project" | "conversation" | "model"
  theme?: AppTheme
  language?: Language
  sound?: boolean
  // اسم بلا نوع مذكور ("افتح RemoteCode") — planner يحلّ نوعه من السياق
  name?: string
  // مرجع عام للضمائر والترتيب ("افتحه" / "Open the latest one") — النوع من
  // ذاكرة الجلسة في planner، والقيمة دي هي اللي بتحدد أي عنصر بالظبط
  reference?: EntityReference
  // النص المطبّع للجملة اللي أنتجت القصد — رسائل الفشل بتعرضه للمستخدم
  spoken: string
}

// ── خطة العمل: خطوات جاهزة التنفيذ بمعاملاتها النهائية ──
export interface VoiceActionParamsMap {
  OPEN_PROJECT: { project: Project }
  OPEN_CONVERSATION: { conversation: Session | null; reference: EntityReference; deferredProject: Project | null }
  SHOW_REQUESTS: Record<string, never>
  SHOW_RUNNING: Record<string, never>
  OPEN_ATTENTION: Record<string, never>
  OPEN_HISTORY: Record<string, never>
  OPEN_PINNED: Record<string, never>
  OPEN_GIT: Record<string, never>
  OPEN_SETTINGS: Record<string, never>
  OPEN_MODELS: Record<string, never>
  OPEN_RELEASES: Record<string, never>
  CHANGE_MODEL: { ref: SessionModelRef; info: ModelInfo | null }
  NEW_CONVERSATION: Record<string, never>
  GO_BACK: Record<string, never>
  STOP_TASK: Record<string, never>
  SET_THEME: { theme: AppTheme }
  SET_LANGUAGE: { language: Language }
  SET_SOUND: { enabled: boolean }
  REVERT_ALL_CHANGES: Record<string, never>
  COMMIT_PUSH: Record<string, never>
  PULL_CHANGES: Record<string, never>
}

export type VoiceActionId = keyof VoiceActionParamsMap

export interface VoicePlanStep<K extends VoiceActionId = VoiceActionId> {
  action: K
  params: VoiceActionParamsMap[K]
  // سطر العرض في معاينة الخطة ("فهمت الطلب")
  label: string
}

export type AnyVoicePlanStep = { [K in VoiceActionId]: VoicePlanStep<K> }[VoiceActionId]

export interface VoicePlan {
  steps: AnyVoicePlanStep[]
}

// مرشح للتوضيح — الواجهة تعرض التسميات، والاختيار (صوتًا أو لمسًا) يحوّله
// لمرجع "resolved" في نفس الخطوة.
export type ClarifyCandidate =
  | { kind: "project"; label: string; project: Project }
  | { kind: "conversation"; label: string; session: Session }
  | { kind: "model"; label: string; info: ModelInfo }

export interface VoiceAmbiguity {
  slot: "project" | "conversation" | "model" | "entity"
  question: string
  candidates: ClarifyCandidate[]
  stepIndex: number
}

export type VoiceIssueSeverity = "info" | "problem"

// مشكلة توقف الخطة قبل التنفيذ (نقص عنصر، إجراء غير متاح، إلخ). "info" حالة
// طبيعية (مفيش حاجة شغالة، مفيش محادثات) و"problem" فشل حقيقي.
export interface VoiceIssue {
  severity: VoiceIssueSeverity
  message: string
}
