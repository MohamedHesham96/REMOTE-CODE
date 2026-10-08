import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { getAttention, replyPermission, retryFailedRequest as retryRequest } from "../api"
import type { Strings } from "../i18n"
import type { AttentionItem, ClientEvent, Permission, SessionRequest, SessionStatus, ToastKind } from "../types"

interface AgentWorkflowOptions {
  activeIdRef: { current: string | null }
  setRawStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>
  setSettledStatus: (id: string, status: SessionStatus) => void
  refreshRequests: (id?: string) => Promise<void>
  refreshActivity: () => Promise<void>
  markFetched: (key: string) => void
  addToast: (message: string, kind?: ToastKind) => void
  t: Strings
}

interface AgentWorkflowState {
  items: AttentionItem[]
  permissions: Permission[]
  permissionSessionIds: ReadonlySet<string>
  conversationIds: ReadonlySet<string>
  isOpen: boolean
  retryingRequestId: string | null
  refreshAttention: () => Promise<void>
  handleEvent: (event: ClientEvent) => void
  open: () => void
  close: () => void
  handlePermission: (permission: Permission, response: "once" | "always" | "reject") => Promise<void>
  handleQuestionAnswered: (item: AttentionItem) => void
  handleRetryRequest: (request: SessionRequest) => Promise<void>
}

export function useAgentWorkflow({ activeIdRef, setRawStatuses, setSettledStatus, refreshRequests, refreshActivity, markFetched, addToast, t }: AgentWorkflowOptions): AgentWorkflowState {
  const [items, setItems] = useState<AttentionItem[]>([])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [retryingRequestId, setRetryingRequestId] = useState<string | null>(null)
  const retryingRequestsRef = useRef<Set<string>>(new Set())
  const permissionSessionIds = useMemo(() => new Set([
    ...items.flatMap((item) => item.kind === "permission" ? [item.conversationID] : []),
    ...permissions.map((permission) => permission.sessionID),
  ]), [items, permissions])
  const conversationIds = useMemo(() => new Set(items.map((item) => item.conversationID)), [items])

  const refreshAttention = useCallback(async () => {
    try {
      const next = await getAttention()
      setItems((current) => current === next ? current : next)
      const nextPermissions = next.flatMap((item) => item.kind === "permission" ? [item.permission] : [])
      setPermissions((current) => {
        if (current.length === nextPermissions.length && current.every((permission, index) => {
          const incoming = nextPermissions[index]
          return incoming !== undefined
            && permission.id === incoming.id
            && permission.sessionID === incoming.sessionID
            && permission.title === incoming.title
            && JSON.stringify(permission.pattern) === JSON.stringify(incoming.pattern)
        })) {
          return current
        }
        return nextPermissions
      })
      markFetched("attention")
    } catch {
      // نبقي العناصر المعروفة ظاهرة إلى أن يعود الاتصال؛ لا نمسح طلبًا معلّقًا بسبب انقطاع مؤقت.
    }
  }, [markFetched])

  const handleEvent = useCallback((event: ClientEvent) => {
    if (event.type === "permission.updated") {
      setPermissions((current) => [...current.filter((permission) => permission.id !== event.properties.id), event.properties])
      void refreshAttention()
    } else if (event.type === "permission.replied") {
      setPermissions((current) => current.filter((permission) => permission.id !== event.properties.permissionID))
      void refreshAttention()
    } else if (event.type === "question.asked" || event.type === "question.replied" || event.type === "question.rejected") {
      void refreshAttention()
    } else if (event.type === "session.deleted") {
      const sessionID = event.properties.sessionID
      setPermissions((current) => current.filter((permission) => permission.sessionID !== sessionID))
      void refreshAttention()
    }
  }, [refreshAttention])

  const open = useCallback(() => {
    setIsOpen(true)
    void refreshAttention()
  }, [refreshAttention])

  const close = useCallback(() => setIsOpen(false), [])

  const handlePermission = useCallback(async (permission: Permission, response: "once" | "always" | "reject") => {
    try {
      await replyPermission(permission.sessionID, permission.id, response)
      const conversationID = itemsRef.current.find((item) => item.kind === "permission" && item.permission.id === permission.id && item.sessionID === permission.sessionID)?.conversationID ?? permission.sessionID
      setPermissions((current) => current.filter((item) => item.id !== permission.id))
      setItems((current) => current.filter((item) => item.kind !== "permission" || item.permission.id !== permission.id || item.sessionID !== permission.sessionID))
      setRawStatuses((current) => current[conversationID]?.type === "busy" ? current : { ...current, [conversationID]: { type: "busy" } })
      setSettledStatus(conversationID, { type: "busy" })
      void refreshAttention()
      void refreshActivity()
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.permissionReplyFailed, "error")
    }
  }, [addToast, refreshActivity, refreshAttention, setRawStatuses, setSettledStatus, t])

  const handleQuestionAnswered = useCallback((item: AttentionItem) => {
    if (item.kind !== "question") {
      return
    }
    setItems((current) => current.filter((candidate) => candidate.kind !== "question" || candidate.request.id !== item.request.id || candidate.sessionID !== item.sessionID))
    setRawStatuses((current) => current[item.conversationID]?.type === "busy" ? current : { ...current, [item.conversationID]: { type: "busy" } })
    setSettledStatus(item.conversationID, { type: "busy" })
    void refreshAttention()
    void refreshActivity()
  }, [refreshActivity, refreshAttention, setRawStatuses, setSettledStatus])

  const handleRetryRequest = useCallback(async (request: SessionRequest) => {
    const id = activeIdRef.current
    if (!id || !request.error) {
      return
    }
    const key = `${id}:${request.id}`
    if (retryingRequestsRef.current.has(key)) {
      return
    }
    retryingRequestsRef.current.add(key)
    setRetryingRequestId(request.id)
    try {
      const result = await retryRequest(id, request.id)
      if (!result.retried) {
        throw new Error(t.retryFailed)
      }
      if (!result.queued) {
        setRawStatuses((current) => current[id]?.type === "busy" ? current : { ...current, [id]: { type: "busy" } })
        setSettledStatus(id, { type: "busy" })
      }
      await refreshRequests(id).catch(() => undefined)
      void refreshActivity()
    } catch (error: unknown) {
      addToast(error instanceof Error ? error.message : t.retryFailed, "error")
      await refreshRequests(id).catch(() => undefined)
    } finally {
      retryingRequestsRef.current.delete(key)
      setRetryingRequestId(null)
    }
  }, [activeIdRef, addToast, refreshActivity, refreshRequests, setRawStatuses, setSettledStatus, t.retryFailed])

  return {
    items,
    permissions,
    permissionSessionIds,
    conversationIds,
    isOpen,
    retryingRequestId,
    refreshAttention,
    handleEvent,
    open,
    close,
    handlePermission,
    handleQuestionAnswered,
    handleRetryRequest,
  }
}
