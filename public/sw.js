const CACHE_NAME = "opencode-mobile-shell-v4"
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"]

// ملفات Vite في وضع التطوير (HMR) — لا تُخزّن أبدًا عشان التعديلات تبان فورًا على الموبايل
const DEV_BYPASS = ["/src/", "/@vite", "/@fs/", "/@react-refresh", "__vite", "hot-update", ".tsx", ".ts"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) {
    return
  }
  // وضع التطوير: سيب Vite يحدّث الملفات مباشرة بدون كاش
  if (DEV_BYPASS.some((part) => url.pathname.includes(part) || url.search.includes(part))) {
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")))
    return
  }

  // ملفات الإنتاج المبنية فيها hash في الاسم (immutable) — كاش أولًا ماشي
  const isHashedAsset = url.pathname.startsWith("/assets/")
  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
          }
          return response
        })
        return cached || network
      }),
    )
    return
  }

  // باقي الملفات (CSS/JS بدون hash): الشبكة أولًا عشان التحديثات تبان من أول refresh
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
        }
        return response
      })
      .catch(() => caches.match(request)),
  )
})

self.addEventListener("push", (event) => {
  let data = { title: "OpenCode", body: "لديك تحديث جديد", sessionId: "" }
  try {
    if (event.data) {
      data = { ...data, ...event.data.json() }
    }
  } catch {
    data.body = event.data?.text() || data.body
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || "opencode-update",
      renotify: true,
      silent: false,
      vibrate: [180, 100, 180, 100, 320],
      requireInteraction: true,
      data: { sessionId: data.sessionId || "" },
      icon: "/icon.svg",
      badge: "/icon.svg",
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const sessionId = event.notification.data?.sessionId
  const target = sessionId ? `/?session=${encodeURIComponent(sessionId)}` : "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients[0]
      if (existing) {
        void existing.navigate(target)
        return existing.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})
