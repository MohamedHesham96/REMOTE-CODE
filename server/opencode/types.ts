import type { Project, Session, SessionStatus, Todo } from "@opencode-ai/sdk"

export type { Project, Session, SessionStatus, Todo }

export interface ServiceOptions {
  projectDirectory: string
  serverUrl?: string
  username: string
  password?: string
  port: number
}

export interface GitChangeFile {
  path: string
  status: "added" | "deleted" | "modified"
  added: number
  removed: number
}

export interface GitChanges {
  branch: string
  available: boolean
  files: GitChangeFile[]
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

export type RequestState = "queued" | "running" | "done" | "stopped"

export interface SessionRequest {
  id: string
  index: number
  prompt: string
  state: RequestState
  activity: string
  finalResult: string
  // النص الحي للرد الجاري (يُملأ أثناء state=running فقط) — نفس رسائل
  // opencode وهي بتتكتب، قبل ما تكتمل وتبقى finalResult.
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
  // بصمة خفيفة للحالة الكاملة: السيرفر بيحسب ETag منها، والعميل يوفّر
  // إعادة التحميل لما مفيش تغيير (304). أي تغيير في النص الحي، الحالة،
  // الطابور، الأسئلة أو الـ todos لازم يغيّرها — وإلا يحصل stale.
  version: string
}

export interface ModelInfo {
  id: string
  providerID: string
  name: string
  free: boolean
  enabled: boolean
  status?: string
  // الـ variants اللي OpenCode بيسمح بيها للموديل ده (مثل high / max / low)
  variants?: string[]
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

export interface SessionModelRef {
  providerID: string
  modelID: string
  variant?: string
}
