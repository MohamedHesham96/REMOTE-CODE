import type { Part } from "../types"

export function base64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}

export function isTextPart(part: Part): part is Extract<Part, { type: "text" }> {
  return part.type === "text"
}

export function messageText(parts: Part[]): string {
  return parts.filter(isTextPart).map((part) => part.text).join("\n")
}
