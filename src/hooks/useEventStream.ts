import { useEffect, useRef, useState } from "react"
import type { ClientEvent, PinnedConversation } from "../types"
import { MODEL_PINS_SYNC_EVENT, PINS_SYNC_EVENT, SSE_STALE_MS, SSE_WATCHDOG_MS } from "../constants"

interface EventStreamOptions {
  enabled: boolean
  activeIdRef: { current: string | null }
  // بيتشاركوا مع App: الـ polls الدورية بتقرا sseLiveRef، وحارس الإرسال
  // بيسأل lastSseAtRef هل وصل حدث بعد لحظة إرسال معينة. بناخدهم كباراميتر
  // بدل ما الهوك يملكهم عشان App يفضل قادر يقراهم.
  sseLiveRef: { current: boolean }
  lastSseAtRef: { current: number }
  isFresh: (key: string, ttlMs?: number) => boolean
  refreshStatuses: () => void
  refreshRequests: (id?: string) => Promise<void>
  refreshActivity: () => void
  refreshAttention: () => void
  onEvent: (event: ClientEvent) => void
  onUnknownEvent: () => void
}

// اتصال SSE الواحد لكل نافذة: تتبّع الحالة الحية، وبثّ أحداث OpenCode
// والمثبّتات، وإعادة مزامنة متدرجة بعد أي انقطاع، وحارس جمود بيعيد إنشاء
// الستريم لو صمت (اتصال نصف مفتوح ما بيعملش onerror على الموبايل).
export function useEventStream(options: EventStreamOptions): boolean {
  const { enabled, activeIdRef, sseLiveRef, lastSseAtRef, isFresh, refreshStatuses, refreshRequests, refreshActivity, refreshAttention, onEvent, onUnknownEvent } = options
  const [eventConnected, setEventConnected] = useState(false)
  const eventsConnectedOnce = useRef(false)

  // مستمعات الحدث بتتعرّف من الكولباكس دي — لازم تكون مستقرة عشان الاتصال
  // ما يتهدّش ويعاد إنشاؤه مع كل render.
  useEffect(() => {
    if (!enabled) {
      return
    }
    const resyncTimers: number[] = []
    const clearResyncTimers = () => {
      for (const timer of resyncTimers) {
        window.clearTimeout(timer)
      }
      resyncTimers.length = 0
    }
    const resyncActive = () => {
      if (!isFresh("status")) {
        void refreshStatuses()
      }
      const id = activeIdRef.current
      if (id) {
        resyncTimers.push(window.setTimeout(() => void refreshRequests(id).catch(() => undefined), 300))
      }
      if (!isFresh("activity")) {
        resyncTimers.push(window.setTimeout(() => void refreshActivity(), 700))
      }
      resyncTimers.push(window.setTimeout(refreshAttention, 1000))
    }

    let source: EventSource | null = null
    const closeSource = () => {
      const current = source
      source = null
      if (current) {
        current.close()
      }
    }
    const connect = () => {
      lastSseAtRef.current = Date.now()
      const next = new EventSource("/api/events", { withCredentials: true })
      source = next
      next.addEventListener("ready", () => {
        setEventConnected(true)
        sseLiveRef.current = true
        lastSseAtRef.current = Date.now()
        // First connection: the mount effects already fetch. Any later one means the
        // stream dropped (screen lock, network change) and every event in that window
        // is gone, so re-sync now instead of waiting for the next poll tick.
        if (!eventsConnectedOnce.current) {
          eventsConnectedOnce.current = true
          return
        }
        resyncActive()
      })
      // النبضة بتوصل كحدث مسمّى (مش تعليق) فبتنعش ساعة الصحة — أساس حارس الجمود.
      next.addEventListener("ping", () => {
        lastSseAtRef.current = Date.now()
      })
      next.addEventListener("opencode", (rawEvent) => {
        // أي حدث واصل = الستريم حي — يحدّث ساعة الصحة قبل المعالجة
        lastSseAtRef.current = Date.now()
        try {
          onEvent(JSON.parse((rawEvent as MessageEvent<string>).data) as ClientEvent)
        } catch {
          onUnknownEvent()
        }
      })
      // تغيير في المثبّتات (جهاز تاني أو نافذة تانية): نحوّله لحدث داخلي
      // يسمعه hook المثبّتات — نفس اتصال SSE واحد لكل نافذة، مش اتصال تاني.
      next.addEventListener("pins", (rawEvent) => {
        try {
          const payload = JSON.parse((rawEvent as MessageEvent<string>).data) as { pins?: PinnedConversation[] }
          window.dispatchEvent(new CustomEvent(PINS_SYNC_EVENT, { detail: { pins: payload.pins } }))
        } catch {
          // رد مش مفهوم — الـ resync والـ poll بيجيبوا الصورة الصح
        }
      })
      // مثبّتات النماذج: نفس الجسر، فالقائمة العالمية بتتحدّد لكل النوافذ
      // المفتوحة لحظة ما يتثبت نموذج من أي جهاز.
      next.addEventListener("modelPins", (rawEvent) => {
        try {
          const payload = JSON.parse((rawEvent as MessageEvent<string>).data) as { models?: string[] }
          window.dispatchEvent(new CustomEvent(MODEL_PINS_SYNC_EVENT, { detail: { models: payload.models } }))
        } catch {
          // رد مش مفهوم — الـ refresh والـ poll بيجيبوا الصورة الصح
        }
      })
      next.onerror = () => {
        setEventConnected(false)
        sseLiveRef.current = false
      }
    }

    connect()

    // الاتصال نصف المفتوح (تايم آوت NAT، قفل شاشة الموبايل، تبديل شبكة) ما
    // بيعملش onerror ولا بيعيد الاتصال من نفسه، والشاشة بتفضل مجمّدة. بنقيس
    // عمر آخر نبضة ونعيد إنشاء الستريم بإيدينا؛ أول ما يتوصل تاني الـ ready
    // بيعمل resync فكل اللي فات بيتجاب.
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastSseAtRef.current <= SSE_STALE_MS) {
        return
      }
      clearResyncTimers()
      closeSource()
      setEventConnected(false)
      sseLiveRef.current = false
      connect()
    }, SSE_WATCHDOG_MS)

    return () => {
      window.clearInterval(watchdog)
      clearResyncTimers()
      closeSource()
      sseLiveRef.current = false
      setEventConnected(false)
    }
  }, [enabled, activeIdRef, sseLiveRef, lastSseAtRef, isFresh, refreshStatuses, refreshRequests, refreshActivity, refreshAttention, onEvent, onUnknownEvent])

  return eventConnected
}
