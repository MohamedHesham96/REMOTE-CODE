import { memo } from "react"
import { GitBranchIcon, LogoutIcon, SettingsIcon, SoundMuteIcon, SoundOnIcon, projectName } from "../display"
import { nextTheme, themeLabel, THEME_META, type AppTheme } from "../theme"
import type { Strings } from "../i18n"
import type { Project, SessionModelRef } from "../types"

interface TopBarProps {
  selectedProject: Project | null
  switchingProject: string | null
  onOpenSessions: () => void
  onNewSession: () => void
  onShowActivity: () => void
  onShowAttention: () => void
  onShowHistory: () => void
  onShowPinned: () => void
  onShowReleases: () => void
  onShowSettings: () => void
  onShowModels: () => void
  onOpenGitChanges: () => void
  onToggleTheme: () => void
  onToggleSound: () => void
  onLogout: () => void
  activeSessionsCount: number
  needsAttentionCount: number
  gitChangedCount: number
  projectPinsCount: number
  displayedModelName: string
  displayedModel: SessionModelRef | null
  theme: AppTheme
  soundOn: boolean
  t: Strings
}

function TopBarInner({
  selectedProject,
  switchingProject,
  onOpenSessions,
  onNewSession,
  onShowActivity,
  onShowAttention,
  onShowHistory,
  onShowPinned,
  onShowReleases,
  onShowSettings,
  onShowModels,
  onOpenGitChanges,
  onToggleTheme,
  onToggleSound,
  onLogout,
  activeSessionsCount,
  needsAttentionCount,
  gitChangedCount,
  projectPinsCount,
  displayedModelName,
  displayedModel,
  theme,
  soundOn,
  t,
}: TopBarProps) {
  const projectLabel = selectedProject ? projectName(selectedProject) : "—"
  const nextThemeLabelText = themeLabel(nextTheme(theme), t)
  return (
    <header className="topbar">
      <div className="current-session">
        <div className="session-head">
          <div className="topbar-project-row">
            <div className="project-name-badge" title={selectedProject ? projectName(selectedProject) : undefined}>
              <span aria-hidden>📁</span>
              <span className="compact-trigger-name">{switchingProject ? t.opening : projectLabel}</span>
            </div>
            <button className="new-chat-top" type="button" onClick={onNewSession} disabled={!selectedProject} title={t.newConversation} aria-label={t.newConversation}>
              <span aria-hidden>＋</span>
              <span className="new-chat-top-label">{t.newConversation}</span>
            </button>
            <div className="model-bar">
              <button className="model-pill" onClick={onShowModels} title={t.modelInUse}>
                <span className="model-pill-id">
                  <span aria-hidden>🤖</span>
                  <span className="model-pill-name" dir="ltr">
                    {displayedModelName}
                  </span>
                </span>
                {displayedModel?.variant ? (
                  <span className="model-pill-variant">
                    <span className="model-pill-variant-value" dir="ltr">{displayedModel.variant}</span>
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="topbar-rail">
        <button className="icon-button mobile-only" onClick={onOpenSessions} aria-label={t.openSessions}>☰</button>
        <span className="topbar-rail-divider mobile-only" aria-hidden />
        <div className="topbar-actions">
          <button className="icon-button attention-button" onClick={onShowAttention} aria-label={`${t.needsAttention}${needsAttentionCount > 0 ? ` (${needsAttentionCount})` : ""}`} title={t.needsAttention}>
            <span aria-hidden>!</span>{needsAttentionCount > 0 ? <span className="attention-count-badge">{needsAttentionCount}</span> : null}
          </button>
          <button className="icon-button activity-button icon-activity" onClick={onShowActivity} aria-label={t.activeFromAllProjects} title={`${t.activeFromAllProjects} ⚡`}>⚡{activeSessionsCount > 0 ? <span className="count-badge">{activeSessionsCount}</span> : null}</button>
          {/* ترتيب الأزرار مقصود: زر الـ git جنب زر "النشطة" عشان متابعة الملفات
              والرجوع لأقوى محادثة شغّالة يبقوا في نفس السطر من الذهن، والمثبّتة
              تاني وراهم عشان الشريط يفضل مقسوم: حالة ← ملفات ← مرجع. */}
          <button className="icon-button activity-button git-button icon-git" onClick={onOpenGitChanges} aria-label={t.gitChangesAria} title={`${t.gitChangesAria} ⑂`}><GitBranchIcon />{gitChangedCount > 0 ? <span className="count-badge">{gitChangedCount}</span> : null}</button>
          <button
            className="icon-button icon-pinned"
            onClick={onShowPinned}
            aria-label={t.pinnedConversations}
            title={`${t.pinnedConversations} — ${selectedProject ? projectName(selectedProject) : t.unknownProject} 📌`}
          >
            <span aria-hidden>📌</span>
            {projectPinsCount > 0 ? <span className="count-badge">{projectPinsCount}</span> : null}
          </button>
          <button className="icon-button icon-history" onClick={onShowHistory} aria-label={t.historyAria} title={`${t.historyAria} 🕘`}>🕘</button>
          <span className="topbar-rail-divider" aria-hidden />
          <button className="icon-button icon-theme" onClick={onToggleTheme} aria-label={`${t.themeNext}: ${nextThemeLabelText}`} title={`${t.themeNext}: ${nextThemeLabelText}`}><span aria-hidden>{THEME_META[theme].icon}</span></button>
          <button
            className={`icon-button ${soundOn ? "icon-sound" : "icon-muted"}`}
            onClick={onToggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? t.mute : t.unmute}
            title={soundOn ? t.mute : t.unmute}
          >
            {soundOn ? <SoundOnIcon /> : <SoundMuteIcon />}
          </button>
          <span className="topbar-rail-divider" aria-hidden />
          {/* ملاحظات الإصدار: مرجع ثابت لما الجديد — بجوار الإعدادات مباشرة
              لأنها فعل "معلومات عن التطبيق" وليست فعل عمل يومي. */}
          <button className="icon-button icon-releases" onClick={onShowReleases} aria-label={t.releaseNotesAria} title={`${t.releaseNotesAria} 🚀`}>🚀</button>
          <button className="icon-button icon-settings" onClick={onShowSettings} aria-label={t.settingsAria} title={t.settingsAria}><SettingsIcon /></button>
          <button className="icon-button icon-logout" onClick={onLogout} aria-label={t.logout} title={t.logout}><LogoutIcon /></button>
        </div>
      </div>
    </header>
  )
}

export const TopBar = memo(TopBarInner)
