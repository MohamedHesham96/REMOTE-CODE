import { memo, useState } from "react"
import type { Strings } from "../i18n"
import type { Permission } from "../types"

// memo: كارت الإذن بيتكرر في الشريط السفلي، ومع أي تحديث لحالة المحادثة
// (busy/idle, retries) الـ parent (App) بيعيد الرسم فيتأثر كل كارت لو ما
// كانش memo.
interface PermissionCardProps {
  permission: Permission
  onReply: (value: "once" | "always" | "reject") => void
  t: Strings
}

function PermissionCardInner({ permission, onReply, t }: PermissionCardProps) {
  const [working, setWorking] = useState(false)
  const reply = async (value: "once" | "always" | "reject") => {
    setWorking(true)
    try {
      await onReply(value)
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="permission-card">
      <div className="permission-icon">!</div>
      <div className="permission-content">
        <strong>{t.permissionRequest}</strong>
        <p>{permission.title}</p>
        {permission.pattern ? <code>{Array.isArray(permission.pattern) ? permission.pattern.join("، ") : permission.pattern}</code> : null}
        <div className="permission-actions">
          <button className="button button-primary" disabled={working} onClick={() => void reply("once")}>{t.allowOnce}</button>
          <button className="button button-secondary" disabled={working} onClick={() => void reply("always")}>{t.allowAlways}</button>
          <button className="button button-ghost" disabled={working} onClick={() => void reply("reject")}>{t.reject}</button>
        </div>
      </div>
    </div>
  )
}

export const PermissionCard = memo(PermissionCardInner)
