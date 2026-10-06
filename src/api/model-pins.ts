import { request } from "./http"

interface ModelPinsResponse {
  models: string[]
}

// مثبّتات النماذج على السيرفر مش في المتصفح — عشان التثبيت من الموبايل يظهر
// على الويب والعكس، ويفضل موجود بعد الـ refresh. نفس عقدة مثبّتات المحادثات:
// كل تعديل بيرجّع القائمة كاملة من السيرفر، فالعميل بيصلّح حالته من رد واحد
// من غير poll.
export async function getModelPins(): Promise<string[]> {
  return (await request<ModelPinsResponse>("/api/model-pin")).models
}

export async function addModelPin(model: string): Promise<string[]> {
  return (await request<ModelPinsResponse>("/api/model-pin", {
    method: "POST",
    body: JSON.stringify({ model }),
  })).models
}

export async function removeModelPin(model: string): Promise<string[]> {
  return (await request<ModelPinsResponse>("/api/model-pin/remove", {
    method: "POST",
    body: JSON.stringify({ model }),
  })).models
}

// دمج (مش استبدال): جهاز لسه شغّال على النسخة اللي كانت بتخزّن في localStorage
// بيرفع كاشه أول مرة، والسيرفر بيضيف الجديد ورا الموجود فمفيش تثبيت بينسلب
// في أي اتجاه. بعد أول دمج الكاش بيبقى نسخة السيرفر، فالتكرار مالهوش أثر غير
// طلب فاضي (والسيرفر نفسه بيرجّع من غير بثّ لما مفيش جديد).
export async function mergeModelPins(models: string[]): Promise<string[]> {
  return (await request<ModelPinsResponse>("/api/model-pin/merge", {
    method: "POST",
    body: JSON.stringify({ models }),
  })).models
}