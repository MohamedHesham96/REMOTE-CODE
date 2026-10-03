// كاش `Map`: المفتاح = المسار الخام، القيمة = المسار المطبّع. المسارات
// ثابتة عبر عمر الصفحة، فالـ cache بيخلّينا نتجنّب عمليتي regex + toLowerCase
// في كل استدعاء. `samePath` و`renderSessionItem` و`openProject` كلها بتستدعي
// الدالة بشكل متكرر.
const normalizeCache = new Map<string, string>()

export function normalizeProjectPath(path: string): string {
  const cached = normalizeCache.get(path)
  if (cached !== undefined) {
    return cached
  }
  const normalized = path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
  // سقف الكاش: 256 مدخل كافي لعدد المشاريع النشطة في الـ session
  // — لو زاد يبقى عندنا leak، فنمسح الأقدم (insertion order)
  if (normalizeCache.size >= 256) {
    const oldest = normalizeCache.keys().next()
    if (!oldest.done) {
      normalizeCache.delete(oldest.value)
    }
  }
  normalizeCache.set(path, normalized)
  return normalized
}
