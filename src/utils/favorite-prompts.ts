import { FAVORITE_LABEL_LIMIT, FAVORITE_TEXT_LIMIT, FAVORITES_LIMIT } from "../constants"
import type { FavoritePrompt } from "../types"

// دوال خالصة لقايمة المفضّلات: التنظيف ومنع التكرار والإضافة/التعديل/الحذف.
// السيرفر هو مصدر الحقيقة وبيطبّق نفس القواعد، والدوال دي بتخلّي التعديل
// المتفائل في الواجهة متطابق مع اللي السيرفر هيرجّعه (ومفيش وميض).

// اسم افتراضي من أول سطر — نفس فكرة عنوان المحادثة التلقائي في السيرفر.
// الطلب الطويل بيتقص عند سقف العرض بثلاث نقط بدل ما يكبّر الصف.
export function favoriteLabelFromText(text: string): string {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ""
  const collapsed = firstLine.replace(/\s+/g, " ").trim()
  if (!collapsed) {
    return ""
  }
  if (collapsed.length <= FAVORITE_LABEL_LIMIT) {
    return collapsed
  }
  return `${collapsed.slice(0, FAVORITE_LABEL_LIMIT - 1).trimEnd()}…`
}

// هل النص ده محفوظ بالفعل؟ المقارنة بالنص كامل بعد trim — نفس معيار السيرفر.
export function favoriteByText(favorites: FavoritePrompt[], text: string): FavoritePrompt | undefined {
  const clean = text.trim()
  if (!clean) {
    return undefined
  }
  return favorites.find((favorite) => favorite.text === clean)
}

// بتتحمل بيانات قديمة/تالفة أو تعديل يدوي من الـ devtools: بتشيل المكرر
// (نفس الـ id أو نفس النص) والسقف والصفوف الفاضية، وبترتّب من الأحدث.
export function normalizeFavoritePrompts(values: unknown): FavoritePrompt[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seenIds = new Set<string>()
  const seenTexts = new Set<string>()
  const result: FavoritePrompt[] = []
  for (const value of values) {
    if (typeof value !== "object" || value === null) {
      continue
    }
    const candidate = value as Partial<FavoritePrompt>
    const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 200) : ""
    const text = typeof candidate.text === "string" ? candidate.text.trim().slice(0, FAVORITE_TEXT_LIMIT) : ""
    if (!id || !text || seenIds.has(id) || seenTexts.has(text)) {
      continue
    }
    seenIds.add(id)
    seenTexts.add(text)
    const label = typeof candidate.label === "string" ? candidate.label.trim().slice(0, FAVORITE_LABEL_LIMIT) : ""
    const createdAt = typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
      ? Math.trunc(candidate.createdAt)
      : 0
    result.push({ id, text, label: label || favoriteLabelFromText(text), createdAt })
    if (result.length >= FAVORITES_LIMIT) {
      break
    }
  }
  return result
}

// إضافة متفائلة: نفس المرجع لو النص موجود بالفعل أو فاضي أو أطول من السقف —
// فمنع التكرار والفشل بلا تغيير للواجهة. الـ id بيتولّد هنا ويتبعت للسيرفر
// كمان، فالنسخة المتفائلة والنهائية بنفس المعرّف (مفيش استبدال ولا قفزة في
// مفاتيح React بعد الرد).
export function addFavoritePrompt(favorites: FavoritePrompt[], text: string): FavoritePrompt[] {
  const clean = text.trim()
  if (!clean || clean.length > FAVORITE_TEXT_LIMIT || favoriteByText(favorites, clean) || favorites.length >= FAVORITES_LIMIT) {
    return favorites
  }
  return [
    {
      id: `fav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      text: clean,
      label: favoriteLabelFromText(clean),
      createdAt: Date.now(),
    },
    ...favorites,
  ]
}

export interface FavoritePatch {
  text?: string
  label?: string
}

// تعديل متفائل: نص فاضي/طويل أو نص نسخة تانية = رفض محلي بلا تغيير.
export function updateFavoritePrompt(favorites: FavoritePrompt[], id: string, patch: FavoritePatch): FavoritePrompt[] {
  const index = favorites.findIndex((favorite) => favorite.id === id)
  const current = index >= 0 ? favorites[index] : undefined
  if (!current) {
    return favorites
  }
  const nextText = patch.text !== undefined ? patch.text.trim() : current.text
  if (!nextText || nextText.length > FAVORITE_TEXT_LIMIT) {
    return favorites
  }
  if (nextText !== current.text && favorites.some((favorite, candidateIndex) => candidateIndex !== index && favorite.text === nextText)) {
    return favorites
  }
  let nextLabel = patch.label !== undefined ? patch.label.trim().slice(0, FAVORITE_LABEL_LIMIT) : current.label
  if (patch.text !== undefined && patch.label === undefined && current.label === favoriteLabelFromText(current.text)) {
    // الاسم كان مشتقًا من النص القديم — يتبعه للنص الجديد
    nextLabel = favoriteLabelFromText(nextText)
  }
  if (!nextLabel) {
    nextLabel = favoriteLabelFromText(nextText)
  }
  const next: FavoritePrompt = { ...current, text: nextText, label: nextLabel }
  const copy = [...favorites]
  copy[index] = next
  return copy
}

export function removeFavoritePrompt(favorites: FavoritePrompt[], id: string): FavoritePrompt[] {
  const next = favorites.filter((favorite) => favorite.id !== id)
  return next.length === favorites.length ? favorites : next
}
