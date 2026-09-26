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
// حدث داخلي: السيرفر بثّ قائمة المثبّتات الجديدة (تغيير من جهاز تاني أو من
// نافذة تانية) والـ hook بيسمعه فالتطبيقات كلها بتتحدّد من غير poll
export const PINS_SYNC_EVENT = "opencode:pins"
export const ACTIVE_GRACE_MS = 5 * 60 * 1000
export const COMPOSER_MAX_LINES = 6
export const TOUCH_QUERY = "(hover: none), (pointer: coarse)"

export const emptyConfig: AppConfig = {
  openCode: { healthy: false, version: "" },
  push: { enabled: false, publicKey: null },
  secureContext: false,
}
