import { request } from "./http"
import type { UpdateInfo } from "../types"

// فحص التحديث: السيرفر يخزّن النتيجة ويرجّعها سريعًا، والعميل كذلك يخزّنها
// محليًا فلا يُطلب الـ endpoint مع كل تحميل صفحة.
export function getUpdateInfo(): Promise<UpdateInfo> {
  return request<UpdateInfo>("/api/update")
}
