import { useCallback, useEffect, useState } from "react"
import { getUpdateInfo } from "../api"
import type { UpdateInfo } from "../types"
import {
  UPDATE_CACHE_KEY,
  UPDATE_DISMISS_KEY,
  dismissUpdate,
  readCachedUpdate,
  readDismissedUpdate,
  shouldCheckForUpdate,
  shouldShowUpdate,
  writeCachedUpdate,
} from "../utils/update"

// فحص التحديث مرة واحدة عند الدخول: الكاش المحلي يمنع تكرار الفحص مع كل
// تحميل صفحة، وفشل الفحص صامت تمامًا — التطبيق يعمل عادي من غير أي خطأ.
export function useUpdateNotification(enabled: boolean): {
  update: UpdateInfo | null
  visible: boolean
  dismiss: () => void
} {
  const [update, setUpdate] = useState<UpdateInfo | null>(() => readCachedUpdate()?.info ?? null)
  const [dismissed, setDismissed] = useState(() => readDismissedUpdate())

  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    // الحالة الابتدائية اتقرأت من الكاش عند أول render، فلو الكاش لسه طازج
    // مفيش أي نداء شبكة ولا أي تحديث حالة.
    const cached = readCachedUpdate()
    if (cached && !shouldCheckForUpdate(cached.checkedAt)) {
      return
    }
    void getUpdateInfo()
      .then((info) => {
        if (cancelled) {
          return
        }
        writeCachedUpdate(info)
        setUpdate(info)
      })
      .catch(() => {
        // فشل الشبكة أو السيرفر: نفضل على آخر نتيجة معروفة
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  // تبويبات متعددة: رفض من تبويب يخفي التنبيه في البقية، ونتيجة فحص من
  // تبويب تظهر في الباقي فورًا — كلاهما عبر حدث التخزين.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === UPDATE_DISMISS_KEY || event.key === null) {
        setDismissed(readDismissedUpdate())
      }
      if (event.key === UPDATE_CACHE_KEY || event.key === null) {
        setUpdate(readCachedUpdate()?.info ?? null)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const dismiss = useCallback(() => {
    if (!update?.latestVersion) {
      return
    }
    dismissUpdate(update.latestVersion)
    setDismissed(readDismissedUpdate())
  }, [update])

  return { update, visible: shouldShowUpdate(update, dismissed), dismiss }
}
