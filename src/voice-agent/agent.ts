// العقل المنسّق للتحكم الصوتي: من نص → أقصد → خطة → قرار (توضيح/تأكيد/
// معاينة/تنفيذ/رد). الملف ده كله دوال بحتة بتستقبل السياق كمعامل — مفيش
// React ولا شبكة ولا تنفيذ مباشر؛ التنفيذ بيتم في registry.ts بعد ما يقرر
// الوكيل، والهوك (useVoiceControl) هو اللي بيوصل الاتنين بالواجهة.
import { displayTitle, projectName, shortModelName } from "../display"
import type { Strings } from "../i18n"
import type { VoiceAppContext } from "./context"
import type { AnyVoicePlanStep, ClarifyCandidate, ResolvedVoiceIntent } from "./intents"
import { nameSimilarity, tokenizeVoiceText } from "./normalize"
import { modelKey, prepareVoicePlan, VOICE_NAME_ACCEPT, type VoiceResolutionMemory } from "./planner"
import { isConfirmAction, validateVoiceStep, VOICE_ACTIONS, type VoicePlanRunResult } from "./registry"
import { clarificationOrdinal, resolveVoiceIntents, voiceAffirmation, voiceNegation } from "./resolver"
import { withEntity, withList, withPending, createVoiceAgentSession, type VoiceAgentSession } from "./session"
import { fillTemplate } from "./text"

export type VoiceAgentTurn =
  | { kind: "reply"; session: VoiceAgentSession; message: string; tone: "info" | "success" | "error"; openHelp?: boolean }
  | { kind: "clarify"; session: VoiceAgentSession; question: string; candidates: ClarifyCandidate[] }
  | { kind: "confirm"; session: VoiceAgentSession; question: string; steps: AnyVoicePlanStep[] }
  | { kind: "preview"; session: VoiceAgentSession; steps: AnyVoicePlanStep[]; notes: string[] }
  | { kind: "execute"; session: VoiceAgentSession; steps: AnyVoicePlanStep[]; notes: string[] }
  | { kind: "stop-listening"; session: VoiceAgentSession }

const LIST_KINDS = new Set(["list-projects", "list-conversations", "list-models"])
const ACTION_KINDS = new Set<string>([
  "open-project",
  "open-conversation",
  "open-named",
  "open-reference",
  "show-requests",
  "show-running",
  "open-attention",
  "open-history",
  "open-pinned",
  "open-git",
  "open-settings",
  "open-models",
  "open-releases",
  "change-model",
  "new-conversation",
  "go-back",
  "stop-task",
  "set-theme",
  "set-language",
  "set-sound",
  "revert-changes",
  "commit-push",
  "pull-changes",
])

function reply(session: VoiceAgentSession, message: string, tone: "info" | "success" | "error", openHelp = false): VoiceAgentTurn {
  return { kind: "reply", session, message, tone, ...(openHelp ? { openHelp: true } : {}) }
}

function memoryOf(session: VoiceAgentSession): VoiceResolutionMemory {
  return { lastEntity: session.lastEntity, lastListKind: session.lastList?.kind ?? null }
}

// ردود القوائم: بتتحدث الذاكرة القصيرة عشان "التاني" في الجملة اللي بعدها
// يعرف نوع العنصر المقصود (req 15).
function listReplies(intents: readonly ResolvedVoiceIntent[], context: VoiceAppContext, t: Strings): { notes: string[]; session: VoiceAgentSession } {
  const notes: string[] = []
  let session = createVoiceAgentSession()
  for (const intent of intents) {
    if (intent.kind === "list-projects") {
      if (context.project.available.length === 0) {
        notes.push(t.voiceNoProjects)
        continue
      }
      const labels = context.project.available.map((project) => projectName(project))
      notes.push(fillTemplate(t.voiceProjectsList, { list: labels.join("، ") }))
      session = withList(session, { kind: "projects", labels })
    } else if (intent.kind === "list-conversations") {
      if (context.conversations.available.length === 0) {
        notes.push(t.voiceNoConversations)
        continue
      }
      const labels = context.conversations.available.map((sessionItem) => displayTitle(sessionItem.title, t))
      notes.push(fillTemplate(t.voiceConversationsList, { project: context.project.selected ? projectName(context.project.selected) : "", list: labels.join("، ") }))
      session = withList(session, { kind: "conversations", labels })
    } else if (intent.kind === "list-models") {
      if (context.models.available.length === 0) {
        notes.push(t.noModels)
        continue
      }
      const labels = context.models.available.slice(0, 12).map((model) => shortModelName(model))
      notes.push(fillTemplate(t.voiceModelsList, { list: labels.join("، ") }))
      session = withList(session, { kind: "models", labels })
    }
  }
  return { notes, session }
}

