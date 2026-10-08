// المخطّط: يحوّل القصد إلى خطوات تنفيذ بمعاملات مجسّدة من سياق التطبيق
// الحقيقي. كل تجسيد كيان (مشروع/محادثة/نموذج) بيحصل هنا بالبحث في نفس
// البيانات اللي الواجهة شايفاها — مفيش قاعدة بيانات تانية ولا تخمين:
// لو الاسم يطابق أكتر من عنصر نطلب توضيح، ولو مش موجود نقولها بصراحة.
import { displayTitle, getVarietyLevels, projectName, samePath, shortModelName } from "../display"
import type { Strings } from "../i18n"
import { themeLabel } from "../theme"
import type { ModelInfo, Project, Session, SessionModelRef } from "../types"
import type { VoiceAppContext } from "./context"
import type { AnyVoicePlanStep, ClarifyCandidate, EntityReference, ResolvedVoiceIntent, VoiceAmbiguity, VoiceIssue } from "./intents"
import { nameSimilarity } from "./normalize"
import type { VoiceModelQualifier } from "./lexicon"
import { fillTemplate as fill } from "./text"

// حد القبول لمطابقة الأسماء: أقل من كده يعتبر "مش موجود"، والفرق الصغير
// بين أفضل مرشحين يعني التباس حقيقي — نسأل ولا نخمّن.
export const VOICE_NAME_ACCEPT = 0.7
export const VOICE_NAME_MARGIN = 0.12
const MAX_CANDIDATES = 5

// كلمات وصفية للنماذج. ده ترتيب إرشادي شفّاف (اسم/معرّف النموذج)، مش
// قياس أداء — لو مفيش تطابق حاسم بنسأل المستخدم بدل ما نختار عشوائيًا.
const MODEL_QUALIFIER_KEYWORDS: Record<VoiceModelQualifier, readonly string[]> = {
  faster: ["flash", "mini", "nano", "haiku", "lite", "light", "fast", "turbo", "small", "instant", "quick"],
  smarter: ["opus", "pro", "ultra", "max", "sonnet", "reasoning", "large", "gpt-5"],
  free: ["free"],
  cheap: ["mini", "flash", "lite", "small", "nano", "haiku", "free"],
}

export interface VoiceEntityMemory {
  kind: "project" | "conversation" | "model"
  id: string
  label: string
}

export interface VoiceResolutionMemory {
  lastEntity: VoiceEntityMemory | null
  lastListKind: "projects" | "conversations" | "models" | null
}

export interface VoicePlanPreparation {
  steps: AnyVoicePlanStep[]
  ambiguity: VoiceAmbiguity | null
  issue: VoiceIssue | null
}

interface ResolvedOk<T> {
  kind: "ok"
  value: T
}

interface ResolvedIssue {
  kind: "issue"
  issue: VoiceIssue
}

interface ResolvedAmbiguous {
  kind: "ambiguous"
  ambiguity: Omit<VoiceAmbiguity, "stepIndex">
}

type EntityResolution<T> = ResolvedOk<T> | ResolvedIssue | ResolvedAmbiguous

function issueOf(message: string, severity: VoiceIssue["severity"] = "problem"): ResolvedIssue {
  return { kind: "issue", issue: { severity, message } }
}

// ── تجسيد المشاريع ──

function projectMatchScore(query: string, project: Project): number {
  return Math.max(
    nameSimilarity(query, projectName(project)),
    nameSimilarity(query, project.worktree),
    project.name ? nameSimilarity(query, project.name) : 0,
  )
}

function rankedProjects(query: string, context: VoiceAppContext): { project: Project; score: number }[] {
  return context.project.available
    .map((project) => ({ project, score: projectMatchScore(query, project) }))
    .filter((entry) => entry.score >= VOICE_NAME_ACCEPT)
    .sort((a, b) => b.score - a.score)
}

function resolveProjectByQuery(query: string, context: VoiceAppContext, t: Strings): EntityResolution<Project> {
  const ranked = rankedProjects(query, context)
  if (ranked.length === 0) {
    return issueOf(fill(t.voiceProjectNotFound, { name: query }))
  }
  const best = ranked[0]!
  const second = ranked[1]
  if (second && best.score - second.score <= VOICE_NAME_MARGIN) {
    return {
      kind: "ambiguous",
      ambiguity: {
        slot: "project",
        question: t.voiceWhichProject,
        candidates: ranked.slice(0, MAX_CANDIDATES).map((entry) => ({ kind: "project" as const, label: projectName(entry.project), project: entry.project })),
      },
    }
  }
  return { kind: "ok", value: best.project }
}

