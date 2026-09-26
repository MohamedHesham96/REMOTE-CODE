import type { AppConfig } from "./types"

export const STATUS_TO_IDLE_MS = 8000
export const STATUS_TO_BUSY_MS = 0
export const RECENT_PROJECTS_KEY = "opencode.recentProjects"
export const LAST_SESSION_KEY = "opencode.lastSessionByProject"
export const ACTIVE_GRACE_MS = 5 * 60 * 1000
export const COMPOSER_MAX_LINES = 6
export const TOUCH_QUERY = "(hover: none), (pointer: coarse)"

export const emptyConfig: AppConfig = {
  openCode: { healthy: false, version: "" },
  push: { enabled: false, publicKey: null },
  secureContext: false,
}
