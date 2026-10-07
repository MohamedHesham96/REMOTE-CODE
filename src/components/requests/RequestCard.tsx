import { memo, useCallback, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react"
import type { Strings } from "../../i18n"
import type { SessionRequest, SessionStatus, ToastKind } from "../../types"
import { describeTask } from "../../utils/task-status"
import { useNowTick } from "../../hooks/useNowTick"
import { ConversationTitle } from "./ConversationTitle"
import { RequestRow } from "./RequestRow"
import { TaskStatusPanel } from "./TaskStatusPanel"

// كارت واحد للمحادثة كلها: كل الطلبات قائمة جواه، والطلب الأخير هو المفتوح.
// ترويسة الكارت شايلة عنوان المحادثة بدل عنوان الحالة — الحالة مكتفية
// بالشارة الجانبية وسطر الوصف فوق العنوان.
//
// listRef: القائمة دي (مش حاوية الشغل) هي اللي بتسكرول فعليًا — الكارت
// بحجم النافذة والقائمة جوه flex:1. لازم نوصل Ref بتاعها لـ App عشان ينزل
// لآخرها لما نفتح أي محادثة.
//
// memo: ده أثقل كومبوننت في الواجهة لأنه بيلوّن قائمة الطلبات كلها. مع
// `useNowTick` اللي بيوقظه كل ثانية، و`refreshRequests` اللي بيتنادى كل
// 1.5 ثانية أثناء الكتابة الحية، من غير memo كل صف كان بيتعاد رسمه حتى
// لو بياناته ما اتغيرتش.
interface RequestCardProps {
  requests: SessionRequest[]
  sessionId: string | null
  listRef: RefObject<HTMLUListElement | null>
  title: string
  canRenameTitle: boolean
  isEditingTitle: boolean
  titleDraft: string
  renamingTitle: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onTitleDraftChange: (value: string) => void
  onRenameSubmit: (event: FormEvent<HTMLFormElement>) => void
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onCopy: (text: string) => void
  onToast: (message: string, kind?: ToastKind) => void
  onSkip: (request: SessionRequest) => void
  onRunNow: (request: SessionRequest) => void
  onRemove: (request: SessionRequest) => void
  busyAction: string | null
  status: SessionStatus | undefined
  stalled: boolean
  waitingOnUser: boolean
  t: Strings
}

function RequestCardInner({ requests, sessionId, listRef, title, canRenameTitle, isEditingTitle, titleDraft, renamingTitle, onStartRename, onCancelRename, onTitleDraftChange, onRenameSubmit, onTitleKeyDown, onCopy, onToast, onSkip, onRunNow, onRemove, busyAction, status, stalled, waitingOnUser, t }: RequestCardProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const latest = requests[requests.length - 1]
  // الطلب الشغّال هو المفتوح افتراضيًا؛ بعد ما يخلص آخر طلب هو اللي يفضل مفتوح.
  const activeId = requests.find((request) => request.state === "running") || latest
  const expandedId = openId && requests.some((request) => request.id === openId) ? openId : activeId ? activeId.id : null
  // العدّاد بيتشغّل بس أثناء الشغل: هو اللي يسمح لخط "مفيش نشاط جديد"
  // يتحوّل لـ"في الانتظار" قبل ما السيرفر يثبت الجمود بساعته.
  const now = useNowTick(status?.type === "busy" || status?.type === "retry")
  const view = describeTask({ requests, status, stalled, waitingOnUser, now }, t)
  // callbacks مستقرة، فتحديث الطلب الجاري لا يجبر صفوف السجل غير المتغيرة على الرسم.
  const onToggle = useCallback((id: string) => setOpenId((current) => (current === id ? null : id)), [])
  return (
    <section className={`task-summary task-${latest ? latest.state : "done"}`} data-phase={view.phase}>
      <div className="task-summary-top">
        <ConversationTitle title={title} canRename={canRenameTitle} isEditing={isEditingTitle} draft={titleDraft} renaming={renamingTitle} t={t} onStartRename={onStartRename} onCancelRename={onCancelRename} onDraftChange={onTitleDraftChange} onSubmit={onRenameSubmit} onKeyDown={onTitleKeyDown} />
        <TaskStatusPanel view={view} />
      </div>
      <ul className="request-list" ref={listRef}>
        {requests.map((request) => (
          <RequestRow
            key={request.id}
            request={request}
            expanded={request.id === expandedId}
            onToggle={onToggle}
            sessionId={sessionId}
            onCopy={onCopy}
            onToast={onToast}
            onSkip={onSkip}
            onRunNow={onRunNow}
            onRemove={onRemove}
            busyAction={busyAction}
            t={t}
          />
        ))}
      </ul>
    </section>
  )
}

export const RequestCard = memo(RequestCardInner)
