import type { Event, FileDiff, Message, Part, Permission, Project, Session, SessionStatus, Todo } from "@opencode-ai/sdk"

export type { Event, FileDiff, Message, Part, Permission, Project, Session, SessionStatus, Todo }

export interface ProjectResponse {
  projects: Project[]
  selected: Project | null
}

export interface ConversationQuestionOption {
  label: string
  description: string
}

export interface ConversationQuestion {
  question: string
  header: string
  options: ConversationQuestionOption[]
  multiple: boolean
  custom: boolean
}

export interface ConversationQuestionRequest {
  id: string
  sessionID: string
  questions: ConversationQuestion[]
}

export type ConversationQuestionAnswers = string[][]

export type QuestionClientEventType =
  | "question.asked"
  | "question.replied"
  | "question.rejected"
  | "question.v2.asked"
  | "question.v2.replied"
  | "question.v2.rejected"

export interface QuestionClientEvent {
  type: QuestionClientEventType
  properties: {
    sessionID: string
    requestID?: string
  }
}

export type ClientEvent = Event | QuestionClientEvent

// حالة كل طلب داخل الجلسة: مستخبي في الطابور، شغّال دلوقتي، خلص، أو اتوقف.
export type RequestState = "queued" | "running" | "done" | "stopped"

// الطلبات بتتراص في كارت واحد على شكل قائمة — الأقدم فوق والأحدث تحت.
export interface SessionRequest {
  id: string
  index: number
  prompt: string
  state: RequestState
  activity: string
  finalResult: string
  // النص الحي للرد الجاري أثناء التنفيذ (فارغ بعد الاكتمال)
  liveText: string
  stepsCompleted: number
  activeTool: string | null
  todos: Todo[]
  completedTodos: number
  totalTodos: number
  resultFiles: ResultFile[]
  startedAt: number
  completedAt: number
  updatedAt: number
}

export interface SessionRequests {
  status: SessionStatus
  requests: SessionRequest[]
  questions: ConversationQuestionRequest[]
  queued: number
  // بصمة الحالة من السيرفر لدعم ETag/304 — غيابها (ردود قديمة) يعني "دايمًا جديد"
  version: string
}

export interface ResultFile {
  id: string
  name: string
  mime: string
  path: string
  url: string
  downloadUrl: string
  source: "attachment" | "output"
  size?: number
}

export interface AppConfig {
  openCode: {
    healthy: boolean
    version: string
  }
  push: {
    enabled: boolean
    publicKey: string | null
  }
  secureContext: boolean
}

export interface SessionMessage {
  info: Message
  parts: Part[]
}

export interface PushSubscriptionJson {
  endpoint: string
  expirationTime?: number | null
  keys: {
    auth: string
    p256dh: string
  }
}

export interface ModelInfo {
  id: string
  providerID: string
  name: string
  free: boolean
  enabled: boolean
  status?: string
  variants?: string[]
}

export interface SessionModelRef {
  providerID: string
  modelID: string
  variant?: string
}

export interface SessionModelState {
  model: SessionModelRef | null
  defaultModel: SessionModelRef | null
}

export interface ActiveSession {
  id: string
  title: string
  directory: string
  worktree: string
  projectName: string
  status: SessionStatus
  updatedAt: number
}

export interface HistoryTurn {
  id: string
  index: number
  prompt: string
  finalResult: string
  createdAt: number
  completedAt: number
  steps: number
  files: ResultFile[]
}

export type GitChangeStatus = "added" | "deleted" | "modified"

export interface GitChangeFile {
  path: string
  status: GitChangeStatus
  added: number
  removed: number
}

// حالة git للمشروع المختار — available = false لما المشروع مش مستودع git.
export interface GitChanges {
  branch: string
  available: boolean
  files: GitChangeFile[]
}
