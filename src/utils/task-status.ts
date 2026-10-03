import type { Strings } from "../i18n"
import { TASK_QUIET_MS } from "../constants"
import type { SessionRequest, SessionStatus, TaskPhase } from "../types"

// حالة المهمة المعروضة في لوحة الحالة
//
// الكارت القديم كان بيعرض حالة الطلب المفردة (running/done/stopped) في شارة
// صغيرة، وسطر النشاط جوه الصف المفتوح بس. يعني المستخدم اللي ماسك للتطبيق
// من غير ما يفتح أي تفاصيل ما كانش يقدر يقول: OpenCode شغال فعلًا، ولا
// واقف، ولا خلص، ولا وقع.
//
// هنا بنشتق حالة واحدة على مستوى المحادثة من البيانات اللي السيرفر بيبعتها
// فعلًا من غير أي نداء جديد.
//
// ترتيب الفحوص متعمد: كل حالة بتتقيد باللي قبلها. أهم نقطة إن "متجمدة"
// تسبق "قيد التنفيذ"، لأن السيرفر بيحول الحالة لـ idle لحظة ما يثبت الجمود
// والصف بيطلع stopped. فلو اتقوين "قيد التنفيذ" الأول، كانت المهمة الواقفة
// هتبان شغالة أو واقفة بلا سبب.

export interface TaskStatusInput {
  requests: SessionRequest[]
  status: SessionStatus | undefined
  // حكم كاشف الجمود في السيرفر. مصدر الحقيقة الوحيد لحالة "متجمدة".
  stalled: boolean
  // في سؤال أو إذن معلق للمحادثة دي: الشغل واقف صح، بس مستني المستخدم
  waitingOnUser: boolean
  now: number
}

export interface TaskStatusView {
  phase: TaskPhase
  label: string
  // سطر بيقول OpenCode بيعمل إيه دلوقتي، جاهز للعرض ومترجم
  activity: string
  // أدوات المهمة الحالية بترتيب استخدامها. الواجهة بتقلّب عليها واحدة واحدة
  // في مرحلة "قيد التنفيذ" بدل ما تعرض قائمة طويلة على شاشة موبايل.
  usedTools: string[]
  // الحركة المتوهجة تبقى في حالة "قيد التنفيذ" بس
  live: boolean
}

function view(phase: TaskPhase, label: string, activity: string, live: boolean, usedTools: string[] = []): TaskStatusView {
  return { phase, label, activity, usedTools, live }
}

