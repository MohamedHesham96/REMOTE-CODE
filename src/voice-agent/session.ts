// حالة الجلسة الحوارية للتحكم الصوتي: ذاكرة قصيرة العمر فقط — سؤال توضيح
// معلّق، آخر كيان اتفتح (للضمائر)، وآخر قائمة عرضها الوكيل (للترتيب مثل
// "التاني"). مفيش نظام ذاكرة طويل الأمد: الحالة دي بتتبني من جديد مع كل
// جلسة صوتية وتتبني على سياق التطبيق الحي نفسه.
import type { AnyVoicePlanStep, ClarifyCandidate, ResolvedVoiceIntent } from "./intents"
import type { VoiceEntityMemory } from "./planner"

export type VoicePending =
  | {
      kind: "clarify"
      slot: "project" | "conversation" | "model" | "entity"
      question: string
      candidates: ClarifyCandidate[]
      // قائمة الأقصد الأصلية كما فهمناها — بنعيد التجهيز بعد الإجابة
      intents: ResolvedVoiceIntent[]
      stepIndex: number
    }
  | { kind: "confirm"; steps: AnyVoicePlanStep[]; question: string }
  | { kind: "preview"; steps: AnyVoicePlanStep[]; question: string }

export interface VoiceListMemory {
  kind: "projects" | "conversations" | "models"
  labels: string[]
}

export interface VoiceAgentSession {
  pending: VoicePending | null
  lastEntity: VoiceEntityMemory | null
  lastList: VoiceListMemory | null
}

export function createVoiceAgentSession(): VoiceAgentSession {
  return { pending: null, lastEntity: null, lastList: null }
}

export function withPending(session: VoiceAgentSession, pending: VoicePending | null): VoiceAgentSession {
  return { ...session, pending }
}

export function withEntity(session: VoiceAgentSession, entity: VoiceEntityMemory): VoiceAgentSession {
  return { ...session, lastEntity: entity }
}

export function withList(session: VoiceAgentSession, list: VoiceListMemory): VoiceAgentSession {
  return { ...session, lastList: list }
}
