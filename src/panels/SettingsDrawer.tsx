import type { AppConfig } from "../types"
import type { Language, Strings } from "../i18n"
import { THEME_META, themeDescription, themeLabel, THEMES, type AppTheme } from "../theme"
import { VOICE_LANGUAGES, voiceLanguageDescription, voiceLanguageLabel, type VoiceLanguage } from "../voice"
import { SettingsIcon } from "../display"

// شكل حالة الإشعارات: من App.tsx (الـ Push API check)، local type لتفادي
// تصديره من types.ts لمكوّن بسيط.
type PushState = "unknown" | "enabled" | "unsupported" | "blocked"

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  t: Strings
  // محتوى الدرج — مفصول عن الـ open عشان الـ memo يشتغل على الـ open toggle
  // بدل ما كل تغيّر حالة (موضوع/لغة/صوت) يعيد رسم الـ backdrop.
  config: AppConfig
  projectName: string
  eventConnected: boolean
  pushState: PushState
  onEnablePush: () => void
  onDisablePush: () => void
  installPromptAvailable: boolean
  onInstallApp: () => void
  theme: AppTheme
  onThemeChange: (value: AppTheme) => void
  lang: Language
  onLangChange: (value: Language) => void
  voiceLanguage: VoiceLanguage
  onVoiceLanguageChange: (value: VoiceLanguage) => void
  soundOn: boolean
  onTestSound: () => void
  onToggleSound: () => void
}

// درج الإعدادات — مُستخرَج من App.tsx ليشحن مع بقية اللوحات الكسولة.
// كل التحويلات والإعدادات مكتفية بـ props callbacks، فالمكوّن يبقى قابل
// للذاكرة (memoized) ومش بيحتاج حالة داخلية.
export function SettingsDrawer({
  open,
  onClose,
  t,
  config,
  projectName,
  eventConnected,
  pushState,
  onEnablePush,
  onDisablePush,
  installPromptAvailable,
  onInstallApp,
  theme,
  onThemeChange,
  lang,
  onLangChange,
  voiceLanguage,
  onVoiceLanguageChange,
  soundOn,
  onTestSound,
  onToggleSound,
}: SettingsDrawerProps) {
  if (!open) {
    return null
  }
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer settings-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">{t.settings}</div>
            <h2>{t.settingsDetails}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t.close}>
            <SettingsIcon />
          </button>
        </div>
        <div className="settings-list">
          <div className="setting-row">
            <div>
              <strong>{t.project}</strong>
              <small>📁 {projectName} · {t.projectSwitchHint}</small>
            </div>
            <button className="button button-secondary" onClick={onClose}>{t.ok} ✓</button>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t.opencode}</strong>
              <small>{config.openCode.version === "connected" ? t.connected : config.openCode.version}</small>
            </div>
            <span className="status-pill success">{t.connected}</span>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t.statusStream}</strong>
              <small>{eventConnected ? t.realtimeWorking : t.offline}</small>
            </div>
            <span className={`status-pill ${eventConnected ? "success" : "warning"}`}>{eventConnected ? t.active : t.inactive}</span>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t.phoneNotifications}</strong>
              <small>{config.secureContext ? t.pushViaHttps : t.pushNeedsHttps}</small>
            </div>
            {pushState === "enabled"
              ? <button className="button button-ghost" onClick={onDisablePush}>{t.disable}</button>
              : <button className="button button-secondary" onClick={onEnablePush}>{t.enable}</button>}
          </div>
          <div className="setting-row setting-row-theme">
            <div>
              <strong>🌓 {t.appearance}</strong>
              <small>{themeDescription(theme, t)}</small>
            </div>
            <div className="theme-picker" role="radiogroup" aria-label={t.appearance}>
              {THEMES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={theme === value}
                  className={`theme-option${theme === value ? " active" : ""}`}
                  onClick={() => onThemeChange(value)}
                >
                  <span className="theme-option-icon" aria-hidden>{THEME_META[value].icon}</span>
                  <span>{themeLabel(value, t)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>🌐 {t.language}</strong>
              <small>{t.languageName}</small>
            </div>
            <div className="theme-picker" role="radiogroup" aria-label={t.language}>
              <button type="button" role="radio" aria-checked={lang === "ar"} className={`theme-option${lang === "ar" ? " active" : ""}`} onClick={() => onLangChange("ar")}>
                <span>ع</span>
                <span>العربية</span>
              </button>
              <button type="button" role="radio" aria-checked={lang === "en"} className={`theme-option${lang === "en" ? " active" : ""}`} onClick={() => onLangChange("en")}>
                <span>EN</span>
                <span>English</span>
              </button>
            </div>
          </div>
          <div className="setting-row setting-row-theme">
            <div>
              <strong>🎤 {t.voiceInputLanguage}</strong>
              <small>{voiceLanguageDescription(voiceLanguage, t)}</small>
            </div>
            <div className="theme-picker" role="radiogroup" aria-label={t.voiceInputLanguage}>
              {VOICE_LANGUAGES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={voiceLanguage === value}
                  className={`theme-option${voiceLanguage === value ? " active" : ""}`}
                  onClick={() => onVoiceLanguageChange(value)}
                >
                  <span className="theme-option-icon" aria-hidden>{value === "auto" ? "🤖" : value === "ar" ? "ع" : "EN"}</span>
                  <span>{voiceLanguageLabel(value, t)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>🔔 {t.taskDoneSound}</strong>
              <small>{soundOn ? t.soundOnDesc : t.soundOffDesc}</small>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="button button-secondary" onClick={onTestSound}>{t.tryIt} 🔊</button>
              <button className={`button ${soundOn ? "button-ghost" : "button-primary"}`} onClick={onToggleSound}>{soundOn ? t.mute : t.enable}</button>
            </div>
          </div>
          {installPromptAvailable ? <button className="button button-secondary button-wide" onClick={onInstallApp}>{t.installApp}</button> : null}
          {pushState === "unsupported" ? <div className="info-box">{t.pushUnsupported}</div> : null}
          {pushState === "blocked" ? <div className="info-box">{t.pushBlocked}</div> : null}
          {!config.secureContext ? <div className="warning-box">{t.pushNeedsSecure}</div> : null}
        </div>
      </aside>
    </div>
  )
}
