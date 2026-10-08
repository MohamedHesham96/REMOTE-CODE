import { describe, expect, it } from "vitest"
import { INITIAL_VOICE_CONTROL_STATE, reduceVoiceControl, type VoiceControlState } from "./state"

function run(events: Parameters<typeof reduceVoiceControl>[1][]): VoiceControlState {
  return events.reduce(reduceVoiceControl, INITIAL_VOICE_CONTROL_STATE)
}

describe("آلة حالات واجهة التحكم الصوتي", () => {
  it("تبدأ خاملة", () => {
    expect(INITIAL_VOICE_CONTROL_STATE.phase).toBe("idle")
  })

  it("تنتقل للاستماع وتعرض النص الجاري", () => {
    const state = run([
      { type: "start" },
      { type: "transcript", text: "افتح" },
      { type: "transcript", text: "افتح الطلبات" },
    ])
    expect(state.phase).toBe("listening")
    expect(state.transcript).toBe("افتح الطلبات")
  })

  it("تمر بمرحلة الفهم ثم التنفيذ ثم النجاح", () => {
    const state = run([
      { type: "start" },
      { type: "transcript", text: "عرض الطلبات" },
      { type: "process", text: "عرض الطلبات" },
      { type: "heard", text: "عرض الطلبات" },
      { type: "execute", planLines: ["عرض الطلبات"] },
      { type: "success", feedback: "عرضت طلبات المحادثة الحالية." },
    ])
    expect(state.phase).toBe("success")
    expect(state.feedback).toBe("عرضت طلبات المحادثة الحالية.")
    expect(state.tone).toBe("success")
    expect(state.heard).toBe("عرض الطلبات")
  })

  it("تنتقل لمرحلة انتظار الرد مع سؤال ومرشحين", () => {
    const state = run([
      { type: "start" },
      { type: "process", text: "افتح المشروع" },
      { type: "await", question: "أي مشروع تقصد؟", pendingKind: "clarify", candidates: ["RemoteCode", "RemoteCode Tools"] },
    ])
    expect(state.phase).toBe("awaiting")
    expect(state.pendingKind).toBe("clarify")
    expect(state.pendingQuestion).toBe("أي مشروع تقصد؟")
    expect(state.candidates).toEqual(["RemoteCode", "RemoteCode Tools"])
  })

  it("تبدأ استماعًا جديدًا وهي محافظة على السؤال المعلّق", () => {
    const withQuestion = run([
      { type: "await", question: "أتريد المتابعة؟", pendingKind: "confirm" },
    ])
    const listening = reduceVoiceControl(withQuestion, { type: "start" })
    expect(listening.phase).toBe("listening")
    expect(listening.pendingQuestion).toBe("أتريد المتابعة؟")
  })

  it("تنتقل لحالة الخطأ برسالة مفهومة", () => {
    const state = run([{ type: "error", feedback: "لم أفهم الطلب — جرّب صياغة أخرى." }])
    expect(state.phase).toBe("error")
    expect(state.tone).toBe("error")
  })

  it("تنتقل لحالة الإلغاء وتنضّف المعلّق", () => {
    const state = run([
      { type: "await", question: "سؤال", pendingKind: "preview" },
      { type: "cancelled", feedback: "حسنًا، أُلغيت العملية." },
    ])
    expect(state.phase).toBe("cancelled")
    expect(state.pendingKind).toBeNull()
  })

  it("تدعم حالات غير المدعوم والإذن المرفوض", () => {
    expect(run([{ type: "unsupported" }]).phase).toBe("unsupported")
    expect(run([{ type: "permission-denied" }]).phase).toBe("permission-denied")
  })

  it("التنفيذ ينضّف السؤال المعلّق", () => {
    const state = run([
      { type: "await", question: "أتريد المتابعة؟", pendingKind: "confirm" },
      { type: "execute", planLines: ["إيقاف المهمة"] },
    ])
    expect(state.phase).toBe("executing")
    expect(state.pendingKind).toBeNull()
    expect(state.planLines).toEqual(["إيقاف المهمة"])
  })

  it("رد بنجاح مع إبقاء السؤال المعلّق يحافظ عليه", () => {
    const state = run([
      { type: "await", question: "أي مشروع تقصد؟", pendingKind: "clarify", candidates: ["أ", "ب"] },
      { type: "success", feedback: "لم أفهم الاختيار.", keepPending: true },
    ])
    expect(state.phase).toBe("success")
    expect(state.pendingQuestion).toBe("أي مشروع تقصد؟")
    expect(state.candidates).toEqual(["أ", "ب"])
  })

  it("reset يرجّع الحالة الابتدائية", () => {
    const state = run([{ type: "error", feedback: "خطأ" }, { type: "reset" }])
    expect(state).toEqual(INITIAL_VOICE_CONTROL_STATE)
  })
})
