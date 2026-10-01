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
  // الحركة المتوهجة تبقى في حالة "قيد التنفيذ" بس
  live: boolean
}

function view(phase: TaskPhase, label: string, activity: string, live: boolean): TaskStatusView {
  return { phase, label, activity, live }
}

export function describeTask(input: TaskStatusInput, t: Strings): TaskStatusView {
  const { requests, status, stalled, waitingOnUser, now } = input
  const latest = requests[requests.length - 1]
  const busy = status?.type === "busy" || status?.type === "retry"
  const running = latest !== undefined && latest.state === "running"
  // شغال بأي معنى: إما OpenCode نفسه بيقول busy، أو آخر صف لسه مفتوح.
  // الاتنين بيكملوا بعض، لأن الحالة ممكن تتأخر عن الصف أو العكس.
  const active = running || busy
  // سطر النشاط الجاهز من السيرفر، وهو اللي بيترجم الأداة الجارية لعملية مفهومة
  const activity = latest?.activity ?? ""

  // ١) الجمود المثبت من السيرفر. فوق ده كله: OpenCode واقف فعلًا، والصف
  // بقى stopped بسبب effectiveStatus، فلو التحقق ده اتأخر كانت هتطلع
  // "مشكلة" وده بيكذب على المستخدم.
  if (stalled) {
    return view("stuck", t.taskPhaseStuck, t.taskStuckDetail, false)
  }

  // ٢) طلب اتوقف في نصه والجلسة مش شغالة: إما خطأ في التنفيذ أو إيقاف
  // يدوي. الاتنين معنى إن المهمة ما خلصتش والسبب مش معروف للعميل.
  if (latest !== undefined && latest.state === "stopped" && !active) {
    return view("error", t.taskPhaseError, t.taskErrorDetail, false)
  }

  // ٣) واقف على المستخدم: سؤال أو إذن. ده انتظار مشروع مش خلل، فهو
  // "في الانتظار" مش "متجمدة". الفرق مهم لأن المستخدم هو اللي فكه.
  if (waitingOnUser) {
    return view("waiting", t.taskPhaseWaiting, t.taskWaitingOnYou, false)
  }

  // ٤) في الطابور ومستني الطلب اللي قبله. طلب مستني مش شغال، فميتبقاش
  // "قيد التنفيذ" بس.
  if (latest !== undefined && latest.state === "queued" && !running) {
    return view("waiting", t.taskPhaseWaiting, activity || t.taskQueuedDetail, false)
  }

  // ٥) إعادة محاولة: الشبكة أو المزود بياخد شوية. الانتظار هنا حقيقي،
  // والنص المناسب جاي من السيرفر أصلا.
  if (status?.type === "retry") {
    return view("waiting", t.taskPhaseWaiting, activity || t.taskPhaseWaiting, false)
  }

  // ٦) شغال بس ساكت: مفيش أداة شغالة ومفيش تحديث من مدة. الطلب لسه مفتوح
  // بس مش بيتقدم، فبنقول "في الانتظار" مش "قيد التنفيذ". الأداة الشغالة
  // مستثناة عن قصد: أمر بناء أو تثبيت ممكن ياخد دقايق من غير أي حدث،
  // وده شغل مش سكون.
  if (running && latest && latest.activeTool === null && now - latest.updatedAt >= TASK_QUIET_MS) {
    return view("waiting", t.taskPhaseWaiting, t.taskQuietDetail, false)
  }

  // ٧) شغال فعلًا. سطر النشاط من السيرفر هو اللي بيقول الأداة إيه.
  if (active) {
    return view("running", t.taskPhaseRunning, activity || t.workingOnTask, true)
  }

  return view("completed", t.taskPhaseCompleted, t.taskCompletedDetail, false)
}
