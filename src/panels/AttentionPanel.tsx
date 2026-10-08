import { memo } from "react"
import type { Strings } from "../i18n"
import type { AttentionItem, Permission } from "../types"
import { PermissionCard } from "../components/PermissionCard"
import { QuestionCard } from "../components/requests/QuestionCard"

interface AttentionPanelProps {
  items: AttentionItem[]
  onClose: () => void
  onPermissionReply: (permission: Permission, response: "once" | "always" | "reject") => Promise<void>
  onQuestionAnswered: (item: AttentionItem) => void
  t: Strings
}

function AttentionPanelInner({ items, onClose, onPermissionReply, onQuestionAnswered, t }: AttentionPanelProps) {
  return (
    <div className="drawer-backdrop attention-backdrop" onClick={onClose}>
      <aside className="drawer attention-drawer" onClick={(event) => event.stopPropagation()} aria-label={t.needsAttention}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">{items.length} · {t.needsAttention}</div>
            <h2>{t.needsAttention}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">{t.noAttentionItems}</div>
        ) : (
          <div className="attention-items">
            {items.map((item) => (
              <section className="attention-item" key={`${item.kind}:${item.sessionID}:${item.kind === "question" ? item.request.id : item.permission.id}`}>
                <div className="attention-context">
                  <strong>{item.sessionTitle || t.sessionUntitled}</strong>
                  <span>{item.projectName}</span>
                </div>
                {item.kind === "question" ? (
                  <QuestionCard
                    request={item.request}
                    sessionId={item.sessionID}
                    onAnswered={() => onQuestionAnswered(item)}
                    t={t}
                  />
                ) : (
                  <PermissionCard
                    permission={item.permission}
                    onReply={(response) => onPermissionReply(item.permission, response)}
                    t={t}
                  />
                )}
              </section>
            ))}
          </div>
        )}
      </aside>
    </div>
  )
}

export const AttentionPanel = memo(AttentionPanelInner)