// مسار مشترك: من أقصد إجرائية إلى قرار الخطة (تنفيذ/تأكيد/معاينة/توضيح).
function planActionIntents(intents: readonly ResolvedVoiceIntent[], notes: string[], context: VoiceAppContext, session: VoiceAgentSession, t: Strings): VoiceAgentTurn {
  if (intents.length === 0) {
    if (notes.length > 0) {
      return reply(withPending(session, null), notes.join("\n"), "info")
    }
    return reply(withPending(session, null), t.voiceDidNotUnderstand, "error")
  }
  const preparation = prepareVoicePlan(intents, context, memoryOf(session), t)
  const cleanSession = withPending(session, null)
  if (preparation.issue) {
    return reply(cleanSession, preparation.issue.message, preparation.issue.severity === "problem" ? "error" : "info")
  }
  if (preparation.ambiguity) {
    const pending = {
      kind: "clarify" as const,
      slot: preparation.ambiguity.slot,
      question: preparation.ambiguity.question,
      candidates: preparation.ambiguity.candidates,
      intents: [...intents],
      stepIndex: preparation.ambiguity.stepIndex,
    }
    return {
      kind: "clarify",
      session: withPending(session, pending),
      question: preparation.ambiguity.question,
      candidates: preparation.ambiguity.candidates,
    }
  }
  const steps = preparation.steps
  // التحقق السياقي قبل عرض أي معاينة أو سؤال تأكيد: ما نسألش "متأكد؟" عن
// إجراء مش قابل للتنفيذ أصلًا (مفيش تغييرات، مفيش مهمة جارية...).
  for (const step of steps) {
    const issue = validateVoiceStep(step, context, t)
    if (issue) {
      return reply(cleanSession, issue.message, issue.severity === "problem" ? "error" : "info")
    }
  }
  const confirmSteps = steps.filter((step) => isConfirmAction(step.action))
  if (confirmSteps.length > 0) {
    // سؤال التأكيد بيتجمع من الإجراءات غير الآمنة نفسها بس ("هتعمل إيه")
    const questions: string[] = []
    for (const step of confirmSteps) {
      const question = VOICE_ACTIONS[step.action].confirmQuestion
      if (question) {
        const text = question(t)
        if (!questions.includes(text)) {
          questions.push(text)
        }
      }
    }
    const question = [...notes, ...questions].join(" ")
    return { kind: "confirm", session: withPending(session, { kind: "confirm", steps, question }), question, steps }
  }
  if (steps.length > 1) {
    return { kind: "preview", session: withPending(session, { kind: "preview", steps, question: t.voicePlanHint }), steps, notes }
  }
  return { kind: "execute", session: cleanSession, steps, notes }
}