export function resolveProjectReference(ref: EntityReference | undefined, context: VoiceAppContext, memory: VoiceResolutionMemory, t: Strings): EntityResolution<Project> {
  const available = context.project.available
  if (available.length === 0) {
    return issueOf(t.voiceNoProjects, "info")
  }
  if (!ref) {
    // "افتح المشروع" بلا وصف: لو فيه واحد بس فهو المقصود، غير كده نسأل
    if (available.length === 1) {
      return { kind: "ok", value: available[0]! }
    }
    return {
      kind: "ambiguous",
      ambiguity: {
        slot: "project",
        question: t.voiceWhichProject,
        candidates: available.slice(0, MAX_CANDIDATES).map((project) => ({ kind: "project" as const, label: projectName(project), project })),
      },
    }
  }
  switch (ref.kind) {
    case "resolved": {
      const project = available.find((candidate) => candidate.worktree === ref.id || projectName(candidate) === ref.label)
      return project ? { kind: "ok", value: project } : issueOf(fill(t.voiceProjectNotFound, { name: ref.label }))
    }
    case "named":
      return resolveProjectByQuery(ref.text, context, t)
    case "current": {
      const selected = context.project.selected
      return selected ? { kind: "ok", value: selected } : issueOf(t.voiceNoProjects, "info")
    }
    case "latest":
    case "last-used": {
      // "آخر مشروع" = الأحدث استخدامًا فعلًا (سجل الاستخدام) وإلا المفتوح
      for (const path of context.project.recentPaths) {
        const project = available.find((candidate) => samePath(candidate.worktree, path))
        if (project) {
          return { kind: "ok", value: project }
        }
      }
      const selected = context.project.selected
      return selected ? { kind: "ok", value: selected } : { kind: "ok", value: available[0]! }
    }
    case "previous": {
      const selected = context.project.selected
      const index = selected ? available.findIndex((candidate) => samePath(candidate.worktree, selected.worktree)) : -1
      const next = index >= 0 ? available[index + 1] : available[1]
      return next ? { kind: "ok", value: next } : issueOf(t.voiceNoPreviousProject, "info")
    }
    case "first":
      return { kind: "ok", value: available[0]! }
    case "oldest":
      return { kind: "ok", value: available[available.length - 1]! }
    case "ordinal": {
      const project = available[ref.index - 1]
      return project ? { kind: "ok", value: project } : issueOf(t.voiceOrdinalOutOfRange, "info")
    }
    case "pronoun": {
      if (memory.lastEntity?.kind === "project") {
        const project = available.find((candidate) => candidate.worktree === memory.lastEntity?.id)
        if (project) {
          return { kind: "ok", value: project }
        }
      }
      return issueOf(t.voiceDidNotUnderstand)
    }
  }
}

// ── تجسيد المحادثات ──

function conversationMatchScore(query: string, session: Session): number {
  const directoryTail = session.directory.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? ""
  return Math.max(
    nameSimilarity(query, session.title || ""),
    directoryTail ? nameSimilarity(query, directoryTail) : 0,
  )
}

function rankedConversations(query: string, context: VoiceAppContext): { session: Session; score: number }[] {
  return context.conversations.available
    .map((session) => ({ session, score: conversationMatchScore(query, session) }))
    .filter((entry) => entry.score >= VOICE_NAME_ACCEPT)
    .sort((a, b) => b.score - a.score)
}

function resolveConversationByQuery(query: string, context: VoiceAppContext, t: Strings): EntityResolution<Session> {
  const ranked = rankedConversations(query, context)
  if (ranked.length === 0) {
    return issueOf(t.voiceConversationNotFound)
  }
  const best = ranked[0]!
  const second = ranked[1]
  if (second && best.score - second.score <= VOICE_NAME_MARGIN) {
    return {
      kind: "ambiguous",
      ambiguity: {
        slot: "conversation",
        question: t.voiceWhichConversation,
        candidates: ranked.slice(0, MAX_CANDIDATES).map((entry) => ({ kind: "conversation" as const, label: displayTitle(entry.session.title, t), session: entry.session })),
      },
    }
  }
  return { kind: "ok", value: best.session }
}

