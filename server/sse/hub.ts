import type { Response } from "express"

export const MAX_EVENT_CLIENTS = 100
export const SSE_SLOW_CLIENT_BYTES = 1024 * 1024

export class EventHub {
  private readonly clients = new Set<Response>()

  get size(): number {
    return this.clients.size
  }

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
    for (const client of [...this.clients]) {
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
