import { useCallback, useEffect, useRef, type RefObject } from "react"
import { nextScrollPinState, type ScrollPinState } from "../utils/scroll-pin"

// قائمة العناصر اللي بتنزل لآخرها بالترتيب: الأول هو الأساسي (كارت المهام
// نفسه) وباقيهم بيتبعتوا بيه نفس النزول (حاوية الشغل بتسكرول بس لما تكون
// فيه بطاقات أسئلة تحت الكارت).
export type ScrollTargets = RefObject<HTMLElement | null>[]

export interface ScrollToBottom {
  // ثبّت على آخر المحتوى لحد ما الطول يستقر. onSettled بيتنادى مرتين على الأكثر:
  // لما المحتوى يستقر، أو لما المستخدم يمسك السكول — في الحالتين التثبيت خلص.
  pinToBottom: (onSettled?: () => void) => void
  // اتبع الجديد بس لو المستخدم قريب من الأسفل أصلًا — ما نزعجش اللي بيقرا قديم
  followBottom: () => void
  // المستخدم مسك السكول بإيده — وقف أي تثبيت جاري
  release: () => void
}

// تحت السطر ده (بالبكسل) بنعتبر المستخدم "قريب من الأسفل"
const NEAR_BOTTOM_PX = 100

function scrollToBottom(element: HTMLElement): void {
  // نزول فوري (auto) مش smooth: ده تثبيت لفتح محادثة، والأنيميشن بيخلّي
  // المشهد يبدأ من فوق ويتحرّك بعدين
  element.scrollTo({ top: element.scrollHeight, behavior: "auto" })
}

// القياس = مجموع ارتفاعات العناصر. لو الأساسي لسه مش متركّب بنطلع NaN
// (طول غير معروف) فالتثبيت ما بيستقرش قبل ما العنصر يجي.
function measure(targets: ScrollTargets): number {
  if (!targets[0]?.current) {
    return Number.NaN
  }
  let total = 0
  for (const target of targets) {
    total += target.current?.scrollHeight ?? 0
  }
  return total
}

function scrollAllToBottom(targets: ScrollTargets): void {
  for (const target of targets) {
    const element = target.current
    if (element) {
      scrollToBottom(element)
    }
  }
}

export function useScrollToBottom(targets: ScrollTargets): ScrollToBottom {
  // أحدث قائمة عناصر بعد كل رندر (الـ caller بيعمل مصفوفة جديدة كل مرة).
  // التحديث في effect مش أثناء الرندر: الـ ref مش بيانات رسم، والحلقة
  // بتقراه جوه requestAnimationFrame.
  const targetsRef = useRef<ScrollTargets>(targets)
  useEffect(() => {
    targetsRef.current = targets
  }, [targets])
  const frameRef = useRef<number | null>(null)
  const onSettledRef = useRef<(() => void) | null>(null)
  // إنهاء التثبيت: يا إما المحتوى استقر يا إما المستخدم مسك السكول — في
  // الحالتين مبنتسناش نزّل تاني على نفس المحتوى.
  const finish = useCallback(() => {
    const onSettled = onSettledRef.current
    onSettledRef.current = null
    onSettled?.()
  }, [])
  const release = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    finish()
  }, [finish])
  const followBottom = useCallback(() => {
    for (const target of targetsRef.current) {
      const element = target.current
      if (!element) {
        continue
      }
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      if (distance < NEAR_BOTTOM_PX) {
        scrollToBottom(element)
      }
    }
  }, [])
  const pinToBottom = useCallback((onSettled?: () => void) => {
    release()
    onSettledRef.current = onSettled ?? null
    let state: ScrollPinState | null = null
    const tick = () => {
      state = nextScrollPinState(state, measure(targetsRef.current))
      if (state === null) {
        frameRef.current = null
        finish()
        return
      }
      scrollAllToBottom(targetsRef.current)
      frameRef.current = window.requestAnimationFrame(tick)
    }
    frameRef.current = window.requestAnimationFrame(tick)
  }, [finish, release])
  // الحلقة لازم تموت مع الكومبوننت — غير كده بتكمل تنزل على عنصر مفصول
  useEffect(() => release, [release])
  return { pinToBottom, followBottom, release }
}