export function resolveConversationReference(ref: EntityReference | undefined, context: VoiceAppContext, memory: VoiceResolutionMemory, t: Strings): EntityResolution<Session> {
  const available = context.conversations.available
  if (available.length === 0) {
    return issueOf(t.voiceNoConversations, "info")
  }
  const current = context.conversations.current
  const defaultAmbiguity = (): EntityResolution<Session> => ({
    kind: "ambiguous",
    ambiguity: {
      slot: "conversation",
      question: t.voiceWhichConversation,
      candidates: available.slice(0, MAX_CANDIDATES).map((session) => ({ kind: "conversation" as const, label: displayTitle(session.title, t), session })),
    },
  })
  if (!ref) {
    // "المحادثة" بلا وصف: المفتوحة إن وُجدت، وإلا لو فيه واحدة فهي المقصودة
    if (current) {
      return { kind: "ok", value: current }
    }
    return available.length === 1 ? { kind: "ok", value: available[0]! } : defaultAmbiguity()
  }
  switch (ref.kind) {
    case "resolved": {
      const session = available.find((candidate) => candidate.id === ref.id)
      return session ? { kind: "ok", value: session } : issueOf(t.voiceConversationNotFound, "info")
    }
    case "named":
      return resolveConversationByQuery(ref.text, context, t)
    case "current":
      return current ? { kind: "ok", value: current } : issueOf(t.voiceNoCurrentConversation, "info")
    case "latest":
      return { kind: "ok", value: available[0]! }
    case "first":
      return { kind: "ok", value: available[0]! }
    case "oldest":
      return { kind: "ok", value: available[available.length - 1]! }
    case "last-used": {
      if (current) {
        return { kind: "ok", value: current }
      }
      const remembered = context.conversations.remembered
      const session = remembered ? available.find((candidate) => candidate.id === remembered) : undefined
      return session ? { kind: "ok", value: session } : issueOf(t.voiceNoCurrentConversation, "info")
    }
    case "previous": {
      if (!current) {
        return issueOf(t.voiceNoCurrentConversation, "info")
      }
      const index = available.findIndex((candidate) => candidate.id === current.id)
      const previous = index >= 0 ? available[index + 1] : undefined
      return previous ? { kind: "ok", value: previous } : issueOf(t.voiceNoPreviousConversation, "info")
    }
    case "ordinal": {
      const session = available[ref.index - 1]
      return session ? { kind: "ok", value: session } : issueOf(t.voiceOrdinalOutOfRange, "info")
    }
    case "pronoun": {
      if (memory.lastEntity?.kind === "conversation") {
        const session = available.find((candidate) => candidate.id === memory.lastEntity?.id)
        if (session) {
          return { kind: "ok", value: session }
        }
      }
      return defaultAmbiguity()
    }
  }
}

// ── تجسيد النماذج ──

function modelKey(ref: SessionModelRef): string {
  return `${ref.providerID}/${ref.modelID}`
}

function modelMatchScore(query: string, model: ModelInfo): number {
  return Math.max(
    nameSimilarity(query, model.name),
    nameSimilarity(query, model.id),
    nameSimilarity(query, `${model.providerID}/${model.id}`),
  )
}

function modelCandidate(model: ModelInfo): ClarifyCandidate {
  return { kind: "model", label: shortModelName(model), info: model }
}

function modelQualifierScore(qualifier: VoiceModelQualifier, model: ModelInfo, pinnedKeys: readonly string[]): number {
  const haystack = `${model.name} ${model.id}`.toLowerCase()
  let hits = 0
  for (const keyword of MODEL_QUALIFIER_KEYWORDS[qualifier]) {
    if (haystack.includes(keyword)) {
      hits += 1
    }
  }
  // المثبّتات كسر تعادل موجّه: المستخدم اختارها بنفسه فهي الأقرب لتفضيله
  return hits * 2 + (pinnedKeys.some((key) => key === modelKey({ providerID: model.providerID, modelID: model.id })) ? 1 : 0)
}

