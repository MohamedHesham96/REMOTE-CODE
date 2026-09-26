import { useEffect, useState } from "react"

// عدّاد محلي كل ثانية عشان وقت المهمة يمشي حتى لو الـ poll اتأخر
// أو التبويب اتخنق (throttle).
export function useNowTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}
