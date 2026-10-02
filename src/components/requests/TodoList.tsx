import type { Strings } from "../../i18n"
import type { Todo } from "../../types"

function todoPresentation(status: string, t: Strings): { className: string; label: string; mark: string } {
  const normalized = status.toLowerCase().replace(/-/g, "_")
  if (normalized === "completed") {
    return { className: "todo-completed", label: t.todoCompleted, mark: "✓" }
  }
  if (normalized === "in_progress") {
    return { className: "todo-in_progress", label: t.todoInProgress, mark: "◐" }
  }
  if (normalized === "cancelled") {
    return { className: "todo-cancelled", label: t.todoCancelled, mark: "×" }
  }
  return { className: "todo-pending", label: t.todoPending, mark: "○" }
}

export function TodoList({ todos, t }: { todos: Todo[]; t: Strings }) {
  if (todos.length === 0) {
    return null
  }
  return (
    <div className="todo-panel">
      <div className="todo-panel-header">
        <div className="section-title">{t.planTitle} <span>({todos.length})</span></div>
        <span className="todo-updated-label">{t.planAutoUpdate}</span>
      </div>
      <div className="todo-list">
        {todos.map((todo) => {
          const presentation = todoPresentation(todo.status, t)
          return (
            <div className={`todo-item ${presentation.className}`} key={todo.id}>
              <span className="todo-mark" aria-hidden>{presentation.mark}</span>
              <span className="todo-content">{todo.content}</span>
              <span className="todo-status">{presentation.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
