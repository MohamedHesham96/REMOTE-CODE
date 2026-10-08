import { useCallback, useEffect, useRef, useState } from "react"
import { addFavorite, getFavorites, removeFavorite, updateFavorite } from "../api/favorites"
import { FAVORITES_LIMIT, FAVORITES_SYNC_EVENT, FAVORITE_TEXT_LIMIT } from "../constants"
import type { Language } from "../i18n"
import type { FavoritePrompt } from "../types"
import { createPinSyncGate } from "../utils/pin-sync"
import { addFavoritePrompt, normalizeFavoritePrompts, removeFavoritePrompt, updateFavoritePrompt, type FavoritePatch } from "../utils/favorite-prompts"
import { loadFavoritePrompts, saveFavoritePrompts } from "../utils/storage"

// الطلبات المفضّلة على السيرفر (مشترك بين كل الأجهزة وبيفضل بعد الـ refresh
// وإعادة تشغيل السيرفر)؛ الـ localStorage كاش للعرض الأول بس — نفس عقدة
// مثبّتات المحادثات والنماذج بالظبط.
//
// كل تعديل بينطبّق محليًا الأول (optimistic) فالإحساس فوري، وبعدين بينتبعت
// للسيرفر اللي بيحوّله لبثّ لكل الأجهزة — فالحفظ من الموبايل يظهر على الويب
// والعكس من غير poll. منع التكرار مضمون في المكانين: محليًا (نفس المرجع من
// غير تغيير) والسيرفر (نفس النص = مفيش نسخة تانية ولا بثّ).

export type FavoriteAction = "save" | "edit" | "remove"

interface FavoritePromptsOptions {
  langRef: { current: Language }
  // فشل أي تعديل بيوصل لمعالج واحد في App عشان يطلّع توست مترجم
  onError: (action: FavoriteAction, error: unknown) => void
}

export interface FavoritePrompts {
  favorites: FavoritePrompt[]
  save: (text: string) => void
  edit: (id: string, patch: FavoritePatch) => void
  remove: (id: string) => void
  refresh: () => void
}

// مقارنة سريعة بين قائمتي مفضّلات: الطول ونفس العناصر بنفس الترتيب.
// القائمات صغيرة (سقف 100) فالمقارنة الخطية أرخص من JSON.stringify على كل بثّ.
function sameFavoriteList(left: FavoritePrompt[], right: FavoritePrompt[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]
    const b = right[i]
    if (!a || !b || a.id !== b.id || a.text !== b.text || a.label !== b.label || a.createdAt !== b.createdAt) {
      return false
    }
  }
  return true
}

