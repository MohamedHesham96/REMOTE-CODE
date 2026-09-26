import { useCallback, useEffect, useMemo, useState } from "react"
import { forgetSessionIds, loadPinnedSessions, pinSessionId, savePinnedSessions, unpinSessionId } from "../utils/storage"

interface PinnedSessions {
  // ترتيب "الأحدث تثبيتًا أولًا" — نفس الترتيب اللي بيتخزّن وبتعرضه لوحة المثبّتات
  ids: string[]
  isPinned: (sessionId: string) => boolean
  togglePin: (sessionId: string) => void
  // للحذف: ينضّف التثبيت من الـ state والـ storage في خطوة واحدة
  forgetPinned: (sessionIds: string[]) => void
}

// حالة التثبيت مصدرها الوحيد هو React state، والـ localStorage مجرد تخزين
// مستمر: بنقرا مرة واحدة عند التركيب (زي اللغة والثيمة) وبنكتب عند كل تغيير
// بس. القراءة من الـ storage أثناء الـ render كانت بتخلي قائمة الجلسات
// تعتمد على localStorage مباشرة وتحتاج re-render وهمية بعد كل نقرة.
export function usePinnedSessions(): PinnedSessions {
  const [ids, setIds] = useState<string[]>(loadPinnedSessions)

  useEffect(() => {
    savePinnedSessions(ids)
  }, [ids])

  const pinnedSet = useMemo(() => new Set(ids), [ids])

  const isPinned = useCallback((sessionId: string) => pinnedSet.has(sessionId), [pinnedSet])

  const togglePin = useCallback((sessionId: string) => {
    setIds((current) => (current.includes(sessionId)
      ? unpinSessionId(current, sessionId)
      : pinSessionId(current, sessionId)))
  }, [])

  const forgetPinned = useCallback((sessionIds: string[]) => {
    setIds((current) => forgetSessionIds(current, sessionIds))
  }, [])

  return { ids, isPinned, togglePin, forgetPinned }
}
