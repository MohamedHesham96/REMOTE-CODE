export type AppTheme = "glass" | "dark" | "hacker"

export const THEMES: AppTheme[] = ["glass", "dark", "hacker"]

const THEME_KEY = "opencode-theme"

export const THEME_META: Record<AppTheme, { label: string; icon: string; description: string }> = {
  glass: { label: "نهاري", icon: "☀", description: "وضع فاتح — زجاج سائل بأسلوب Apple" },
  dark: { label: "داكن", icon: "☾", description: "وضع داكن — أريح للعين ليلًا" },
  hacker: { label: "هاكر", icon: "💻", description: "طرفية خضراء كلاسيكية — جمال المصفوفة" },
}

export function getSavedTheme(): AppTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    // ترحيل الثيمات المحذوفة: الفواتح → النهاري، والغوامق → الداكن
    if (raw === "light" || raw === "purity" || raw === "transparent") {
      return "glass"
    }
    if (raw === "ocean" || raw === "glass-dark") {
      return "dark"
    }
    if (raw && (THEMES as string[]).includes(raw)) {
      return raw as AppTheme
    }
  } catch {
    // التخزين غير متاح — نرجع للافتراضي
  }
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "glass" : "dark"
  } catch {
    return "dark"
  }
}

export function saveTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // تجاهل — التخزين غير متاح
  }
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme
}

export function nextTheme(theme: AppTheme): AppTheme {
  const index = THEMES.indexOf(theme)
  return THEMES[(index + 1) % THEMES.length]
}