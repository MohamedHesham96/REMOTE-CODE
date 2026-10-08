import { request } from "./http"
import type { FavoritePrompt } from "../types"

interface FavoritesResponse {
  favorites: FavoritePrompt[]
}

// المفضّلات على السيرفر مش في المتصفح — عشان تفضل بعد الـ refresh وإعادة
// تشغيل السيرفر وتظهر على كل الأجهزة. كل تعديل بيرجّع القائمة الكاملة من
// السيرفر (نفس عقدة المثبّتات)، فالعميل بيصلّح حالته من رد واحد من غير poll.
// `lang` بيحدّد لغة رسائل الرفض الجاية من السيرفر (مترجمة في server/i18n).
export async function getFavorites(): Promise<FavoritePrompt[]> {
  return (await request<FavoritesResponse>("/api/favorites")).favorites
}

// الحفظ idempotent على السيرفر: لو النص محفوظ بالفعل بيرجّع القائمة زي ما هي
// من غير نسخة تانية. `id` بييجي من العميل (نفس معرّف النسخة المتفائلة) عشان
// ما يحصلش استبدال للعنصر بعد الرد.
export async function addFavorite(text: string, id?: string, lang: "ar" | "en" = "ar"): Promise<FavoritePrompt[]> {
  return (await request<FavoritesResponse>(`/api/favorites?lang=${lang}`, {
    method: "POST",
    body: JSON.stringify({ favorite: { text, ...(id ? { id } : {}) } }),
  })).favorites
}

// التعديل وإعادة التسمية: الاسم الفاضي يرجع للاسم المشتق من النص.
export async function updateFavorite(id: string, patch: { text?: string; label?: string }, lang: "ar" | "en" = "ar"): Promise<FavoritePrompt[]> {
  return (await request<FavoritesResponse>(`/api/favorites/${encodeURIComponent(id)}?lang=${lang}`, {
    method: "PATCH",
    body: JSON.stringify({ favorite: patch }),
  })).favorites
}

export async function removeFavorite(id: string, lang: "ar" | "en" = "ar"): Promise<FavoritePrompt[]> {
  return (await request<FavoritesResponse>(`/api/favorites/${encodeURIComponent(id)}?lang=${lang}`, {
    method: "DELETE",
  })).favorites
}
