import { useState, type FormEvent, type KeyboardEvent } from "react"
import type { Language, Strings } from "../../i18n"
import type { SessionRequest, ToastKind } from "../../types"
import { ConversationTitle } from "./ConversationTitle"
import { REQUEST_STATE_LABEL, RequestRow } from "./RequestRow"

// كارت واحد للمحادثة كلها: كل الطلبات قائمة جواه، والطلب الأخير هو المفتوح.
// ترويسة الكارت شايلة عنوان المحادثة بدل عنوان الحالة — الحالة مكتفية
// بالشارة الجانبية وسطر الوصف فوق العنوان.
export function RequestCard({ requests, sessionId, title, canRenameTitle, isEditingTitle, titleDraft, renamingTitle, onStartRename, onCancelRename, onTitleDraftChange, onRenameSubmit, onTitleKeyDown, onCopy, onToast, onSkip, onRunNow, onRemove, busyAction, t, lang }: { requests: SessionRequest[]; sessionId: string | null; title: string; canRenameTitle: boolean; isEditingTitle: boolean; titleDraft: string; renamingTitle: boolean; onStartRename: () => void; onCancelRename: () => void; onTitleDraftChange: (value: string) => void; onRenameSubmit: (event: FormEvent<HTMLFormElement>) => void; onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void; onCopy: (text: string) => void; onToast: (message: string, kind?: ToastKind) => void; onSkip: (request: SessionRequest) => void; onRunNow: (request: SessionRequest) => void; onRemove: (request: SessionRequest) => void; busyAction: string | null; t: Strings; lang: Language }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const latest = requests[requests.length - 1]
  // الطلب الشغّال هو المفتوح افتراضيًا؛ بعد ما يخلص آخر طلب هو اللي يفضل مفتوح.
  const activeId = requests.find((request) => request.state === "running") || latest
  const expandedId = openId && requests.some((request) => request.id === openId) ? openId : activeId ? activeId.id : null
  return (
    <section className={`task-summary task-${latest ? latest.state : "done"}`}>
      <div className="task-summary-top">
        <div>
          <div className="eyebrow">{t.taskStatus} · {t.requestsInSession} [{requests.length}]</div>
          <ConversationTitle title={title} canRename={canRenameTitle} isEditing={isEditingTitle} draft={titleDraft} renaming={renamingTitle} t={t} onStartRename={onStartRename} onCancelRename={onCancelRename} onDraftChange={onTitleDraftChange} onSubmit={onRenameSubmit} onKeyDown={onTitleKeyDown} />
        </div>
        <span className="task-summary-state">{latest ? t[REQUEST_STATE_LABEL[latest.state]] : t.done}</span>
      </div>
      <ul className="request-list">
        {requests.map((request) => (
          <RequestRow
            key={request.id}
            request={request}
            expanded={request.id === expandedId}
            onToggle={() => setOpenId(request.id === expandedId ? null : request.id)}
            sessionId={sessionId}
            onCopy={onCopy}
            onToast={onToast}
            onSkip={() => onSkip(request)}
            onRunNow={() => onRunNow(request)}
            onRemove={() => onRemove(request)}
            busyAction={busyAction}
            t={t}
            lang={lang}
          />
        ))}
      </ul>
    </section>
  )
}
