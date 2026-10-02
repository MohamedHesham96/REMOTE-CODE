import type { Strings } from "./i18n"

export type AppTheme = "glass" | "dark" | "hacker" | "metal"

export const THEMES: AppTheme[] = ["glass", "dark", "hacker", "metal"]

const THEME_KEY = "opencode-theme"

export const THEME_META: Record<AppTheme, { icon: string }> = {
  glass: { icon: "☀" },
  dark: { icon: "☾" },
  hacker: { icon: "👾" },
  metal: { icon: "🔩" },
}

export function getSavedTheme(): AppTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw && (THEMES as string[]).includes(raw)) {
      return raw as AppTheme
    }
  } catch {
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
  }
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme
}

export function nextTheme(theme: AppTheme): AppTheme {
  const index = THEMES.indexOf(theme)
  return THEMES[(index + 1) % THEMES.length]
}

export function themeLabel(value: AppTheme, t: Strings): string {
  if (value === "glass") {
    return t.themeLight
  }
  if (value === "hacker") {
    return t.themeHacker
  }
  if (value === "metal") {
    return t.themeMetal
  }
  return t.themeDark
}

export function themeDescription(value: AppTheme, t: Strings): string {
  if (value === "glass") {
    return t.themeLightDesc
  }
  if (value === "hacker") {
    return t.themeHackerDesc
  }
  if (value === "metal") {
    return t.themeMetalDesc
  }
  return t.themeDarkDesc
}