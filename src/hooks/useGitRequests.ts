import { useCallback, useState } from "react"
import type { Language } from "../i18n"
import type { GitChangeFile, GitChanges } from "../types"
import { commitPrompt, commitPushPrompt, pullPrompt, pushPrompt, revertAllPrompt, revertFilePrompt } from "../utils/git-prompts"

interface GitRequests {
  isOpen: boolean
  confirming: boolean
  confirmingPush: boolean
  show: () => void
  close: () => void
  askRevertAll: () => void
  cancelRevertAll: () => void
  askCommitPush: () => void
  cancelCommitPush: () => void
  commitPush: () => Promise<void>
  commit: () => Promise<void>
  pull: () => Promise<void>
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
  const [confirmingPush, setConfirmingPush] = useState(false)

  const close = useCallback(() => {
    setIsOpen(false)
    setConfirming(false)
    setConfirmingPush(false)
  }, [])

  // نطلب من السطر الأول فيه تغييرات حقيقية، وإلا الطلب هيتنفّذ على مجلد نضيف
  const canRequest = useCallback(() => Boolean(changes?.available) && (changes?.files.length ?? 0) > 0 && !sending, [changes, sending])

  // زرار commit & push استثناء عن قاعدة "لازم فيه تغييرات": شجرة نضيفة
  // فيها commits محلية لسه ما اترفعتش هي الحالة الطبيعية بعد شغل سابق،
  // والـ push هو الحاجة الوحيدة المطلوبة. باقي الأزرار (commit/تراجع)
  // لسه محتاجة تغييرات فعلية لأن أثرها محلي.
  const canPush = useCallback(() => Boolean(changes?.available) && ((changes?.files.length ?? 0) > 0 || (changes?.unpushed ?? 0) > 0) && !sending, [changes, sending])

  // السحب هو الاستثناء عن قاعدة "لازم فيه تغييرات": جلب التحديثات الجديدة
  // بيحصل على مجلد نضيف، وهو أكتر حالة بيستعملها المستخدم فيها الزر ده.
  const canPull = useCallback(() => Boolean(changes?.available) && !sending, [changes, sending])

  const commitPush = useCallback(async () => {
    if (!changes || !canPush()) {
      return
    }
    close()
    // شجرة نضيفة + commits مستنية: مفيش حاجة تتعملها commit، فالطلب
    // بيقتصر على الـ push عشان الوكيل مايدوّرش على شغل مش موجود.
    await send(changes.files.length > 0
      ? commitPushPrompt(changes.files, changes.branch, lang)
      : pushPrompt(changes.branch, lang))
  }, [canPush, changes, lang, close, send])

  const commit = useCallback(async () => {
    if (!changes || !canRequest()) {
      return
    }
    close()
    await send(commitPrompt(changes.files, changes.branch, lang))
  }, [canRequest, changes, lang, close, send])

  const pull = useCallback(async () => {
    if (!changes || !canPull()) {
      return
    }
    close()
    await send(pullPrompt(changes.branch, lang))
  }, [canPull, changes, lang, close, send])

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
    setConfirmingPush(false)
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

  // الـ push بيعدّل الفرع البعيد، فبيتأكد زي التراجع عن الكل تمامًا.
  const askCommitPush = useCallback(() => {
    if (!canPush()) {
      return
    }
    setConfirmingPush(true)
  }, [canPush])

  const cancelCommitPush = useCallback(() => setConfirmingPush(false), [])

  return { isOpen, confirming, confirmingPush, show, close, askRevertAll, cancelRevertAll, askCommitPush, cancelCommitPush, commitPush, commit, pull, revertAll, revertFile }
}
