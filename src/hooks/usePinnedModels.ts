import { useCallback, useEffect, useRef, useState } from "react"
import { addModelPin, getModelPins, mergeModelPins, removeModelPin } from "../api/model-pins"
import { MODEL_PINS_SYNC_EVENT } from "../constants"
import { createPinSyncGate } from "../utils/pin-sync"
import { loadPinnedModels, savePinnedModels, togglePinnedModel } from "../utils/storage"

// مثبّتات النماذج على السيرفر (مشترك بين كل الأجهزة وبيفضل بعد الـ refresh)؛
// الـ localStorage كاش للعرض الأول بس، زي مثبّتات المحادثات بالظبط.
//
// كل تعديل بينطبّق محليًا الأول (optimistic) فالإحساس فوري، وبعدين بينتبعت
// للسيرفر اللي بيحوّلها لبثّ لكل الأجهزة — فالتثبيت من الموبايل يظهر على
// الويب والعكس من غير poll. لو الطلب فشل بنرجّع الحالة القديمة ونترك المزامنة
// تجيب الصورة الصح.
//
// القائمة عالمية (مش متربوطة بمشروع): منتقي النماذج هو اللي بيستخدمها، وكل
// النوافذ المفتوحة بتتزامن معاه.
interface PinnedModels {
  // مفاتيح "providerID/modelID" بترتيب "الأحدث تثبيتًا الأول"
  keys: string[]
  isPinned: (key: string) => boolean
  togglePin: (key: string) => void
  refresh: () => void
}

// مقارنة سريعة بين قائمتين: الطول نفسه والعناصر بنفس الترتيب. القائمات
// مرتبة ومحدودة بـ 5 مفاتيح، فالمقارنة الخطية أرخص بكتير من JSON.stringify
// اللي كان بيتنفّذ على كل بثّ.
function sameKeyList(left: string[], right: string[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false
    }
  }
  return true
}

export function usePinnedModels(): PinnedModels {
  const [keys, setKeys] = useState<string[]>(loadPinnedModels)
  // نسخة متزامنة من الحالة لنتعامل مع ردود السيرفر المتأخرة: لو الرد رجع بعد
  // تعديل محلي تاني، مينفعش نكتب فوقه. بتتحدّث بعد الكوميت (مش أثناء الرندر)
  // فأي نقرة بتملاقي آخر حالة اتـcommitت.
  const keysRef = useRef(keys)
  useEffect(() => {
    keysRef.current = keys
  }, [keys])
  // الحاجز بين التعديلات المحلية وبثّ السيرفر: تعديل محلي جاري يسبّق البثّ
  // لحد ما الطلب يوصل، وبعدين أحدث قائمة من السيرفر هي اللي تفوز.
  const syncRef = useRef(createPinSyncGate())
  // الترقية من النسخة القديمة (كاش المتصفح بس) مرة واحدة في عمر الصفحة: بنرفع
  // الكاش بـدمج مش استبدال عشان تثبيتات الأجهزة التانية ما تضيعش.
  const upgradedRef = useRef(false)

  useEffect(() => {
    savePinnedModels(keys)
  }, [keys])

  const applyServerKeys = useCallback((next: string[]) => {
    setKeys((current) => (sameKeyList(current, next) ? current : next))
  }, [])

  // طلب خلص: لو فيه بثّ مستني لحد ما يخلص الطلب ده، طبّقه — هو أحدث صورة من
  // السيرفر وفيه تعديلنا نحن كمان.
  const settleRequest = useCallback(() => {
    const buffered = syncRef.current.settle() as string[] | null
    if (buffered) {
      applyServerKeys(buffered)
    }
  }, [applyServerKeys])

  const refresh = useCallback(() => {
    void getModelPins()
      .then((serverKeys) => {
        if (upgradedRef.current || keysRef.current.length === 0) {
          upgradedRef.current = true
          applyServerKeys(serverKeys)
          return
        }
        upgradedRef.current = true
        // ترقية من النسخة القديمة: الكاش المحلي هو الوحيد اللي فيه البيانات،
        // فبنرفعه بدمج (مش استبدال) عشان تثبيتات الأجهزة التانية ما تضيعش.
        // لو الدمج فشل (أوفلاين/سقف) بناخد صورة السيرفر زي ما هي.
        mergeModelPins(keysRef.current)
          .then((merged) => applyServerKeys(merged))
          .catch(() => applyServerKeys(serverKeys))
      })
      .catch(() => {
        // أوفلاين أو السيرفر واقع: نحتفظ بالنسخة المحلية
      })
  }, [applyServerKeys])

  // تحميل أول، وبعدين تحديث كل ما الجهاز يرجع للواجهة — ينفع لو الجهاز التاني
  // ثبّت نموذج أو شال. مع البثّ الحي ده backup للحالات اللي الـ SSE فيها
  // مقطوع (قفل الشاشة/شبكة). نفس عقدة مثبّتات المحادثات.
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

  // بثّ السيرفر: تغيير في أي جهاز أو نافذة تانية. بنستنى لو فيه طلب محلي
  // جاري، وبعدين نطبّق أحدث قائمة عشان مفيش تعديل يضيع.
  useEffect(() => {
    const onServerModels = (event: Event): void => {
      const detail = (event as CustomEvent<{ models?: string[] }>).detail
      const list = detail?.models
      if (!Array.isArray(list)) {
        return
      }
      const applicable = syncRef.current.broadcast(list) as string[] | null
      if (applicable) {
        applyServerKeys(applicable)
      }
    }
    window.addEventListener(MODEL_PINS_SYNC_EVENT, onServerModels)
    return () => window.removeEventListener(MODEL_PINS_SYNC_EVENT, onServerModels)
  }, [applyServerKeys])

  const togglePin = useCallback((key: string) => {
    const clean = key.trim()
    if (!clean) {
      return
    }
    const removing = keysRef.current.includes(clean)
    setKeys((current) => togglePinnedModel(current, clean))
    syncRef.current.start()
    const call = removing ? removeModelPin(clean) : addModelPin(clean)
    void call
      .then((serverKeys) => {
        // المستخدم يقدر يضغط تاني قبل ما الرد يوصل: ساعتها نخلي الحالة
        // المحلية الأحدث هي اللي تفوز، ونتجاهل الرد القديم
        const serverAgrees = serverKeys.includes(clean) === !removing
        if (!serverAgrees) {
          applyServerKeys(serverKeys)
        }
      })
      .catch(() => {
        // فشل الطلب: نرجّع الحالة المحلية ونترك المزامنة تجب الصورة الصح
        setKeys((current) => togglePinnedModel(current, clean))
        refresh()
      })
      .finally(settleRequest)
  }, [applyServerKeys, refresh, settleRequest])

  const isPinned = useCallback((key: string) => keys.includes(key), [keys])

  return { keys, isPinned, togglePin, refresh }
}