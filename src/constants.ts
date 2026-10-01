import type { AppConfig } from "./types"

export const STATUS_TO_IDLE_MS = 8000
export const STATUS_TO_BUSY_MS = 0
export const RECENT_PROJECTS_KEY = "opencode.recentProjects"
export const LAST_SESSION_KEY = "opencode.lastSessionByProject"
// الموديل + مستوى التفكير اللي المستخدم اختارهم — بيتحفظوا لكل مشروع على حدة
// عشان كل محادثة جديدة في نفس المشروع تبدأ بيه
export const DEFAULT_MODEL_KEY = "opencode.defaultModelByProject"
export const PINNED_SESSIONS_KEY = "opencode.pinnedSessions"
// سقف للمحادثات المثبّتة المحفوظة — يمنع التخزين من النمو بلا حد
export const PINNED_SESSIONS_LIMIT = 200
// مفاتيح النماذج المثبّتة في منتقي النماذج ("providerID/modelID") — كاش عرض
// محلي (مش على السيرفر)، وسقف 5 يخلّي القسم العلوي مفيدًا بدل قائمة ثانية
export const PINNED_MODELS_KEY = "opencode.pinnedModels"
export const PINNED_MODELS_LIMIT = 5
// حدث داخلي: السيرفر بثّ قائمة المثبّتات الجديدة (تغيير من جهاز تاني أو من
// نافذة تانية) والـ hook بيسمعه فالتطبيقات كلها بتتحدّد من غير poll
export const PINS_SYNC_EVENT = "opencode:pins"
export const ACTIVE_GRACE_MS = 5 * 60 * 1000
// بعد قد إيه من صمت (ولا أداة شغّالة) نعتبر الطلب "في انتظار" بدل "قيد التنفيذ".
// قصير من مهلة الجمود اللي في السيرفر (BUSY_STALL_MS = ١٠ د) عن قصد: ده
// جرس إنذار مبكر يعرض السطر بوضوح، والحكم القاطع بيفضله السيرفر. نص
// الدقيقة دا أقل من مدة أمر ممكن تاخدها فعلًا (بناء، تثبيت)، فمفتاحنا
// بيستثني الأداة الشغّالة من الحساب خالص.
export const TASK_QUIET_MS = 60 * 1000
export const COMPOSER_MAX_LINES = 6
export const TOUCH_QUERY = "(hover: none), (pointer: coarse)"
// حارس جمود الـ SSE: النبضة كل 25 ثانية، فنعتبر الستريم ميت لو صام أكتر من
// 45 ثانية (نبضة ضايعة واحدة مسموحة)، ونتفقّده كل 10 ثوان. من غيره الاتصال
// نصف المفتوح (تايم آوت NAT أو قفل شاشة الموبايل) ما بيعملش onerror ولا
// بيعيد الاتصال، فالشاشة بتجمّد لحد ما المستخدم يعمل refresh بإيده.
export const SSE_STALE_MS = 45 * 1000
export const SSE_WATCHDOG_MS = 10 * 1000

export const emptyConfig: AppConfig = {
  openCode: { healthy: false, version: "" },
  push: { enabled: false, publicKey: null },
  secureContext: false,
}
