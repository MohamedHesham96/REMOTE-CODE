import { request } from "./http"
import type { PinnedConversation } from "../types"

interface PinsResponse {
  pins: PinnedConversation[]
}

// المثبّتات على السيرفر مش في المتصفح — عشان تظهر في كل الأجهزة. كل تعديل
// بيرجّع القائمة الكاملة من السيرفر، فالعميل بيصلّح حالته من رد واحد من غير
// ما يحتاج يعمل poll.
export async function getPins(): Promise<PinnedConversation[]> {
  return (await request<PinsResponse>("/api/pin")).pins
}

export async function addPin(pin: PinnedConversation): Promise<PinnedConversation[]> {
  return (await request<PinsResponse>("/api/pin", {
    method: "POST",
    body: JSON.stringify({ pin }),
  })).pins
}

export async function removePin(id: string): Promise<PinnedConversation[]> {
  return (await request<PinsResponse>(`/api/pin/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })).pins
}

// مسح دفعة واحدة: بتتبعت لما محادثات تتحذف (السيرفر بينضّف التثبيت كمان في
// طلب الحذف نفسه، فده بس عشان العميل يحدّث شاشته فورًا)
export async function forgetPins(ids: string[]): Promise<PinnedConversation[]> {
  return (await request<PinsResponse>("/api/pin/forget", {
    method: "POST",
    body: JSON.stringify({ ids }),
  })).pins
}

// استرجاع: لو الجهاز عدّل وهو أوفلاين وعايز يرجّع كل حالته المحفوظة محليًا
export async function replacePins(pins: PinnedConversation[]): Promise<PinnedConversation[]> {
  return (await request<PinsResponse>("/api/pin", {
    method: "PUT",
    body: JSON.stringify({ pins }),
  })).pins
}
