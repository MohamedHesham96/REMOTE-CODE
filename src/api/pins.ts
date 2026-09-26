import { request } from "./http"
import type { PinnedConversation } from "../types"

interface PinsResponse {
  pins: PinnedConversation[]
  projectKey?: string
  total?: number
}

// المثبّتات على السيرفر مش في المتصفح — عشان تظهر في كل الأجهزة وتفضل بعد
// الـ refresh. كل تعديل بيرجّع القائمة الكاملة من السيرفر، فالعميل بيصلّح
// حالته من رد واحد من غير ما يحتاج يعمل poll.
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

// دمج (مش استبدال): جهاز عنده كاش أقدم بيرفعه، والسيرفر بيضيف الجديد فوق
// الموجود. ده بيجنّب ضياع مثبّتات أي جهاز تاني لو السيرفر لسه فاضي أو فيه
// مثبّتات من جهاز بيشتغل في نفس الوقت.
export async function mergePins(pins: PinnedConversation[]): Promise<PinnedConversation[]> {
  return (await request<PinsResponse>("/api/pin/merge", {
    method: "POST",
    body: JSON.stringify({ pins }),
  })).pins
}
