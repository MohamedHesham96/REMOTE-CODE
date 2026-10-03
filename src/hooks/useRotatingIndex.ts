import { useEffect, useState } from "react"

// فهرس عنصر واحد من قائمة طولها متغيّر، بيتقلّب بمرور الوقت.
//
// سبب وجوده: "قائمة المستخدم" في واجهة الديسكتوب (الأدوات اللي المهمة
// استعملتها) طويلة على شاشة موبايل، فبنعرض عنصر واحد كل مرة وبنلف على
// القائمة. أول ما توصل أداة جديدة بنقفز لها فورًا لأنها الأهم للمستخدم،
// وبعدها التقليب يكمل عادي. طول صفر = مفيش مؤقت أصلًا.
export function useRotatingIndex(length: number, intervalMs: number): number {
  const [index, setIndex] = useState(0)

  // عنصر جديد اتضاف = اقفز للأحدث مكان (آخر القائمة).
  useEffect(() => {
    setIndex(Math.max(0, length - 1))
  }, [length])

  useEffect(() => {
    if (length <= 1) {
      return
    }
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % length), intervalMs)
    return () => window.clearInterval(timer)
  }, [length, intervalMs])

  return index
}
