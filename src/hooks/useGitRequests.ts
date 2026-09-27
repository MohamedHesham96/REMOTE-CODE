import { useCallback, useState } from "react"
import type { Language } from "../i18n"
import type { GitChangeFile, GitChanges } from "../types"
import { commitPushPrompt, revertAllPrompt, revertFilePrompt } from "../utils/git-prompts"

export interface GitRequests {
  isOpen: boolean
  confirming: boolean
  show: () => void
  close: () => void
  askRevertAll: () => void
  cancelRevertAll: () => void
  commitPush: () => Promise<void>
  revertAll: () => Promise<void>
  revertFile: (file: GitChangeFile) => Promise<void>
}

// كل أزرار الـ git في الدرج بتبعت prompt للعميل (نفس نمط زرار commit & push)،
// فبنت guard واحد مشترك: لازم المشروع يكون git وفيه ملفات ومفيش طلب شغال.
// الدالة المشتركة بتقفل الدرج كمان — الطلب بيفتح محادثة جديدة، والدرج تاني
// وراه مش هيفيد. التراجع عن الكل محتاج خطوة تأكيد منفصلة عشان مدمّر.
export function useGitRequests(
  changes: GitChanges | null,
  sending: boolean,
  lang: Language,
  send: (prompt: string) => Promise<void>,
): GitRequests {
  const [isOpen, setIsOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const close = useCallback(() => {
    setIsOpen(false)
    setConfirming(false)
  }, [])

  // نطلب من السطر الأول فيه تغييرات حقيقية، وإلا الطلب هيتنفّذ على مجلد نضيف
  const canRequest = useCallback(() => Boolean(changes?.available) && (changes?.files.length ?? 0) > 0 && !sending, [changes, sending])

  const commitPush = useCallback(async () => {
    if (!changes || !canRequest()) {
      return
    }
    close()
    await send(commitPushPrompt(changes.files, changes.branch, lang))
  }, [canRequest, changes, lang, close, send])

  const revertAll = useCallback(async () => {
    if (!changes || !canRequest()) {
      return
    }
    close()
    await send(revertAllPrompt(changes.files, lang))
  }, [canRequest, changes, lang, close, send])

  const revertFile = useCallback(async (file: GitChangeFile) => {
    if (!canRequest()) {
      return
    }
    close()
    await send(revertFilePrompt(file, lang))
  }, [canRequest, lang, close, send])

  const show = useCallback(() => {
    setIsOpen(true)
    setConfirming(false)
  }, [])

  const askRevertAll = useCallback(() => setConfirming(true), [])

  // الإلغاء بيسيب الدرج مفتوح — المستخدم لسه بيراجع الملفات قبل ما يقرر
  const cancelRevertAll = useCallback(() => setConfirming(false), [])

  return { isOpen, confirming, show, close, askRevertAll, cancelRevertAll, commitPush, revertAll, revertFile }
}
