// عناصر سياق جاهزة لاختبارات وكيل الصوت — ملف اختبارات فقط (مفيش كود إنتاج
// بيستورده). بتبني سياق تطبيق واقعي بأقل قدر مطلوب من الحقول.
import { getStrings, type Language, type Strings } from "../i18n"
import type { ActiveSession, AttentionItem, ModelInfo, Project, Session, SessionModelRef } from "../types"
import type { VoiceAppContext, VoicePanelsState } from "./context"

export function makeProject(name: string, worktree?: string, id?: string): Project {
  const path = worktree ?? `C:/work/${name}`
  return {
    id: id ?? path,
    worktree: path,
    name,
    time: { created: 1, updated: 2 },
    sessionCount: 0,
  }
}

export function makeSession(id: string, title: string, created: number, directory = "C:/work/RemoteCode"): Session {
  return { id, title, directory, time: { created, updated: created } }
}

export function makeModel(id: string, name: string, providerID = "test", free = false, variants?: string[]): ModelInfo {
  return { id, providerID, name: free ? `${name} (free)` : name, free, enabled: true, ...(variants ? { variants } : {}) }
}

export function makeRunningSession(id: string, title: string): ActiveSession {
  return { id, title, directory: "C:/work/RemoteCode", worktree: "C:/work/RemoteCode", projectName: "RemoteCode", status: { type: "busy" }, updatedAt: 5 }
}

export const EMPTY_PANELS: VoicePanelsState = {
  sessions: false,
  settings: false,
  models: false,
  history: false,
  activity: false,
  attention: false,
  pinned: false,
  releases: false,
  git: false,
}

export interface ContextOptions {
  projects?: Project[]
  selected?: Project | null
  sessions?: Session[]
  currentSessionId?: string | null
  remembered?: string | null
  running?: ActiveSession[]
  attentionItems?: AttentionItem[]
  models?: ModelInfo[]
  currentModel?: SessionModelRef | null
  pinned?: string[]
  panels?: Partial<VoicePanelsState>
  git?: Partial<VoiceAppContext["git"]>
  requests?: Partial<VoiceAppContext["requests"]>
  theme?: VoiceAppContext["theme"]
  language?: Language
  soundOn?: boolean
}

export function makeContext(options: ContextOptions = {}): VoiceAppContext {
  const projects = options.projects ?? [makeProject("RemoteCode")]
  const selected = options.selected === undefined ? projects[0] ?? null : options.selected
  const sessions = options.sessions ?? []
  const currentSessionId = options.currentSessionId === undefined ? sessions[0]?.id ?? null : options.currentSessionId
  const current = currentSessionId ? sessions.find((session) => session.id === currentSessionId) ?? null : null
  return {
    signedIn: true,
    screen: "main",
    panels: { ...EMPTY_PANELS, ...options.panels },
    project: { selected, available: projects, recentPaths: projects.map((project) => project.worktree) },
    conversations: {
      current,
      available: sessions,
      pinned: [],
      remembered: options.remembered ?? null,
    },
    running: options.running ?? [],
    attention: { items: options.attentionItems ?? [], permissions: [], questions: [] },
    models: {
      available: options.models ?? [],
      current: options.currentModel ?? null,
      defaultRef: null,
      projectDefault: null,
      pending: null,
      pinned: options.pinned ?? [],
      loading: false,
      busy: false,
    },
    requests: {
      count: 0,
      running: false,
      queued: false,
      stalled: false,
      waitingOnUser: false,
      ...options.requests,
    },
    git: {
      available: false,
      changedCount: 0,
      unpushed: 0,
      busy: false,
      ...options.git,
    },
    theme: options.theme ?? "dark",
    language: options.language ?? "ar",
    soundOn: options.soundOn ?? true,
    projectSwitching: false,
  }
}

export function arStrings(): Strings {
  return getStrings("ar")
}

export function enStrings(): Strings {
  return getStrings("en")
}
