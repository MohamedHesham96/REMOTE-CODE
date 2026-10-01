import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client"
import { serverMessage, type ServerLang } from "../i18n.js"

// ── وصف العملية الجارية بدل اسم الأداة الخام ──
//
// الكارت كان بيقول "يستخدم OpenCode الأداة read"، وده مش بيقول للمستخدم
// حاجة عن الشغل الفعلي. هنا بنترجم اسم الأداة لفنة يفهمها ("يقرأ ملفات"،
// "يشغّل أمرًا") عشان المستخدم يشوف OpenCode بيعمل إيه من غير ما يفتح
// تفاصيل الطلب.
//
// أسماء الأدوات في المحرك نص حر مش اتحاد مغلق (أدوات MCP/provider بتنزل
// أسماء جديدة)، فالمطابقة على substring وأول تطابق يكفي، وأي اسم مش معروف
// بيرجع لعرض الاسم الخام بدل ما يبقى الترجمة فاضية أو الكود يكسر.

type ActivityKey =
  | "activityBrowsingWeb"
  | "activitySearchingFiles"
  | "activityReadingFiles"
  | "activityRunningCommand"
  | "activityApplyingChanges"
  | "activityDelegating"

// الترتيب مقصود: الأدق أول. "webfetch" لازم يتقابل قبل "fetch" العام،
// و"apply_patch" قبل "patch"، وأي حاجة فيها "read" قبل "write" عشان
// "todoread" ماتقارنش بتعديل ملف.
const ACTIVITY_HINTS: ReadonlyArray<readonly [hint: string, key: ActivityKey]> = [
  ["web", "activityBrowsingWeb"],
  ["fetch", "activityBrowsingWeb"],
  ["browse", "activityBrowsingWeb"],
  ["http", "activityBrowsingWeb"],
  ["grep", "activitySearchingFiles"],
  ["glob", "activitySearchingFiles"],
  ["search", "activitySearchingFiles"],
  ["find", "activitySearchingFiles"],
  ["read", "activityReadingFiles"],
  ["list", "activityReadingFiles"],
  ["cat", "activityReadingFiles"],
  ["view", "activityReadingFiles"],
  ["bash", "activityRunningCommand"],
  ["shell", "activityRunningCommand"],
  ["exec", "activityRunningCommand"],
  ["command", "activityRunningCommand"],
  ["terminal", "activityRunningCommand"],
  ["edit", "activityApplyingChanges"],
  ["write", "activityApplyingChanges"],
  ["patch", "activityApplyingChanges"],
  ["apply", "activityApplyingChanges"],
  ["create", "activityApplyingChanges"],
  ["delete", "activityApplyingChanges"],
  ["task", "activityDelegating"],
  ["agent", "activityDelegating"],
]

export function activityKey(toolName: string): ActivityKey | null {
  const name = toolName.toLowerCase()
  for (const [hint, key] of ACTIVITY_HINTS) {
    if (name.includes(hint)) {
      return key
    }
  }
  return null
}

// الأداة الجارية في رسالة assistant: نداء الأداة لسه بيتولّد (streaming) أو
// الأداة نفسها شغّالة (running). completed/error مستبعدين عن قصد: الأداة دي
// خلصت وOpenCode بيمشي للخطوة اللي بعدها، فعرضها كأنها الشغل الحالي غلط.
export function findActiveTool(entry: SessionMessageAssistant | undefined): SessionMessageAssistantTool | undefined {
  return entry?.content.find((part): part is SessionMessageAssistantTool =>
    part.type === "tool" && (part.state.status === "running" || part.state.status === "streaming"))
}

export function toolActivity(tool: SessionMessageAssistantTool, lang: ServerLang): string {
  // streaming = المحرك لسه بيكتب نداء الأداة نفسه. مفيش تنفيذ شغّال بعد،
  // فده "في انتظار أداة" مش "بيستخدم أداة" — والفرق ده هو اللي بيخلّي
  // الكارت ميكذب على المستخدم إن في شغل بيتنفذ فعلًا.
  if (tool.state.status === "streaming") {
    return serverMessage("activityAwaitingTool", lang)
  }
  const key = activityKey(tool.name)
  if (key) {
    return serverMessage(key, lang)
  }
  return `${serverMessage("usesTool", lang)} ${tool.name}`
}
