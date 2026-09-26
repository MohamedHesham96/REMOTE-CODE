// FNV-1a خفيفة (32-bit) لبصمات ETag — من غير crypto وبتكفي للكشف عن التغيير
export function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function etagFor(version: string): string {
  return `W/"${fnv1a(version)}-${version.length}"`
}