// إجابة سؤال توضيح: ترتيب ("التاني") أو اسم بيميز مرشحًا واحدًا. أي التباس
// متبقٍّ = إعادة السؤال (مفيش تخمين — req 8).
function pickClarifyCandidate(tokens: readonly string[], candidates: readonly ClarifyCandidate[]): ClarifyCandidate | null {
  const ordinal = clarificationOrdinal(tokens)
  if (ordinal !== null) {
    const index = ordinal === -1 ? candidates.length - 1 : ordinal - 1
    return candidates[index] ?? null
  }
  const query = tokens.join(" ")
  const ranked = candidates
    .map((candidate) => ({ candidate, score: nameSimilarity(query, candidate.label) }))
    .filter((entry) => entry.score >= VOICE_NAME_ACCEPT)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best) {
    return null
  }
  const second = ranked[1]
  if (second && best.score - second.score <= 0.05) {
    return null
  }
  return best.candidate
}

function applyCandidate(intent: ResolvedVoiceIntent, candidate: ClarifyCandidate): ResolvedVoiceIntent {
  if (candidate.kind === "project") {
    return { ...intent, kind: "open-project", project: { kind: "resolved", id: candidate.project.worktree, label: projectName(candidate.project) } }
  }
  if (candidate.kind === "conversation") {
    return { ...intent, kind: "open-conversation", conversation: { kind: "resolved", id: candidate.session.id, label: candidate.session.title } }
  }
  return { ...intent, kind: "change-model", model: { kind: "resolved", id: modelKey({ providerID: candidate.info.providerID, modelID: candidate.info.id }), label: shortModelName(candidate.info) } }
}

function interpretPending(transcript: string, tokens: readonly string[], context: VoiceAppContext, session: VoiceAgentSession, t: Strings): VoiceAgentTurn {
  const pending = session.pending
  if (!pending) {
    return interpretFresh(transcript, context, session, t)
  }
  if (pending.kind === "confirm" || pending.kind === "preview") {
    if (voiceNegation(tokens)) {
      return reply(withPending(session, null), t.voicePendingCancelled, "info")
    }
    if (voiceAffirmation(tokens)) {
      return { kind: "execute", session: withPending(session, null), steps: pending.steps, notes: [] }
    }
    // أمر جديد واضح بيلغي الانتظار — ولا ننفّذ المعلّق أبدًا بدون "نعم"
    const fresh = resolveVoiceIntents(transcript).filter((intent) => ACTION_KINDS.has(intent.kind) || LIST_KINDS.has(intent.kind) || intent.kind === "help" || intent.kind === "stop-listening" || intent.kind === "unsupported")
    if (fresh.length > 0) {
      return interpretFresh(transcript, context, withPending(session, null), t)
    }
    return reply(session, t.voiceYesOrCancelHint, "info")
  }
  // clarify
  const choice = pickClarifyCandidate(tokens, pending.candidates)
  if (choice) {
    const intents = pending.intents.map((intent, index) => index === pending.stepIndex ? applyCandidate(intent, choice) : intent)
    return planActionIntents(intents, [], context, withPending(session, null), t)
  }
  const fresh = resolveVoiceIntents(transcript).filter((intent) => ACTION_KINDS.has(intent.kind) || LIST_KINDS.has(intent.kind) || intent.kind === "help" || intent.kind === "stop-listening" || intent.kind === "unsupported")
  if (fresh.length > 0) {
    return interpretFresh(transcript, context, withPending(session, null), t)
  }
  // السؤال نفسه فاضل معروض في الواجهة (keepPending)، فالرسالة بتوجّه بس
  return reply(session, t.voiceDidNotCatchChoice, "info")
}

