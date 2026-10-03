import { describe, expect, it } from "vitest"
import { strings } from "../i18n"
import { TASK_QUIET_MS } from "../constants"
import type { SessionRequest, SessionStatus } from "../types"
import { describeTask, type TaskStatusInput } from "./task-status"

// الترجمة العربية هي اللي بيتحقق منها السلوك: النصوص اللي بنقارن بيها
// جاية من نفس الـ Strings بيرسلها السيرفر، فمفيش ترجمة ثانية تكسر الاختبار.
const t = strings.ar
const NOW = 1_700_000_000_000

function request(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    id: "turn-1",
    index: 1,
    prompt: "fix the build",
    state: "done",
    activity: "",
    finalResult: "done",
    liveText: "",
    stepsCompleted: 2,
    activeTool: null,
    usedTools: [],
    resultFiles: [],
    startedAt: NOW - 60_000,
    completedAt: NOW - 30_000,
    updatedAt: NOW - 30_000,
    ...overrides,
  }
}

function input(overrides: Partial<TaskStatusInput> = {}): TaskStatusInput {
  return {
    requests: [request()],
    status: { type: "idle" },
    stalled: false,
    waitingOnUser: false,
    now: NOW,
    ...overrides,
  }
}

function busy(): SessionStatus {
  return { type: "busy" }
}

describe("describeTask", () => {
  it("marks a finished request as completed", () => {
    const view = describeTask(input(), t)
    expect(view.phase).toBe("completed")
    expect(view.label).toBe(t.taskPhaseCompleted)
    expect(view.live).toBe(false)
  })

  it("reports running with the activity the server computed", () => {
    const view = describeTask(input({
      requests: [request({ state: "running", activity: "يشغّل أمرًا", activeTool: "bash" })],
      status: busy(),
    }), t)
    expect(view.phase).toBe("running")
    expect(view.activity).toBe("يشغّل أمرًا")
    // الحركة مقصورة على الشغل الفعلي — دي اللي بتقول للمستخدم إن في شغل
    expect(view.live).toBe(true)
  })

  it("carries the current task's used tools so the panel can rotate them", () => {
    const usedTools = ["يقرأ الملفات", "يشغّل أمرًا"]
    const view = describeTask(input({
      requests: [request({ state: "running", usedTools })],
      status: busy(),
    }), t)
    expect(view.usedTools).toEqual(usedTools)
  })

  it("shows only the completion detail once the task completes", () => {
    const usedTools = ["يقرأ الملفات", "يشغّل أمرًا"]
    const view = describeTask(input({ requests: [request({ usedTools })] }), t)
    expect(view.phase).toBe("completed")
    expect(view.activity).toBe(t.taskCompletedDetail)
    expect(view.usedTools).toEqual([])
  })

  it("keeps a long running tool as running, not waiting", () => {
    // أمر بناء ممكن ياخد دقايق من غير أي حدث. الأداة الشغالة استثناء
    // مقصود في شرط السكون، وغيابه كان هيحكم على شغل صحيح إنه "في انتظار".
    const view = describeTask(input({
      requests: [request({ state: "running", activeTool: "bash", updatedAt: NOW - 10 * 60_000 })],
      status: busy(),
    }), t)
    expect(view.phase).toBe("running")
  })

  it("downgrades a silent running request to waiting", () => {
    const view = describeTask(input({
      requests: [request({ state: "running", updatedAt: NOW - TASK_QUIET_MS - 1 })],
      status: busy(),
    }), t)
    expect(view.phase).toBe("waiting")
    expect(view.activity).toBe(t.taskQuietDetail)
    expect(view.live).toBe(false)
  })

  it("keeps a fresh running request as running", () => {
    const view = describeTask(input({
      requests: [request({ state: "running", updatedAt: NOW - 1_000 })],
      status: busy(),
    }), t)
    expect(view.phase).toBe("running")
  })

  // الأهم في الكود كله: السيرفر بيحول الحالة لـ idle والصف لـ stopped لحظة
  // ما يثبت الجمود. فلو "المشكلة" اتقوّنت "الجمود" كانت المهمة الواقفة
  // هتبان اتفشّلت، والعكس كانت هتبان "في انتظار" بلا سبب.
  it("reports a confirmed stall as stuck even though the row looks stopped", () => {
    const view = describeTask(input({
      requests: [request({ state: "stopped" })],
      status: { type: "idle" },
      stalled: true,
    }), t)
    expect(view.phase).toBe("stuck")
    expect(view.label).toBe(t.taskPhaseStuck)
    expect(view.activity).toBe(t.taskStuckDetail)
    expect(view.live).toBe(false)
  })

  it("reports a stopped request as an error when nothing is running", () => {
    const view = describeTask(input({ requests: [request({ state: "stopped" })] }), t)
    expect(view.phase).toBe("error")
    expect(view.activity).toBe(t.taskErrorDetail)
  })

  it("prefers running over error while the session is still busy", () => {
    const view = describeTask(input({
      requests: [request({ state: "stopped" })],
      status: busy(),
    }), t)
    expect(view.phase).toBe("running")
  })

  it("waits on the user when a question or permission is pending", () => {
    const view = describeTask(input({
      requests: [request({ state: "running" })],
      status: busy(),
      waitingOnUser: true,
    }), t)
    expect(view.phase).toBe("waiting")
    expect(view.activity).toBe(t.taskWaitingOnYou)
  })

  // القاعدة المقصودة: التركيز على الشغل الحالي. لما في مهمة شغالة وفي طابور
  // وراها، الكارت يفضل "قيد التنفيذ" وياخد وصف المهمة الشغالة نفسها — مش
  // وصف الطلب المستني.
  it("keeps running and shows the running row's activity when a queue follows", () => {
    const view = describeTask(input({
      requests: [request({ state: "running", activity: "يشغّل أمرًا" }), request({ state: "queued", activity: "" })],
      status: busy(),
    }), t)
    expect(view.phase).toBe("running")
    expect(view.activity).toBe("يشغّل أمرًا")
    expect(view.live).toBe(true)
  })

  it("waits when only a queued request is left", () => {
    const view = describeTask(input({ requests: [request({ state: "queued", activity: "" })] }), t)
    expect(view.phase).toBe("waiting")
    expect(view.activity).toBe(t.taskQueuedDetail)
  })

  // إعادة المحاولة انتظار حقيقي حتى لو الصف لسه running: السيرفر بيعلنها
  // قبل ما يوصل الحدث، والوصف الجاي منه هو الأصدق.
  it("waits while retrying even with a running row", () => {
    const view = describeTask(input({
      requests: [request({ state: "running", activity: "يعيد OpenCode المحاولة الآن" })],
      status: { type: "retry" },
    }), t)
    expect(view.phase).toBe("waiting")
    expect(view.activity).toBe("يعيد OpenCode المحاولة الآن")
    expect(view.live).toBe(false)
  })

  it("falls back to the running copy when the server sends no activity", () => {
    const view = describeTask(input({
      requests: [request({ state: "running", activity: "" })],
      status: busy(),
    }), t)
    expect(view.phase).toBe("running")
    expect(view.activity).toBe(t.workingOnTask)
  })

  it("treats a busy session with no rows yet as running", () => {
    const view = describeTask(input({ requests: [], status: busy() }), t)
    expect(view.phase).toBe("running")
    expect(view.activity).toBe(t.workingOnTask)
  })
})
