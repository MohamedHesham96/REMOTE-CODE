import { TOUCH_QUERY } from "../constants"

// Enter يبعت بس على الأجهزة اللي فيها لوحة مفاتيح فعلية؛ على الموبايل
// (والكيبورد على الشاشة) Enter ياخد سطر جديد والإرسال بزر الإرسال
export function isTouchComposer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia(TOUCH_QUERY).matches
}
