// آخر جزء من نص طويل: آخر maxLines سطر في حدود ميزانية الأحرف، محسوبين من
// نهاية النص. بنستخدمه في الرد المباشر والنتيجة النهائية عشان العرض المطوي
// يظل متمركزًا على أحدث ما كتبه OpenCode بدل بداية الرد.
export function tailPreview(text: string, maxLines: number, charBudget: number): string {
  const tail = text.length > charBudget ? text.slice(-charBudget) : text
  return tail.split("\n").slice(-maxLines).join("\n")
}
