import { useEffect, useRef, useState } from "react"
import { projectName, samePath } from "../../display"
import type { Language, Strings } from "../../i18n"
import type { Project } from "../../types"
import { useSortedProjects } from "../../hooks/useSortedProjects"

export function ProjectOptionRows({ items, selectedId, switchingKey, onSelect, t }: {
  items: Project[]
  selectedId?: string
  switchingKey: string | null
  onSelect: (project: Project) => void
  t: Strings
}) {
  return (
    <div className="project-listbox" role="listbox" aria-label={t.projects}>
      {items.map((project) => {
        const key = `${project.id}:${project.worktree}`
        const isCurrent = samePath(project.worktree, selectedId)
        const isSwitching = switchingKey === project.worktree
        return (
          <button
            role="option"
            aria-selected={isCurrent}
            className={`project-option${isCurrent ? " selected" : ""}`}
            key={key}
            disabled={switchingKey !== null}
            onClick={() => onSelect(project)}
          >
            <span className="project-option-icon" aria-hidden>{isCurrent ? "✓" : "📁"}</span>
            <span className="project-option-body">
              <strong>{projectName(project)}</strong>
              <small dir="ltr">{project.worktree}</small>
            </span>
            <span className="project-option-badges">
              {isCurrent ? <span className="current-badge">{t.current}</span> : null}
              {isSwitching ? <span className="loader small" /> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Dropdown سريع لتبديل المشاريع: زر يعرض الحالي + قائمة منسدلة ببحث فوري
export function ProjectDropdown({ projects, selectedId, switchingKey, recentPaths, onSelect, variant, t, lang }: {
  projects: Project[]
  selectedId?: string
  switchingKey: string | null
  recentPaths: string[]
  onSelect: (project: Project) => void
  variant: "sidebar" | "compact"
  t: Strings
  lang: Language
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const boxRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const sorted = useSortedProjects(projects, query, selectedId, recentPaths, lang)
  const selected = projects.find((project) => samePath(project.worktree, selectedId)) ?? null

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const toggle = () => {
    if (switchingKey) {
      return
    }
    if (!open) {
      setQuery("")
    }
    setOpen(!open)
  }

  const pick = (project: Project) => {
    setOpen(false)
    setQuery("")
    onSelect(project)
  }

  const label = switchingKey ? t.opening : selected ? projectName(selected) : t.chooseProject

  if (variant === "compact") {
    return (
      <div className="project-dropdown project-dropdown-compact" ref={boxRef}>
        <button
          className="project-dropdown-trigger compact-trigger"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={t.switchProjectsTitle}
          disabled={switchingKey !== null}
        >
          <span aria-hidden>📁</span>
          <span className="compact-trigger-name">{label}</span>
          <span aria-hidden>{open ? "⌃" : "⌄"}</span>
        </button>
        {open ? (
          <div className="project-dropdown-menu compact-menu">
            <input
              ref={searchRef}
              className="project-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.searchProjectPlaceholder}
              aria-label={t.searchProjectAria}
            />
            {projects.length === 0 ? (
              <div className="empty-state">{t.noProjectsFound}</div>
            ) : sorted.length === 0 ? (
              <div className="empty-state">{t.noResultsFor} «{query}».</div>
            ) : (
              <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={pick} t={t} />
            )}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="project-dropdown project-dropdown-sidebar" ref={boxRef}>
      <button
        className="project-dropdown-trigger project-switch"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t.switchProjectsTitle}
        disabled={switchingKey !== null}
      >
        <span className="project-switch-icon">📁</span>
        <span><small>{t.currentProject} · {t.switch}</small><strong>{label}</strong></span>
        <span aria-hidden>{open ? "⌃" : "⌄"}</span>
      </button>
      {open ? (
        <div className="project-dropdown-menu">
          {projects.length > 4 ? (
            <input
              ref={searchRef}
              className="project-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.searchProjectPlaceholder}
              aria-label={t.searchProjectAria}
            />
          ) : null}
          {projects.length === 0 ? (
            <div className="empty-state">{t.openProjectFirst}</div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">{t.noResultsFor} «{query}».</div>
          ) : (
            <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={pick} t={t} />
          )}
        </div>
      ) : null}
    </div>
  )
}

export function ProjectPicker({ projects, selectedId, switchingKey, recentPaths, onSelect, onCancel, t, lang }: {
  projects: Project[]
  selectedId?: string
  switchingKey: string | null
  recentPaths: string[]
  onSelect: (project: Project) => void
  onCancel?: () => void
  t: Strings
  lang: Language
}) {
  const [query, setQuery] = useState("")
  const sorted = useSortedProjects(projects, query, selectedId, recentPaths, lang)
  return (
    <main className="project-screen">
      <div className="project-picker">
        <div className="project-picker-header">
          <div className="brand-mark"><img src="/icon.svg" alt="OpenCode" /></div>
          <div className="eyebrow">RemoteCode</div>
          <h1>{t.chooseProject}</h1>
          <p>{t.chooseFromList}</p>
        </div>
        <div className="project-dropdown-standalone">
          <input
            className="project-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.searchProjectPlaceholder}
            aria-label={t.searchProjectAria}
          />
          {projects.length === 0 ? (
            <div className="empty-state">{t.openProjectFirst}</div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">{t.noResultsFor} «{query}».</div>
          ) : (
            <ProjectOptionRows items={sorted} selectedId={selectedId} switchingKey={switchingKey} onSelect={onSelect} t={t} />
          )}
        </div>
        {switchingKey ? <div className="picker-loading"><span className="loader" /> {t.openingProject}</div> : null}
        {onCancel ? <button className="button button-ghost" onClick={onCancel}>{t.back}</button> : null}
      </div>
    </main>
  )
}
