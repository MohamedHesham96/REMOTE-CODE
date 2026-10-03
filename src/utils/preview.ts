// آخر جزء من نص طويل: آخر maxLines سطر في حدود ميزانية الأحرف، محسوبين من
// نهاية النص. بنستخدمه في "النتيجة النهائية" عشان الكارت المطوي يفتح على آخر
// ما كتبه OpenCode (الخلاصة) بدل أول الرد، من غير ما المستخدم يدوس "عرض كامل".
export function tailPreview(text: string, maxLines: number, charBudget: number): string {
  const tail = text.length > charBudget ? text.slice(-charBudget) : text
  return tail.split("\n").slice(-maxLines).join("\n")
}
