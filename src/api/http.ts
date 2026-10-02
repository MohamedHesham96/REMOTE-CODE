export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

const inflightGets = new Map<string, Promise<unknown>>()
// كاش ETag بسيط: كل مسار ليه ETag آخر بنخزّنه وبيرجع مع الطلب التالي.
// لما السيرفر يقول 304 بنرجّع آخر قيمة مخزّنة من غير فك JSON جديد —
// الـ React بيعمل bail-out لأن المرجع نفسه. المسارات اللي بتدير كاش نت
// خاص (زي getRequests) بتبقى متوافقة: هي بترسل الـ If-None-Match بنفسها
// وبتتعامل مع الـ 304 لحالها في الوعد، وبتتجاهل الكاش العام هنا.
const etagCache = new Map<string, string>()
const etagPayloadCache = new Map<string, unknown>()

export function clearEtagCache(path?: string): void {
  if (path === undefined) {
    etagCache.clear()
    etagPayloadCache.clear()
    return
  }
  etagCache.delete(path)
  etagPayloadCache.delete(path)
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase()
  // إلغاء تكرار الـ GET المتزامن: نفس المورد المطلوب لحظيًا من كذا مصدر
  // (poll + حدث SSE + resync) يشارك fetch واحدة بدل N طلبات متطابقة
  if (method === "GET") {
    const key = `${method}:${path}`
    const running = inflightGets.get(key)
    if (running) {
      return running as Promise<T>
    }
    // لو الـ caller مررنا If-None-Match، الـ dedup بيستخدمه بتبص نسخة الـ
    // ETag المخزّنة. الطريق اللي اخليتها بنفس الطريقة (متلاك ETag كاش
    // خاص) متحطيش لكان في حاجة جاية.
    const eagerEtag = etagCache.get(path)
    if (eagerEtag) {
      const callerHeaders = new Headers(init.headers)
      if (!callerHeaders.has("If-None-Match")) {
        callerHeaders.set("If-None-Match", eagerEtag)
        init = { ...init, headers: callerHeaders }
      }
    }
    const task = doRequest<T>(path, init)
      .then((payload) => {
        // doRequest بيرمي ApiError لو 304 بتيجي هنا (الـ path ما عندهوش
        // كاش نت خاص) — فده بيتلقط في catch في الأسفل لما بنحتاج.
        etagPayloadCache.set(path, payload)
        return payload
      })
      .catch((error) => {
        // ApiError بستاتوس 304: كاش ETag العام اشتغل قبل النشر، فنرجّع
        // آخر payload ونمسح الـ inflight. الـ wrapper بيرجّع نفس المرجع
        // فالـ React يعمل bail-out بدل setState مالهاش لازمة.
        if (error instanceof ApiError && error.status === 304) {
          const cached = etagPayloadCache.get(path)
          if (cached !== undefined) {
            return cached as T
          }
        }
        throw error
      })
      .finally(() => {
        if (inflightGets.get(key) === task) {
          inflightGets.delete(key)
        }
      })
    inflightGets.set(key, task)
    return task
  }
  return doRequest<T>(path, init)
}

async function doRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  })

  // كاش ETag العام: لو السيرفر رجّع ETAt، نخزّنه عشان الـ GET التالي
  // يبعت If-None-Match تلقائيًا (المتشغّل في الـ wrapper فوق).
  const etag = response.headers.get("ETag")
  if (etag) {
    etagCache.set(path, etag)
  }

  if (response.status === 304) {
    // رمي ApiError بنمو عشان الـ wrapper يقرر يستخدم الكاش بتاعه.
    throw new ApiError("Not modified", 304)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    const data = payload as { message?: string; error?: string } | undefined
    throw new ApiError(data?.message || `Request failed (${response.status})`, response.status, data?.error)
  }

  return payload as T
}
