import { useCallback, useEffect, useRef, useState } from "react"
import { STATUS_TO_BUSY_MS, STATUS_TO_IDLE_MS } from "../constants"
import type { SessionStatus } from "../types"

export function statusKind(status: SessionStatus | undefined): string {
  return status?.type ?? "idle"
}

export function isBusyKind(kind: string): boolean {
  return kind === "busy" || kind === "retry"
}

export function useSettledStatuses(
  raw: Record<string, SessionStatus>,
  toIdleMs: number = STATUS_TO_IDLE_MS,
  toBusyMs: number = STATUS_TO_BUSY_MS,
): [Record<string, SessionStatus>, (id: string, status: SessionStatus) => void] {
  const [settled, setSettled] = useState<Record<string, SessionStatus>>(raw)
  const settledRef = useRef(settled)
  const rawRef = useRef(raw)
  const timersRef = useRef(new Map<string, number>())

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  useEffect(() => {
    rawRef.current = raw
    const current = settledRef.current
    const next: Record<string, SessionStatus> = { ...current }
    let changed = false
    for (const id of new Set([...Object.keys(current), ...Object.keys(raw)])) {
      const incoming = raw[id]
      const kind = statusKind(incoming)
      if (incoming && current[id] === undefined) {
        next[id] = incoming
        clearTimer(id)
        changed = true
        continue
      }
      if (current[id]?.type === kind) {
        clearTimer(id)
        continue
      }
      const settleMs = isBusyKind(kind) ? toBusyMs : toIdleMs
      if (settleMs <= 0) {
        clearTimer(id)
        if (incoming) {
          next[id] = incoming
        } else {
          delete next[id]
        }
        changed = true
        continue
      }
      if (!timersRef.current.has(id)) {
        timersRef.current.set(id, window.setTimeout(() => {
          timersRef.current.delete(id)
          const latest = rawRef.current[id]
          const latestKind = statusKind(latest)
          const settledNow = settledRef.current
          if (settledNow[id]?.type === latestKind) {
            return
          }
          const applied = { ...settledNow }
          if (latest) {
            applied[id] = latest
          } else {
            delete applied[id]
          }
          settledRef.current = applied
          setSettled(applied)
        }, settleMs))
      }
    }
    if (changed) {
      settledRef.current = next
      setSettled(next)
    }
  }, [raw, toIdleMs, toBusyMs, clearTimer])

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) {
      window.clearTimeout(timer)
    }
    timersRef.current.clear()
  }, [])

  const setStatus = useCallback((id: string, status: SessionStatus) => {
    clearTimer(id)
    const next = { ...settledRef.current, [id]: status }
    settledRef.current = next
    setSettled(next)
  }, [clearTimer])

  return [settled, setStatus]
}
