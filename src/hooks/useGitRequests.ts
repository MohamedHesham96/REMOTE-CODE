import { useCallback, useState } from "react"
import type { Language } from "../i18n"
import type { GitChangeFile, GitChanges } from "../types"
import { commitPrompt, pullPrompt, pushPrompt, revertAllPrompt, revertFilePrompt } from "../utils/git-prompts"

export interface GitRequests {
  isOpen: boolean
  confirming: boolean
  confirmingCommit: boolean
  confirmingPush: boolean
  confirmingPull: boolean
  show: () => void
  close: () => void
  askRevertAll: () => void
  cancelRevertAll: () => void
  askCommit: () => void
  cancelCommit: () => void
  commit: () => Promise<void>
  askPush: () => void
  cancelPush: () => void
  push: () => Promise<void>
  askPull: () => void
  cancelPull: () => void
  pull: () => Promise<void>
  revertAll: () => Promise<void>
  revertFile: (file: GitChangeFile) => Promise<void>
}

// كل أزرار الـ git في الدرج بتبعت prompt للعميل (نفس نمط زرار commit & push).
// الـ commit والتراجع محتاجين ملفات متغيّرة فعلًا، لكن الـ push والـ pull
// بيزامنوا commits موجودة أو بعيدة فشغّالين على شجرة نضيفة — عشان كده
// الـ guard متقسّم اتنين بدل واحد مشترك.
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
  const [confirmingCommit, setConfirmingCommit] = useState(false)
  const [confirmingPush, setConfirmingPush] = useState(false)
  const [confirmingPull, setConfirmingPull] = useState(false)

  const close = useCallback(() => {
    setIsOpen(false)
    setConfirming(false)
    setConfirmingCommit(false)
    setConfirmingPush(false)
    setConfirmingPull(false)
  }, [])

  // نطلب من السطر الأول فيه تغييرات حقيقية، وإلا الطلب هيتنفّذ على مجلد نضيف
  const canRequest = useCallback(() => Boolean(changes?.available) && (changes?.files.length ?? 0) > 0 && !sending, [changes, sending])

  // الـ push والـ pull مزامنة مش تغيير — بيشتغلوا على شجرة نضيفة بعد الـ commit
  const canSync = useCallback(() => Boolean(changes?.available) && !sending, [changes, sending])

  const commit = useCallback(async () => {
    if (!changes || !canRequest()) {
      return
    }
    close()
    await send(commitPrompt(changes.files, changes.branch, lang))
  }, [canRequest, changes, lang, close, send])

  const push = useCallback(async () => {
    if (!changes || !canSync()) {
      return
    }
    close()
    await send(pushPrompt(changes.branch, lang))
  }, [canSync, changes, lang, close, send])

  const pull = useCallback(async () => {
    if (!changes || !canSync()) {
      return
    }
    close()
    await send(pullPrompt(changes.branch, lang))
  }, [canSync, changes, lang, close, send])

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
    setConfirmingCommit(false)
    setConfirmingPush(false)
    setConfirmingPull(false)
  }, [])

  // فتح dialog التأكيد هو نفسه action مدمّر — ميتفتحش لما مفيش ملفات.
  const askRevertAll = useCallback(() => {
    if (!canRequest()) {
      return
    }
    setConfirming(true)
  }, [canRequest])

  // الإلغاء بيسيب الدرج مفتوح — المستخدم لسه بيراجع الملفات قبل ما يقرر
  const cancelRevertAll = useCallback(() => setConfirming(false), [])

  // الـ commit بيبعت رسالة للعميل بس، فحالته منفصلة عن التراجع المدمّر —
  // كانوا بيشتركوا في نفس الـ flag فالضغط على واحد كان بيفتح الحوارين معًا.
  const askCommit = useCallback(() => {
    if (!canRequest()) {
      return
    }
    setConfirmingCommit(true)
  }, [canRequest])

  const cancelCommit = useCallback(() => setConfirmingCommit(false), [])

  // الـ push بيبعت commit حقيقي للفرع، فبيتأكد زي التراجع عن الكل تمامًا —
  // بس من غير شرط الملفات عشان الـ push بييجي بعد الـ commit على نضافة.
  const askPush = useCallback(() => {
    if (!canSync()) {
      return
    }
    setConfirmingPush(true)
  }, [canSync])

  const cancelPush = useCallback(() => setConfirmingPush(false), [])

  // الـ pull بيعدّل الملفات المحلية بالبعيد، فبيتأكد كمان — وبرضه من غير
  // شرط الملفات لنفس السبب.
  const askPull = useCallback(() => {
    if (!canSync()) {
      return
    }
    setConfirmingPull(true)
  }, [canSync])

  const cancelPull = useCallback(() => setConfirmingPull(false), [])

  return { isOpen, confirming, confirmingCommit, confirmingPush, confirmingPull, show, close, askRevertAll, cancelRevertAll, askCommit, cancelCommit, commit, askPush, cancelPush, push, askPull, cancelPull, pull, revertAll, revertFile }
}