function interpretFresh(transcript: string, context: VoiceAppContext, session: VoiceAgentSession, t: Strings): VoiceAgentTurn {
  const intents = resolveVoiceIntents(transcript)
  if (intents.length === 0) {
    return reply(withPending(session, null), t.voiceDidNotUnderstand, "error")
  }
  // قدرة غير موجودة: نقولها بصراحة ولا ننفّذ أي جزء من الجملة
  if (intents.some((intent) => intent.kind === "unsupported")) {
    return reply(withPending(session, null), t.voiceUnsupportedAction, "info")
  }
  if (intents.some((intent) => intent.kind === "help")) {
    return reply(withPending(session, null), t.voiceHelpNote, "info", true)
  }
  const onlyConfirmations = intents.every((intent) => intent.kind === "affirm" || intent.kind === "deny")
  if (onlyConfirmations) {
    return reply(withPending(session, null), t.voiceDidNotUnderstand, "error")
  }
  if (intents.some((intent) => intent.kind === "stop-listening")) {
    return { kind: "stop-listening", session: withPending(session, null) }
  }
  const listIntents = intents.filter((intent) => LIST_KINDS.has(intent.kind))
  const actionIntents = intents.filter((intent) => ACTION_KINDS.has(intent.kind))
  const listed = listReplies(listIntents, context, t)
  const notes = [...listed.notes]
  const sessionAfterLists = listIntents.length > 0 ? { ...session, lastList: listed.session.lastList } : session
  return planActionIntents(actionIntents, notes, context, sessionAfterLists, t)
}

export interface InterpretVoiceTurnInput {
  transcript: string
  context: VoiceAppContext
  session: VoiceAgentSession
  t: Strings
}

export function interpretVoiceTurn(input: InterpretVoiceTurnInput): VoiceAgentTurn {
  const tokens = tokenizeVoiceText(input.transcript)
  if (tokens.length === 0) {
    return reply(withPending(input.session, null), input.t.voiceDidNotUnderstand, "error")
  }
  if (input.session.pending) {
    return interpretPending(input.transcript, tokens, input.context, input.session, input.t)
  }
  return interpretFresh(input.transcript, input.context, input.session, input.t)
}

// اختيار مرشح باللمس من الواجهة — نفس مسار الإجابة الصوتية بالظبط.
export function voiceChooseCandidate(session: VoiceAgentSession, candidate: ClarifyCandidate, context: VoiceAppContext, t: Strings): VoiceAgentTurn {
  const pending = session.pending
  if (!pending || pending.kind !== "clarify") {
    return reply(withPending(session, null), t.voiceDidNotUnderstand, "error")
  }
  const intents = pending.intents.map((intent, index) => index === pending.stepIndex ? applyCandidate(intent, candidate) : intent)
  return planActionIntents(intents, [], context, withPending(session, null), t)
}

// "متابعة" باللمس أو الصوت على معاينة/تأكيد. التحقق الفعلي بيتعاد قبل كل
// خطوة داخل المشغّل، فالظروف المتغيّرة بين السؤال والتنفيذ بتتلقط.
export function voiceConfirmPending(session: VoiceAgentSession, t: Strings): VoiceAgentTurn {
  const pending = session.pending
  if (!pending || pending.kind === "clarify") {
    return reply(withPending(session, null), t.voiceDidNotUnderstand, "error")
  }
  return { kind: "execute", session: withPending(session, null), steps: pending.steps, notes: [] }
}

export function voiceCancelPending(session: VoiceAgentSession, t: Strings): VoiceAgentTurn {
  return reply(withPending(session, null), t.voicePendingCancelled, "info")
}

// بعد التنفيذ: الذاكرة القصيرة بتتحدّث بآخر كيان اتفتح — للضمائر زي "افتحه"
// و"open it" (req 8). الخطوات الفاشلة ما بتتسجّلش.
export function rememberExecutedSteps(session: VoiceAgentSession, result: VoicePlanRunResult): VoiceAgentSession {
  let next = session
  for (const step of result.executed) {
    if (step.action === "OPEN_PROJECT") {
      next = withEntity(next, { kind: "project", id: step.params.project.worktree, label: projectName(step.params.project) })
    } else if (step.action === "OPEN_CONVERSATION" && step.params.conversation) {
      next = withEntity(next, { kind: "conversation", id: step.params.conversation.id, label: step.params.conversation.title || step.params.conversation.id })
    } else if (step.action === "CHANGE_MODEL") {
      next = withEntity(next, { kind: "model", id: modelKey(step.params.ref), label: step.params.info ? shortModelName(step.params.info) : step.params.ref.modelID })
    }
  }
  return next
}