export function describeTask(input: TaskStatusInput, t: Strings): TaskStatusView {
  const { requests, status, stalled, waitingOnUser, now } = input
  const latest = requests[requests.length - 1]
  const busy = status?.type === "busy" || status?.type === "retry"
  // التركيز على الشغل الحالي: الصف الشغّال فعلًا مايكونش بالضرورة آخر صف
  // (ممكن يكون في طابور مستني وراه). بنلاقيه الأول عشان الحالة والنشاط
  // يجيبوا من المهمة اللي OpenCode شغّال عليها دلوقتي، مش من المستني.
  const runningRow = requests.find((request) => request.state === "running")
  const running = runningRow !== undefined
  // شغال بأي معنى: OpenCode نفسه بيقول busy، أو في صف لسه running. الطابور
  // لوحده مش "قيد التنفيذ" — له فرعه الخاص تحت.
  const active = running || busy
  // سطر النشاط: من الصف الشغّال لو موجود، وإلا من آخر صف. كده الوصف يوصف
  // المهمة الجارية مش الطلب المستني اللي لسه ماشتغلش.
  const activity = (runningRow ?? latest)?.activity ?? ""

  // ١) الجمود المثبت من السيرفر. فوق ده كله: OpenCode واقف فعلًا، والصف
  // بقى stopped بسبب effectiveStatus، فلو التحقق ده اتأخر كانت هتطلع
  // "مشكلة" وده بيكذب على المستخدم.
  if (stalled) {
    return view("stuck", t.taskPhaseStuck, t.taskStuckDetail, false)
  }

  // ٢) آخر طلب اتوقف في نصه والجلسة مش شغالة: إما خطأ في التنفيذ أو إيقاف
  // يدوي. الاتنين معنى إن المهمة ما خلصتش والسبب مش معروف للعميل. بنشترط
  // إنه آخر صف عشان مايغطّيش على مهمة أحدث شغالة أو مكتملة وراه.
  if (latest !== undefined && latest.state === "stopped" && !active) {
    return view("error", t.taskPhaseError, t.taskErrorDetail, false)
  }

  // ٣) واقف على المستخدم: سؤال أو إذن. ده انتظار مشروع مش خلل، فهو
  // "في الانتظار" مش "متجمدة". الفرق مهم لأن المستخدم هو اللي فكه.
  if (waitingOnUser) {
    return view("waiting", t.taskPhaseWaiting, t.taskWaitingOnYou, false)
  }

  // ٤) شغال بس ساكت: مفيش أداة شغالة ومفيش تحديث من مدة. الطلب لسه مفتوح
  // بس مش بيتقدم، فبنقول "في الانتظار" مش "قيد التنفيذ". الأداة الشغالة
  // مستثناة عن قصد: أمر بناء أو تثبيت ممكن ياخد دقايق من غير أي حدث،
  // وده شغل مش سكون.
  if (runningRow && runningRow.activeTool === null && now - runningRow.updatedAt >= TASK_QUIET_MS) {
    return view("waiting", t.taskPhaseWaiting, t.taskQuietDetail, false)
  }

  // ٥) إعادة محاولة: الشبكة أو المزود بياخد شوية. الانتظار هنا حقيقي،
  // والنص المناسب جاي من السيرفر أصلا. بتتقال قبل "قيد التنفيذ" لأن السيرفر
  // بيعلن retry على الجلسة قبل ما الصف يتحوّل running، فتقديمها بيخلي
  // الإعادة تبان صح من أول لحظة.
  if (status?.type === "retry") {
    return view("waiting", t.taskPhaseWaiting, activity || t.taskPhaseWaiting, false)
  }

  // ٦) شغال فعلاً: في صف running أو السيرفر بيقول busy. التركيز على الشغل
  // الحالي: الوصف والأدوات من الصف الشغّال (مش من طلب مستني وراه)، والحالة
  // تفضل "قيد التنفيذ" لحد ما الشغل الفعلي يقف.
  if (active) {
    return view("running", t.taskPhaseRunning, activity || t.workingOnTask, true, (runningRow ?? latest)?.usedTools ?? [])
  }

  // ٧) الطابور لوحده: آخر صف مستني ومفيش شغل شغّال. ده انتظار مشروع وله
  // وصفه الخاص، وبيتقال حتى لو الصف اللي قبله خلص فعلًا (السيرفر لسه
  // بيبلّغ idle لحظة الإرسال).
  if (latest !== undefined && latest.state === "queued") {
    return view("waiting", t.taskPhaseWaiting, t.taskQueuedDetail, false)
  }

  // مكتملة: رسالة الاكتمال بس من غير سرد أدوات — تثبيت أداة بصيغة المضارع
  // تحت "مكتملة" بيوهم إن في شغل لسه بيتنفّذ، والمهمة خلصت.
  return view("completed", t.taskPhaseCompleted, t.taskCompletedDetail, false)
}

// وصف صف واحد على حدة. بيستخدمه صف المهمة عشان يعرض نفس `TaskStatusPanel`
// اللي فوق، فالنص والأدوات يبقوا مطابقين تمامًا للوحة حالة المحادثة. الفرق
// عن `describeTask` إن ده بيشتغل على طلب واحد: حالته من `request.state`،
// ومفيش هنا حكم الجمود/الانتظار على مستوى المحادثة (دي مسؤولية اللوحة).
export function describeRequest(request: SessionRequest, t: Strings): TaskStatusView {
  switch (request.state) {
    case "running": {
      const silent = request.activeTool === null && Date.now() - request.updatedAt >= TASK_QUIET_MS
      if (silent) {
        return view("waiting", t.taskPhaseWaiting, t.taskQuietDetail, false)
      }
      return view("running", t.taskPhaseRunning, request.activity || t.workingOnTask, true, request.usedTools)
    }
    case "queued":
      return view("waiting", t.taskPhaseWaiting, request.activity || t.taskQueuedDetail, false)
    case "stopped":
      return view("error", t.taskPhaseError, t.taskErrorDetail, false)
    case "done":
      return view("completed", t.taskPhaseCompleted, t.taskCompletedDetail, false)
  }
}
