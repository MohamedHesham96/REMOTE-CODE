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
    const task = doRequest<T>(path, init).finally(() => {
      if (inflightGets.get(key) === task) {
        inflightGets.delete(key)
      }
    })
    inflightGets.set(key, task)
    return task
  }
  return doRequest<T>(path, init)
}

export async function doRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  })

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
