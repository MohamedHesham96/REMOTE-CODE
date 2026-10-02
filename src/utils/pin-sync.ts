// حفظ التعديلات المحلية ضد بثّ السيرفر: لو فيه طلب في الطريق، البثّ الجديد
// بيتأجّر لحد ما الطلب يخلص (عشان ما نكتبش فوق تعديل لسه ما اتأكّدش)، وبعدها
// أحدث قائمة هي اللي تتطبّق. ده اللي بيخلّي الجهاز التاني يزامن من غير poll
// وبلا ما نخسر أي من النُسختين في أي ترتيب.
interface PinSyncGate {
  // عدّاد طلب اتبعت للسيرفر — البثّ يستنّي لحد ما كلهم يخلصوا
  start: () => void
  // طلب خلص: بيرجّع آخر بثّ مستني (أحدث صورة من السيرفر) أو null
  settle: () => unknown[] | null
  // بثّ جديد: بيرجّع القائمة لو ينفع تتطبّق دلوقتي، أو null لو اتأجّلت
  broadcast: (list: unknown[]) => unknown[] | null
  isPending: () => boolean
}

export function createPinSyncGate(): PinSyncGate {
  let pending = 0
  let buffered: unknown[] | null = null
  return {
    start: () => {
      pending += 1
    },
    settle: () => {
      pending = Math.max(0, pending - 1)
      if (pending > 0) {
        return null
      }
      const list = buffered
      buffered = null
      return list
    },
    broadcast: (list) => {
      if (pending > 0) {
        buffered = list
        return null
      }
      return list
    },
    isPending: () => pending > 0,
  }
}
