import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { addPin, forgetPins, getPins, removePin, replacePins } from "../api/pins"
import type { PinnedConversation } from "../types"
import {
  forgetPinnedConversations,
  hasLegacyPinnedFormat,
  loadPinnedConversations,
  pinConversation,
  savePinnedConversations,
  unpinConversation,
} from "../utils/storage"

interface PinnedConversations {
  // كل المثبّتات في كل المشاريع بترتيب "الأحدث تثبيتًا أولًا"
  pins: PinnedConversation[]
  isPinned: (sessionId: string) => boolean
  togglePin: (pin: PinnedConversation) => void
  // للحذف: ينضّف التثبيت من الـ state والـ storage والسيرفر في خطوة واحدة
  forgetPinned: (sessionIds: string[]) => void
  refresh: () => void
}

// المصدر الحقيقي على السيرفر (مشترك بين كل الأجهزة)؛ الـ localStorage كاش
// للعرض الأول بس. العرض بيبدأ من الكاش فورًا وبعدين بنجيب من السيرفر، فمفيش
// وميض فاضي والوضع أوفلاين بيشتغل عادي.
//
// كل تعديل بينطبّق محليًا الأول (optimistic) فالإحساس فوري، وبعدين بينتبعت
// للسيرفر. لو الطلب فشل بنرجّع الحالة القديمة وبنترك المزامنة تجيب الصورة الصح.
export function usePinnedConversations(): PinnedConversations {
  const [pins, setPins] = useState<PinnedConversation[]>(loadPinnedConversations)
  // نسخة متزامنة من الحالة لنتعامل مع ردود السيرفر المتأخرة: لو الرد رجع بعد
  // تعديل محلي تاني، مينفعش نكتب فوقه. بتتحدّث بعد الكوميت (مش أثناء الرندر)
  // فأي نقرة بتملاقي آخر حالة ات-commitت.
  const pinsRef = useRef(pins)
  useEffect(() => {
    pinsRef.current = pins
  }, [pins])
  // الكاش المحفوظ بالشكل القديم (ids مجرّدة) بيتفعّل ترقية واحدة بس: نرفعه
  // للسيرفر أول مرة عشان ما يضيعش على الأجهزة اللي بتحدّث دلوقتي.
  const legacyRef = useRef(hasLegacyPinnedFormat())

  useEffect(() => {
    savePinnedConversations(pins)
  }, [pins])

  const applyServerPins = useCallback((next: PinnedConversation[]) => {
    setPins((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
  }, [])

  const refresh = useCallback(() => {
    void getPins()
      .then((serverPins) => {
        if (!legacyRef.current) {
          applyServerPins(serverPins)
          return
        }
        legacyRef.current = false
        // ترقية من الشكل القديم: الكاش هو الوحيد اللي فيه البيانات، فبنرفعه
        replacePins(serverPins.length > 0 ? serverPins : pinsRef.current)
          .then((migrated) => {
            applyServerPins(migrated)
            // نكتب الشكل الجديد فورًا عشان الترقية متتكررش في كل تحميل
            savePinnedConversations(migrated)
          })
          .catch(() => applyServerPins(serverPins))
      })
      .catch(() => {
        // أوفلاين أو السيرفر واقع: نحتفظ بالنسخة المحلية
      })
  }, [applyServerPins])

  // تحميل أول، وبعدين تحديث كل ما الجهاز يرجع للواجهة — بنفع لو الجهاز
  // التاني ثبّت محادثة أو شالها.
  useEffect(() => {
    refresh()
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        refresh()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [refresh])

  const pinnedSet = useMemo(() => new Set(pins.map((pin) => pin.id)), [pins])

  const isPinned = useCallback((sessionId: string) => pinnedSet.has(sessionId), [pinnedSet])

  const togglePin = useCallback((pin: PinnedConversation) => {
    if (!pin.id) {
      return
    }
    const removing = pinsRef.current.some((item) => item.id === pin.id)
    setPins((current) => (removing ? unpinConversation(current, pin.id) : pinConversation(current, pin)))
    const call = removing ? removePin(pin.id) : addPin(pin)
    void call
      .then((serverPins) => {
        // المستخدم يقدر يضغط تاني قبل ما الرد يوصل: ساعتها نخلي الحالة
        // المحلية الأحدث هي اللي تفوز، ونتجاهل الرد القديم
        const serverAgrees = serverPins.some((item) => item.id === pin.id) === !removing
        if (serverAgrees) {
          return
        }
        applyServerPins(serverPins)
      })
      .catch(() => {
        // فشل الطلب: نرجّع الحالة المحلية ونترك المزامنة تيجب الصورة الصح
        setPins((current) => (removing ? pinConversation(current, pin) : unpinConversation(current, pin.id)))
        refresh()
      })
  }, [applyServerPins, refresh])

  const forgetPinned = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return
    }
    setPins((current) => forgetPinnedConversations(current, sessionIds))
    void forgetPins(sessionIds)
      .then(applyServerPins)
      .catch(() => {
        // السيرفر بينضّف التثبيت مع طلب حذف الجلسة نفسه، فالفشل هنا مش مهم
      })
  }, [applyServerPins])

  return { pins, isPinned, togglePin, forgetPinned, refresh }
}
