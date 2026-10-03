import { useCallback, useMemo, useState } from "react"
import type { ActiveSession } from "../types"
import { useNowTick } from "./useNowTick"

interface ActivitySeenEntry {
  at: number
  item: ActiveSession
}

// ذاكرة نشاط قائمة "المحادثات النشطة": آخر لحظة ظهرت فيها كل محادثة وآخر بيانات معروفة عنها.
// لازم تكون في App مش في اللوحة نفسها، عشان لما تفتح اللوحة تلاقي اللي اشتغل من شوية لسه معروض.
export function useActivityGrace(items: ActiveSession[], graceMs: number, ticking: boolean) {
  const [seen, setSeen] = useState<Record<string, ActivitySeenEntry>>({})
  const live = useMemo(() => new Set(items.map((item) => item.id)), [items])

  // بيتنادى مع كل poll للنشاط: نعرف آخر بيانات كل محادثة، ونسيب اللي خرج من القائمة
  // لسه في مهلة الـ ٥ دقايق، ونضف اللي عدّت مهلته.
  const track = useCallback((next: ActiveSession[], stamp: number) => {
    setSeen((current) => {
      const result: Record<string, ActivitySeenEntry> = {}
      const nextIds = new Set<string>()
      for (const item of next) {
        nextIds.add(item.id)
        result[item.id] = { at: stamp, item }
      }
      for (const [id, entry] of Object.entries(current)) {
        if (nextIds.has(id) || stamp - entry.at >= graceMs) {
          continue
        }
        result[id] = entry
      }
      return result
    })
  }, [graceMs])

  const pending = useMemo(() => Object.keys(seen).some((id) => !live.has(id)), [seen, live])
  // العدّاد بيوقف لو اللوحة مقفولة — نضف القديم مع كل poll وحنا كده
  const nowTick = useNowTick(pending && ticking)

  // قائمة "آخر ٥ دقايق" مرتّبة بالأحدث: كانت بتتعمل sort كامل كل ثانية
  // لأن `nowTick` ضمن deps. الحل: نجمّد بيانات "اللي خرج من live" كقاعدة،
  // ونطبّق فلتر الوقت في `useMemo` تاني مفصول. الـ baseSorted بيتعمل
  // فقط عند تغيير `seen` أو `live`، والـ recent النهائي بيتعمل عند تغيّر
  // الـ base أو `graceMs` — `nowTick` يحدّث graceLeft فقط.
  const baseSorted = useMemo(() => Object.values(seen)
    .filter((entry) => !live.has(entry.item.id))
    .map((entry) => entry.item)
    .sort((left, right) => right.updatedAt - left.updatedAt), [seen, live])
  // تطبيق نافذة الـ ٥ دقايق: يتمدّد مع `nowTick` لكن الـ baseSorted
  // ما بيتعاد رسمه. ده بيقلل الـ O(n log n) مرة واحدة لكل تغيّر في الـ
  // activity (مش كل ثانية).
  const recent = useMemo(() => {
    const cutoff = nowTick - graceMs
    return baseSorted.filter((item) => {
      const at = seen[item.id]?.at ?? 0
      return at > cutoff
    })
  }, [baseSorted, nowTick, graceMs, seen])

  const graceLeft = useCallback((id: string) => {
    const entry = seen[id]
    if (entry === undefined || live.has(id)) {
      return 0
    }
    return graceMs - (nowTick - entry.at)
  }, [seen, live, nowTick, graceMs])

  return { track, recent, graceLeft }
}
