// تثبيت عنصر التمرير على آخر المحتوى لحد ما المحتوى يستقر. فتح محادثة
// معناها إن المحتوى لسه بيجي: الطلبات وبطاقات الأسئلة بيوصلوا على دفعات من
// السيرفر بعد ما العنصر يركّب، والصف الأخير (المفتوح) بياخد وقت قبل ما ياخد
// ارتفاعه النهائي. نزول واحد في إطار واحد بيقف قبل ما المحتوى يوصل —
// فبنقيس الارتفاع كل إطار ونكمّل لحد ما يثبت.
//
// الطول غير المعروف (NaN) بيقول "العنصر لسه مش متركّب": NaN مش بيساوي
// نفسه ولا حاجة، فالحالة مش بتستقر خالص والميزانية بتوقفها في الآخر.
export interface ScrollPinState {
  // عدد الإطارات اللي الطول فيها ما اتغيّرش
  stableFrames: number
  // آخر طول قِسناه
  lastHeight: number
  // إطارات مرّت من بداية التثبيت
  frames: number
}

// ٦ إطارات (نحو ١٠٠ ملّي ثانية) من الثبات = المحتوى خلص. ٩٠ إطار (نحو ١٫٥
// ثانية) سقف صريح: محتوى مش هيوصل خالص ما نفضلش نطارد للأبد.
export const SCROLL_PIN_STABLE_FRAMES = 6
export const SCROLL_PIN_MAX_FRAMES = 90

// الحالة الجاية بعد ما نقيس الطول ده، أو null لما التثبيت يخلص (استقر
// المحتوى أو خلصت الميزانية).
export function nextScrollPinState(previous: ScrollPinState | null, height: number): ScrollPinState | null {
  const frames = (previous?.frames ?? 0) + 1
  if (frames >= SCROLL_PIN_MAX_FRAMES) {
    return null
  }
  const stableFrames = previous && height === previous.lastHeight ? previous.stableFrames + 1 : 0
  if (stableFrames >= SCROLL_PIN_STABLE_FRAMES) {
    return null
  }
  return { stableFrames, lastHeight: height, frames }
}
