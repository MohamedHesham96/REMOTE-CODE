import type { Response } from "express"

export const MAX_EVENT_CLIENTS = 100
export const SSE_SLOW_CLIENT_BYTES = 1024 * 1024

// إطار بثّ المثبّتات: نفس شكل أحداث OpenCode (event/data) عشان يوصل بنفس
// قناة الـ SSE وتبقى للعميل قناة واحدة. العميل بيطبّق القائمة المضمّنة
// مباشرة، فمفيش طلب زيادة ولا تعارض بين الأجهزة.
export function pinsEvent(pins: unknown): string {
  return `event: pins\ndata: ${JSON.stringify({ pins })}\n\n`
}

// نفس قناة مثبّتات المحادثات بس لقائمة النماذج — قناة SSE واحدة في النافذة
// تحمل الحدثين، فمفيش اتصال تاني للموديلات.
export function modelPinsEvent(models: unknown): string {
  return `event: modelPins\ndata: ${JSON.stringify({ models })}\n\n`
}

// نفس القناة تالت مرة للطلبات المفضّلة: الحفظ من أي جهاز يوصل لكل الأجهزة
// المفتوحة فورًا من غير poll — نفس عقدة المثبّتات بالظبط.
export function favoritesEvent(favorites: unknown): string {
  return `event: favorites\ndata: ${JSON.stringify({ favorites })}\n\n`
}

export class EventHub {
  private readonly clients = new Set<Response>()

  add(client: Response): void {
    if (this.clients.size >= MAX_EVENT_CLIENTS) {
      const oldest = this.clients.values().next()
      if (!oldest.done) {
        try {
          oldest.value.end()
        } catch {
          // ignore
        }
        this.clients.delete(oldest.value)
      }
    }
    this.clients.add(client)
  }

  remove(client: Response): void {
    this.clients.delete(client)
  }

  broadcast(data: string): void {
    for (const client of this.clients) {
      try {
        if (client.writableEnded) {
          this.clients.delete(client)
          continue
        }
        const buffered = typeof client.writableLength === "number" ? client.writableLength : 0
        if (buffered > SSE_SLOW_CLIENT_BYTES) {
          try {
            client.end()
          } catch {
            // ignore
          }
          this.clients.delete(client)
          continue
        }
        client.write(data)
      } catch {
        this.clients.delete(client)
      }
    }
  }
}
