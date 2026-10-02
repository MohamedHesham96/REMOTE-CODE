import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { addPin, forgetPins, getPins, mergePins, removePin } from "../api/pins"
import { PINS_SYNC_EVENT } from "../constants"
import type { PinnedConversation } from "../types"
import {
  forgetPinnedConversations,
  hasLegacyPinnedFormat,
  loadPinnedConversations,
  pinConversation,
  pinsForProject,
  savePinnedConversations,
  stampPinnedProject,
  unpinConversation,
} from "../utils/storage"
import { createPinSyncGate } from "../utils/pin-sync"

// مقارنة سريعة بين قائمتي مثبّتات: لو الطول نفسه والـ ids بنفس الترتيب،
// نعتبرهم متطابقين. ده كافٍ لأن قائمة المثبّتات مرتبة (الأحدث تثبيتًا
// أولًا) ومعرّفة بمعرّف الجلسة، والـ SSE بيضم نفس البيانات غالبًا.
// بديل `JSON.stringify` اللي كان بيتنفّذ على كل بثّ سيرفر.
function samePinList(left: PinnedConversation[], right: PinnedConversation[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]
    const b = right[i]
    if (!a || !b || a.id !== b.id || a.title !== b.title || a.created !== b.created || a.worktree !== b.worktree || a.directory !== b.directory) {
      return false
    }
  }
  return true
}

interface PinnedConversations {
  // كل المثبّتات في كل المشاريع بترتيب "الأحدث تثبيتًا أولًا" — مرآة لسيرفر
  pins: PinnedConversation[]
  // مثبّتات المشروع الحالي بس — دي اللي بتتظهَر في اللوحة وبتعدّ على الدبوس
  projectPins: PinnedConversation[]
  isPinned: (sessionId: string) => boolean
  togglePin: (pin: PinnedConversation) => void
  // للحذف: ينضّف التثبيت من الـ state والـ storage والسيرفر في خطوة واحدة
  forgetPinned: (sessionIds: string[]) => void
  refresh: () => void
}