export function useFavoritePrompts({ langRef, onError }: FavoritePromptsOptions): FavoritePrompts {
  const [favorites, setFavorites] = useState<FavoritePrompt[]>(loadFavoritePrompts)
  // نسخة متزامنة لنتعامل مع النقرات السريعة: أي تعديل محلي بيكتب فيها فورًا
  // قبل الرندر، فالنقرة اللي بعده بتشوفه من غير انتظار.
  const favoritesRef = useRef(favorites)
  // الحاجز بين التعديلات المحلية وبثّ السيرفر: تعديل محلي جاري يسبّق البثّ
  // لحد ما الطلب يوصل، وبعدين أحدث قائمة من السيرفر هي اللي تفوز.
  const syncRef = useRef(createPinSyncGate())

  useEffect(() => {
    saveFavoritePrompts(favorites)
  }, [favorites])

  const applyServerFavorites = useCallback((next: FavoritePrompt[]) => {
    setFavorites((current) => (sameFavoriteList(current, next) ? current : next))
  }, [])

  // التعديل المتفائل الوحيد: بيحدّث الـ ref والحالة مع بعض عشان الحراس
  // المتزامنة (نقرة تانية قبل الرندر) تشوف الحالة الجديدة فورًا.
  const applyLocalFavorites = useCallback((next: FavoritePrompt[]) => {
    favoritesRef.current = next
    setFavorites(next)
  }, [])

  // طلب خلص: لو فيه بثّ مستني لحد ما يخلص الطلب ده، طبّقه — هو أحدث صورة
  // من السيرفر وفيه تعديلنا نحن كمان.
  const settleRequest = useCallback(() => {
    const buffered = syncRef.current.settle() as FavoritePrompt[] | null
    if (buffered) {
      applyServerFavorites(normalizeFavoritePrompts(buffered))
    }
  }, [applyServerFavorites])

  const refresh = useCallback(() => {
    void getFavorites()
      .then((serverFavorites) => {
        applyServerFavorites(serverFavorites)
      })
      .catch(() => {
        // أوفلاين أو السيرفر واقع: نحتفظ بالنسخة المحلية
      })
  }, [applyServerFavorites])

  // تحميل أول، وبعدين تحديث كل ما الجهاز يرجع للواجهة — ينفع لو جهاز تاني
  // حفظ أو عدّل. مع البثّ الحي ده backup للحالات اللي الـ SSE فيها مقطوع.
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
    const onServerFavorites = (event: Event): void => {
      const detail = (event as CustomEvent<{ favorites?: FavoritePrompt[] }>).detail
      const list = detail?.favorites
      if (!Array.isArray(list)) {
        return
      }
      const applicable = syncRef.current.broadcast(list) as FavoritePrompt[] | null
      if (applicable) {
        applyServerFavorites(normalizeFavoritePrompts(applicable))
      }
    }
    window.addEventListener(FAVORITES_SYNC_EVENT, onServerFavorites)
    return () => window.removeEventListener(FAVORITES_SYNC_EVENT, onServerFavorites)
  }, [applyServerFavorites])

  // خريطة النصوص المحفوظة بتتبنى في App (Set) عشان نجوم الصفوف تقرا منها
  // O(1)؛ الـ hook نفسه مش محتاجها — الحراس المتزامنة في save كفاية.

  const save = useCallback((text: string) => {
    const clean = text.trim()
    // منع التكرار بلا نداء شبكة: النص موجود بالفعل؟ مفيش نسخة تانية
    if (!clean || favoritesRef.current.some((favorite) => favorite.text === clean)) {
      return
    }
    // التطبيق المتفائل للنص والسقف السليمين؛ غير كده نداء السيرفر هو اللي
    // هيرجّع الرفض برسالة مترجمة بدل ما نسكت ونخزّن نسخة غير صالحة.
    // الـ id المتولّد محليًا بيتبعت مع الطلب، فالنسختين بنفس المعرّف.
    let createdId: string | undefined
    if (clean.length <= FAVORITE_TEXT_LIMIT && favoritesRef.current.length < FAVORITES_LIMIT) {
      const optimistic = addFavoritePrompt(favoritesRef.current, clean)
      if (optimistic !== favoritesRef.current) {
        createdId = optimistic[0]?.id
        applyLocalFavorites(optimistic)
      }
    }
    syncRef.current.start()
    void addFavorite(clean, createdId, langRef.current)
      .then((serverFavorites) => {
        const serverAgrees = serverFavorites.some((favorite) => favorite.text === clean)
        // نقرة تانية قبل الرد: سيب الحالة المحلية الأحدث هي اللي تفوز
        if (!serverAgrees) {
          applyServerFavorites(serverFavorites)
        }
      })
      .catch((error: unknown) => {
        // فشل الطلب: نرجّع قائمة السيرفر ونبلّغ
        onError("save", error)
        refresh()
      })
      .finally(settleRequest)
  }, [applyLocalFavorites, applyServerFavorites, langRef, onError, refresh, settleRequest])

  const edit = useCallback((id: string, patch: FavoritePatch) => {
    const nextText = patch.text !== undefined ? patch.text.trim() : undefined
    // نص فاضي/طويل: المحرر بيمنع الحفظ أصلًا، ولو وصل هنا نتجاهله بأمان
    // بدل ما نبعت تعديلًا غير صالح
    if (nextText !== undefined && (!nextText || nextText.length > FAVORITE_TEXT_LIMIT)) {
      return
    }
    const optimistic = updateFavoritePrompt(favoritesRef.current, id, patch)
    if (optimistic !== favoritesRef.current) {
      applyLocalFavorites(optimistic)
    }
    syncRef.current.start()
    void updateFavorite(id, patch, langRef.current)
      .then((serverFavorites) => {
        const updated = serverFavorites.find((favorite) => favorite.id === id)
        const agrees = Boolean(updated)
          && (patch.text === undefined || updated?.text === patch.text)
          && (patch.label === undefined || updated?.label === patch.label)
        if (!agrees) {
          applyServerFavorites(serverFavorites)
        }
      })
      .catch((error: unknown) => {
        onError("edit", error)
        refresh()
      })
      .finally(settleRequest)
  }, [applyLocalFavorites, applyServerFavorites, langRef, onError, refresh, settleRequest])

  const remove = useCallback((id: string) => {
    const optimistic = removeFavoritePrompt(favoritesRef.current, id)
    if (optimistic === favoritesRef.current) {
      return
    }
    applyLocalFavorites(optimistic)
    syncRef.current.start()
    void removeFavorite(id, langRef.current)
      .then((serverFavorites) => {
        // موجود تاني في قائمة السيرفر = الرد قديم/فشل فعليًا؛ نصلّح الحالة
        if (serverFavorites.some((favorite) => favorite.id === id)) {
          applyServerFavorites(serverFavorites)
        }
      })
      .catch((error: unknown) => {
        onError("remove", error)
        refresh()
      })
      .finally(settleRequest)
  }, [applyLocalFavorites, applyServerFavorites, langRef, onError, refresh, settleRequest])

  return { favorites, save, edit, remove, refresh }
}
