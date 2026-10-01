import type { FormEvent, KeyboardEvent, MouseEvent } from "react"
import type { Strings } from "../../i18n"

// عنوان المحادثة مع زر إعادة التسمية: كان في الهيدر العلوي وانتقل إلى
// ترويسة كارت حالة المهمة بدل عنوان الحالة، فبقي الهيدر لصف
// المشروع والموديل والأزرار فقط. الحالة مكتفية بالشارة الجانبية.
//
// النقر على الشارة نفسها يبدأ التعديل لأن ده المتوقع من مستخدم الموبايل
// (مفيش hover يبيّن القلم)؛ القلم باقي عشان إمكانية الوصول بالكيبورد.
export function ConversationTitle({ title, canRename, isEditing, draft, renaming, t, onStartRename, onCancelRename, onDraftChange, onSubmit, onKeyDown }: { title: string; canRename: boolean; isEditing: boolean; draft: string; renaming: boolean; t: Strings; onStartRename: () => void; onCancelRename: () => void; onDraftChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void }) {
  if (isEditing) {
    return (
      <form className="session-title-form" onSubmit={onSubmit}>
        <input aria-label={t.conversationName} value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={onKeyDown} maxLength={120} required autoFocus disabled={renaming} />
        <button className="title-action" type="submit" disabled={!draft.trim() || renaming} aria-label={t.save}>{renaming ? "…" : "✓"}</button>
        <button className="title-action" type="button" onClick={onCancelRename} disabled={renaming} aria-label={t.cancel}>×</button>
      </form>
    )
  }
  // القلم جوّه الشارة شغّال لوحده: من غير وقف البثّ هيبدأ التعديل مرتين
  // (مرة من الزرار ومرة من الشارة اللي حواليه).
  const handleEditButton = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onStartRename()
  }
  return (
    <div className="session-title-row"><h2 className={canRename ? "session-title-editable" : undefined} title={title} onClick={canRename ? onStartRename : undefined}><span className="session-title-text">{title}</span>{canRename ? <button className="title-edit" type="button" onClick={handleEditButton} aria-label={t.renameConversation}>✎</button> : null}</h2></div>
  )
}