function resolveModelQualifier(qualifier: VoiceModelQualifier, context: VoiceAppContext, t: Strings): EntityResolution<ModelInfo> {
  const models = context.models.available
  if (models.length === 0) {
    return issueOf(t.voiceModelsLoading, "info")
  }
  const ranked = models
    .map((model) => ({ model, score: modelQualifierScore(qualifier, model, context.models.pinned) }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]!
  if (best.score === 0) {
    if (context.models.pinned.length === 1) {
      const pinnedModel = models.find((model) => modelKey({ providerID: model.providerID, modelID: model.id }) === context.models.pinned[0])
      return pinnedModel ? { kind: "ok", value: pinnedModel } : issueOf(t.voiceModelNotSure)
    }
    return issueOf(t.voiceModelNotSure)
  }
  const second = ranked[1]
  if (second && best.score === second.score) {
    return {
      kind: "ambiguous",
      ambiguity: {
        slot: "model",
        question: t.voiceWhichModel,
        candidates: ranked.slice(0, MAX_CANDIDATES).map((entry) => modelCandidate(entry.model)),
      },
    }
  }
  return { kind: "ok", value: best.model }
}

function resolveModelByQuery(query: string, context: VoiceAppContext, t: Strings): EntityResolution<ModelInfo> {
  const ranked = context.models.available
    .map((model) => ({ model, score: modelMatchScore(query, model) }))
    .filter((entry) => entry.score >= VOICE_NAME_ACCEPT)
    .sort((a, b) => b.score - a.score)
  if (ranked.length === 0) {
    return issueOf(t.voiceModelNotFound)
  }
  const best = ranked[0]!
  const second = ranked[1]
  if (second && best.score - second.score <= VOICE_NAME_MARGIN) {
    return {
      kind: "ambiguous",
      ambiguity: {
        slot: "model",
        question: t.voiceWhichModel,
        candidates: ranked.slice(0, MAX_CANDIDATES).map((entry) => modelCandidate(entry.model)),
      },
    }
  }
  return { kind: "ok", value: best.model }
}

export function resolveModelReference(ref: EntityReference | undefined, context: VoiceAppContext, t: Strings): EntityResolution<ModelInfo> {
  if (!ref || ref.kind === "current" || ref.kind === "latest" || ref.kind === "last-used") {
    const existing = context.models.current ?? context.models.pending ?? context.models.projectDefault ?? context.models.defaultRef
    if (existing) {
      const info = context.models.available.find((model) => modelKey({ providerID: model.providerID, modelID: model.id }) === modelKey(existing))
      if (info) {
        return { kind: "ok", value: info }
      }
    }
    return issueOf(t.voiceModelNotFound, "info")
  }
  switch (ref.kind) {
    case "resolved": {
      const info = context.models.available.find((model) => modelKey({ providerID: model.providerID, modelID: model.id }) === ref.id)
      return info ? { kind: "ok", value: info } : issueOf(t.voiceModelNotFound)
    }
    case "named":
      return resolveModelByQuery(ref.text, context, t)
    case "ordinal": {
      const info = context.models.available[ref.index - 1]
      return info ? { kind: "ok", value: info } : issueOf(t.voiceOrdinalOutOfRange, "info")
    }
    case "previous":
    case "first":
    case "oldest":
    case "pronoun":
      return issueOf(t.voiceModelNotFound)
  }
}

// ── تحويل القصد إلى خطوة ──

function openNamedStep(intent: ResolvedVoiceIntent, context: VoiceAppContext, t: Strings): EntityResolution<AnyVoicePlanStep> {
  const name = intent.name ?? ""
  // الاسم بلا نوع: نشوفه في المحادثات والمشاريع والنماذج، ولو لقيناه في أكتر
  // من نوع نسأل المستخدم يقصد إيه — مفيش تخمين.
  const conversations = context.conversations.available.filter((session) => conversationMatchScore(name, session) >= VOICE_NAME_ACCEPT)
  const projects = context.project.available.filter((project) => projectMatchScore(name, project) >= VOICE_NAME_ACCEPT)
  const models = context.models.available.filter((model) => modelMatchScore(name, model) >= VOICE_NAME_ACCEPT)
  const kindsFound = Number(conversations.length > 0) + Number(projects.length > 0) + Number(models.length > 0)
  if (kindsFound === 0) {
    return issueOf(fill(t.voiceEntityNotFound, { name }))
  }
  if (kindsFound > 1) {
    const candidates: ClarifyCandidate[] = [
      ...projects.slice(0, MAX_CANDIDATES).map((project) => ({ kind: "project" as const, label: projectName(project), project })),
      ...conversations.slice(0, MAX_CANDIDATES).map((session) => ({ kind: "conversation" as const, label: displayTitle(session.title, t), session })),
      ...models.slice(0, MAX_CANDIDATES).map(modelCandidate),
    ]
    return {
      kind: "ambiguous",
      ambiguity: { slot: "entity", question: fill(t.voiceWhichEntity, { name }), candidates },
    }
  }
  if (projects.length === 1) {
    return stepOpenProject(projects[0]!, t)
  }
  if (conversations.length === 1) {
    return stepOpenConversation(conversations[0]!, null, t)
  }
  // نموذج بالاسم: "افتح Sonnet" معناها العملي التبديل له
  return stepChangeModel(models[0]!, undefined, t)
}

function stepOpenProject(project: Project, t: Strings): ResolvedOk<AnyVoicePlanStep> {
  return {
    kind: "ok",
    value: {
      action: "OPEN_PROJECT",
      params: { project },
      label: fill(t.voiceStepOpenProject, { name: projectName(project) }),
    },
  }
}

function stepOpenConversation(session: Session | null, reference: EntityReference | null, t: Strings, deferredProject: Project | null = null): ResolvedOk<AnyVoicePlanStep> {
  const label = session
    ? fill(t.voiceStepOpenConversation, { title: displayTitle(session.title, t) })
    : referenceLabel(reference, t)
  return {
    kind: "ok",
    value: {
      action: "OPEN_CONVERSATION",
      params: { conversation: session, reference: reference ?? { kind: "current" }, deferredProject },
      label,
    },
  }
}

function referenceLabel(reference: EntityReference | null, t: Strings): string {
  switch (reference?.kind) {
    case "latest":
      return t.voiceStepOpenLatestConversation
    case "previous":
      return t.voiceStepOpenPreviousConversation
    case "current":
      return t.voiceStepOpenCurrentConversation
    case "last-used":
      return t.voiceStepOpenWorkedConversation
    default:
      return t.voiceStepOpenConversationGeneric
  }
}

function stepChangeModel(model: ModelInfo, variant: string | undefined, t: Strings): ResolvedOk<AnyVoicePlanStep> {
  const ref: SessionModelRef = { providerID: model.providerID, modelID: model.id, ...(variant ? { variant } : {}) }
  const name = variant ? `${shortModelName(model)} · ${variant}` : shortModelName(model)
  return {
    kind: "ok",
    value: { action: "CHANGE_MODEL", params: { ref, info: model }, label: fill(t.voiceStepChangeModel, { name }) },
  }
}

// نوع العنصر من ذاكرة آخر كيان اتعامل معاه الوكيل — بيحدد "افتحه" وأمثاله
// (مش مشروع/محادثة حرفيًا في الكلام، لكن من السياق الحقيقي).
function kindFromEntity(memory: VoiceResolutionMemory): "projects" | "conversations" | "models" | null {
  if (memory.lastEntity?.kind === "project") {
    return "projects"
  }
  if (memory.lastEntity?.kind === "conversation") {
    return "conversations"
  }
  if (memory.lastEntity?.kind === "model") {
    return "models"
  }
  return null
}

function referenceForEntity(entity: VoiceEntityMemory, context: VoiceAppContext, memory: VoiceResolutionMemory, t: Strings, earlierSteps: readonly AnyVoicePlanStep[]): EntityResolution<AnyVoicePlanStep> {
  const resolved: EntityReference = { kind: "resolved", id: entity.id, label: entity.label }
  if (entity.kind === "project") {
    return stepForIntent({ kind: "open-project", spoken: entity.label, project: resolved }, context, memory, t, earlierSteps)
  }
  if (entity.kind === "conversation") {
    return stepForIntent({ kind: "open-conversation", spoken: entity.label, conversation: resolved }, context, memory, t, earlierSteps)
  }
  return stepForIntent({ kind: "change-model", spoken: entity.label, model: resolved }, context, memory, t, earlierSteps)
}

function stepForIntent(intent: ResolvedVoiceIntent, context: VoiceAppContext, memory: VoiceResolutionMemory, t: Strings, earlierSteps: readonly AnyVoicePlanStep[]): EntityResolution<AnyVoicePlanStep> {
  switch (intent.kind) {
    case "open-project": {
      const resolution = resolveProjectReference(intent.project, context, memory, t)
      return resolution.kind === "ok" ? stepOpenProject(resolution.value, t) : resolution
    }
    case "open-conversation": {
      // خطوة مشروع سابقة بتغيّر المشروع الحالي — جلسات المشروع المستهدف مش
      // معروفة قبل فتحه، فالتجسيد بيتأجل لوقت التنفيذ (بعد ما السياق يتحدّث).
      const projectStep = [...earlierSteps].reverse().find((step) => step.action === "OPEN_PROJECT")
      const targetProject = projectStep?.action === "OPEN_PROJECT" ? projectStep.params.project : null
      if (targetProject && !samePath(targetProject.worktree, context.project.selected?.worktree)) {
        const reference = intent.conversation ?? { kind: "latest" as const }
        return stepOpenConversation(null, reference, t, targetProject)
      }
      const resolution = resolveConversationReference(intent.conversation, context, memory, t)
      return resolution.kind === "ok" ? stepOpenConversation(resolution.value, null, t) : resolution
    }
    case "open-named":
      return openNamedStep(intent, context, t)
    case "open-reference": {
      const reference = intent.reference
      // ترتيب بلا نوع ("افتح التاني"): النوع من آخر قائمة عرضها الوكيل
      if (reference?.kind === "ordinal") {
        const target = memory.lastListKind ?? kindFromEntity(memory)
        if (!target) {
          return issueOf(t.voiceOrdinalNoTarget, "info")
        }
        const ref: EntityReference = { kind: "ordinal", index: reference.index }
        return stepForIntent(
          { ...intent, kind: target === "projects" ? "open-project" : target === "models" ? "change-model" : "open-conversation", project: target === "projects" ? ref : undefined, conversation: target === "conversations" ? ref : undefined, model: target === "models" ? ref : undefined, ordinal: undefined, reference: undefined },
          context,
          memory,
          t,
          earlierSteps,
        )
      }
      // ضمير ("افتحه" / "open it"): آخر كيان اتعامل معاه الوكيل
      if (!reference || reference.kind === "pronoun") {
        const entity = memory.lastEntity
        if (entity) {
          return referenceForEntity(entity, context, memory, t, earlierSteps)
        }
        return issueOf(t.voiceDidNotUnderstand)
      }
      // مرجع زمني عام ("Open the latest one"): النوع من ذاكرة الجلسة
      const target = kindFromEntity(memory) ?? memory.lastListKind
      if (!target) {
        return issueOf(t.voiceDidNotUnderstand)
      }
      return stepForIntent(
        { ...intent, kind: target === "projects" ? "open-project" : target === "models" ? "change-model" : "open-conversation", project: target === "projects" ? reference : undefined, conversation: target === "conversations" ? reference : undefined, model: target === "models" ? reference : undefined, ordinal: undefined, reference: undefined },
        context,
        memory,
        t,
        earlierSteps,
      )
    }
    case "show-requests":
      return { kind: "ok", value: { action: "SHOW_REQUESTS", params: {}, label: t.voiceStepShowRequests } }
    case "show-running":
      return { kind: "ok", value: { action: "SHOW_RUNNING", params: {}, label: t.voiceStepShowRunning } }
    case "open-attention":
      return { kind: "ok", value: { action: "OPEN_ATTENTION", params: {}, label: t.voiceStepOpenAttention } }
    case "open-history":
      return { kind: "ok", value: { action: "OPEN_HISTORY", params: {}, label: t.voiceStepOpenHistory } }
    case "open-pinned":
      return { kind: "ok", value: { action: "OPEN_PINNED", params: {}, label: t.voiceStepOpenPinned } }
    case "open-git":
      return { kind: "ok", value: { action: "OPEN_GIT", params: {}, label: t.voiceStepOpenGit } }
    case "open-settings":
      return { kind: "ok", value: { action: "OPEN_SETTINGS", params: {}, label: t.voiceStepOpenSettings } }
    case "open-models":
      return { kind: "ok", value: { action: "OPEN_MODELS", params: {}, label: t.voiceStepOpenModels } }
    case "open-releases":
      return { kind: "ok", value: { action: "OPEN_RELEASES", params: {}, label: t.voiceStepOpenReleases } }
    case "new-conversation":
      return { kind: "ok", value: { action: "NEW_CONVERSATION", params: {}, label: t.voiceStepNewConversation } }
    case "go-back":
      return { kind: "ok", value: { action: "GO_BACK", params: {}, label: t.voiceStepGoBack } }
    case "stop-task":
      return { kind: "ok", value: { action: "STOP_TASK", params: {}, label: t.voiceStepStopTask } }
    case "set-theme":
      return intent.theme ? { kind: "ok", value: { action: "SET_THEME", params: { theme: intent.theme }, label: fill(t.voiceStepSetTheme, { name: themeLabel(intent.theme, t) }) } } : issueOf(t.voiceDidNotUnderstand)
    case "set-language":
      return intent.language
        ? { kind: "ok", value: { action: "SET_LANGUAGE", params: { language: intent.language }, label: fill(t.voiceStepSetLanguage, { name: intent.language === "ar" ? t.voiceLanguageArabic : t.voiceLanguageEnglish }) } }
        : issueOf(t.voiceDidNotUnderstand)
    case "set-sound":
      return intent.sound === undefined
        ? issueOf(t.voiceDidNotUnderstand)
        : { kind: "ok", value: { action: "SET_SOUND", params: { enabled: intent.sound }, label: intent.sound ? t.voiceStepSoundOn : t.voiceStepSoundOff } }
    case "revert-changes":
      return { kind: "ok", value: { action: "REVERT_ALL_CHANGES", params: {}, label: t.voiceStepRevertAll } }
    case "commit-push":
      return { kind: "ok", value: { action: "COMMIT_PUSH", params: {}, label: t.voiceStepCommitPush } }
    case "pull-changes":
      return { kind: "ok", value: { action: "PULL_CHANGES", params: {}, label: t.voiceStepPull } }
    case "change-model": {
      // اسم صريح أولى من الوصف؛ والوصف ("الأسرع") بيتحل من أسماء النماذج
      // بترتيب إرشادي شفاف، ولو التعادل قائم نسأل بدل ما نخمّن.
      const resolution = intent.model
        ? resolveModelReference(intent.model, context, t)
        : intent.modelQualifier
          ? resolveModelQualifier(intent.modelQualifier, context, t)
          : resolveModelReference(undefined, context, t)
      if (resolution.kind !== "ok") {
        return resolution
      }
      const model = resolution.value
      const variant = intent.variant
      if (variant && model.variants && model.variants.length > 0 && !getVarietyLevels(model).includes(variant)) {
        return issueOf(fill(t.voiceVariantUnsupported, { name: shortModelName(model), level: variant }))
      }
      return stepChangeModel(model, variant, t)
    }
    case "list-projects":
    case "list-conversations":
    case "list-models":
    case "help":
    case "affirm":
    case "deny":
    case "stop-listening":
    case "unsupported":
      return issueOf(t.voiceUnsupportedAction, "info")
  }
}

// بناء الخطة كاملة: يتوقف عند أول مشكلة/التباس (مفيش تنفيذ جزئي لأمر ملخبط).
export function prepareVoicePlan(intents: readonly ResolvedVoiceIntent[], context: VoiceAppContext, memory: VoiceResolutionMemory, t: Strings): VoicePlanPreparation {
  const steps: AnyVoicePlanStep[] = []
  for (let index = 0; index < intents.length; index += 1) {
    const intent = intents[index]!
    const resolution = stepForIntent(intent, context, memory, t, steps)
    if (resolution.kind === "issue") {
      return { steps, ambiguity: null, issue: resolution.issue }
    }
    if (resolution.kind === "ambiguous") {
      return { steps, ambiguity: { ...resolution.ambiguity, stepIndex: index }, issue: null }
    }
    steps.push(resolution.value)
  }
  return { steps, ambiguity: null, issue: null }
}

export { modelKey }