// المصدر الحقيقي على السيرفر (مشترك بين كل الأجهزة وبيفضل بعد الـ refresh)؛
// الـ localStorage كاش للعرض الأول بس. العرض بيبدأ من الكاش فورًا وبعدين
// بنجيب من السيرفر، فمفيش وميض فاضي والوضع أوفلاين بيشتغل عادي.
//
// كل تعديل بينطبّق محليًا الأول (optimistic) فالإحساس فوري، وبعدين بينتبعت
// للسيرفر. السيرفر بيحوّلها لبثّ لكل الأجهزة، فالجهاز التاني بيشوفها من غير
// poll. لو الطلب فشل بنرجّع الحالة القديمة وبنترك المزامنة تجيب الصورة الصح.
export function usePinnedConversations(worktree: string | null, projectName: string): PinnedConversations {
  const [pins, setPins] = useState<PinnedConversation[]>(loadPinnedConversations)
  // نسخة متزامنة من الحالة لنتعامل مع ردود السيرفر المتأخرة: لو الرد رجع بعد
  // تعديل محلي تاني، مينفعش نكتب فوقه. بتتحدّث بعد الكوميت (مش أثناء الرندر)
  // فأي نقرة بتملاقي آخر حالة ات-commitت.
  const pinsRef = useRef(pins)
  useEffect(() => {
    pinsRef.current = pins
  }, [pins])
  // المشروع الحالي كمرجع (مش في الـ deps): نقرة الدبوس بتخلي الـ callback
  // ثابتة، والوقت دي بنقرأ أحدث مشروع اتفتح.
  const projectRef = useRef({ worktree, projectName })
  useEffect(() => {
    projectRef.current = { worktree, projectName }
  }, [worktree, projectName])
  // الكاش المحفوظ بالشكل القديم (ids مجرّدة) بيتفعّل ترقية واحدة بس: نرفعه
  // للسيرفر أول مرة عشان ما يضيعش على الأجهزة اللي بتحدّث دلوقتي.
  const legacyRef = useRef(hasLegacyPinnedFormat())
  // الحاجز بين التعديلات المحلية وبثّ السيرفر: تعديل محلي جاري يسبّق البثّ
  // لحد ما الطلب يوصل، وبعدين أحدث قائمة من السيرفر هي اللي تفوز.
  const syncRef = useRef(createPinSyncGate())

  useEffect(() => {
    savePinnedConversations(pins)
  }, [pins])

  const applyServerPins = useCallback((next: PinnedConversation[]) => {
    setPins((current) => (samePinList(current, next) ? current : next))
  }, [])

  // طلب خلص: لو فيه بثّ مستني لحد ما يخلص الطلب ده، طبّقه — هو أحدث صورة
  // من السيرفر وفيه تعديلنا نحن كمان.
  const settleRequest = useCallback(() => {
    const buffered = syncRef.current.settle() as PinnedConversation[] | null
    if (buffered) {
      applyServerPins(buffered)
    }
  }, [applyServerPins])

  const refresh = useCallback(() => {
    void getPins()
      .then((serverPins) => {
        if (!legacyRef.current) {
          applyServerPins(serverPins)
          return
        }
        legacyRef.current = false
        // ترقية من الشكل القديم: الكاش هو الوحيد اللي فيه البيانات، فبنرفعه
        // بالسيرفر بدمج (مش استبدال) عشان مثبّتات الأجهزة التانية ما تضيعش.
        // المثبّتات من غير مسار بينسبها السيرفر لمشروعاتها من OpenCode.
        mergePins(pinsRef.current)
          .then((merged) => {
            applyServerPins(merged)
            // نكتب الشكل الجديد فورًا عشان الترقية متتكررش في كل تحميل
            savePinnedConversations(merged)
          })
          .catch(() => applyServerPins(serverPins))
      })
      .catch(() => {
        // أوفلاين أو السيرفر واقع: نحتفظ بالنسخة المحلية
      })
  }, [applyServerPins])

  // تحميل أول، وبعدين تحديث كل ما الجهاز يرجع للواجهة — بنفع لو الجهاز
  // التاني ثبّت محادثة أو شالها. مع البثّ الحي ده backup للحالات اللي
  // الـ SSE فيها مقطوع (قفل الشاشة/شبكة).
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

  // بثّ السيرفر: تغيير في أي جهاز أو في نافذة تانية. بنستنى لو فيه طلب
  // محلي جاري، وبعدين نطبّق أحدث قائمة عشان مفيش تعديل يضيع.
  useEffect(() => {
    const onServerPins = (event: Event): void => {
      const detail = (event as CustomEvent<{ pins?: PinnedConversation[] }>).detail
      const list = detail?.pins
      if (!Array.isArray(list)) {
        return
      }
      const applicable = syncRef.current.broadcast(list) as PinnedConversation[] | null
      if (applicable) {
        applyServerPins(applicable)
      }
    }
    window.addEventListener(PINS_SYNC_EVENT, onServerPins)
    return () => window.removeEventListener(PINS_SYNC_EVENT, onServerPins)
  }, [applyServerPins])

  const pinnedSet = useMemo(() => new Set(pins.map((pin) => pin.id)), [pins])

  const isPinned = useCallback((sessionId: string) => pinnedSet.has(sessionId), [pinnedSet])

  const togglePin = useCallback((pin: PinnedConversation) => {
    if (!pin.id) {
      return
    }
    const removing = pinsRef.current.some((item) => item.id === pin.id)
    // التثبيت بينسب للمشروع المفتوح دلوقتي: المسارات اللي جاية في البيانات
    // (من كاش قديم أو تعديل يدوي) بتتنسب للمشروع الحالي، فمستحيل مثبّتة
    // تطلع في لوحة مشروع تاني.
    const stamped = removing ? pin : stampPinnedProject(pin, projectRef.current.worktree || "", projectRef.current.projectName)
    setPins((current) => (removing ? unpinConversation(current, pin.id) : pinConversation(current, stamped)))
    syncRef.current.start()
    const call = removing ? removePin(pin.id) : addPin(stamped)
    void call
      .then((serverPins) => {
        // المستخدم يقدر يضغط تاني قبل ما الرد يوصل: ساعتها نخلي الحالة
        // المحلية الأحدث هي اللي تفوز، ونتجاهل الرد القديم
        const serverAgrees = serverPins.some((item) => item.id === pin.id) === !removing
        if (!serverAgrees) {
          applyServerPins(serverPins)
        }
      })
      .catch(() => {
        // فشل الطلب: نرجّع الحالة المحلية ونترك المزامنة تيجب الصورة الصح
        setPins((current) => (removing ? pinConversation(current, pin) : unpinConversation(current, pin.id)))
        refresh()
      })
      .finally(settleRequest)
  }, [applyServerPins, refresh, settleRequest])

  const forgetPinned = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return
    }
    setPins((current) => forgetPinnedConversations(current, sessionIds))
    syncRef.current.start()
    void forgetPins(sessionIds)
      .catch(() => {
        // السيرفر بينضّف التثبيت مع طلب حذف الجلسة نفسه، فالفشل هنا مش مهم
      })
      .finally(settleRequest)
  }, [settleRequest])

  const projectPins = useMemo(() => pinsForProject(pins, worktree), [pins, worktree])

  return { pins, projectPins, isPinned, togglePin, forgetPinned, refresh }
}
