// سجل ملكية الميكروفون على مستوى الوحدة: المتصفح بيسمح بجلسة تعرّف صوت واحدة
// نشطة، وفيه تلات مستهلكين بيقتسموه — الإملاء في الكومبوزر، أوامر لوحة
// التحكم الصوتي، ومستمع كلمة التنبيه. كل مستهلك بيسجّل ملكيته قبل start
// وبيفرج عنها عند onend، والمستمعون بيتنبّهوا بالتغيير: اللي مش صاحب الملكية
// يوقف جلسته، واللي مستني يقيّم من جديد لما تتحرر. السجل توصيفي فقط — مش
// بيتدخّل في المتصفح، بس بيمنع الجلستين إنهم يتخبطوا في بعض.
export type MicToken = symbol

let owner: MicToken | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function currentMicOwner(): MicToken | null {
  return owner
}

// الاستحواذ بيسبق start دايمًا عشان الجلسة القديمة تاخد إشارة الوقوف قبل ما
// الجديدة تفتح — لو المتصفح ألغى القديمة بنفسه فالبلاغ متأخر وغير مضمون.
export function acquireMic(token: MicToken): void {
  if (owner === token) {
    return
  }
  owner = token
  notify()
}

// الإفراج محروس بالتوكن: مستهلك قديم بيسلّم بعد ما ملكية حد تاني تكون بدأت
// مايقدرش يفلت الميكروفون من إيد صاحبه الجديد.
export function releaseMic(token: MicToken): void {
  if (owner !== token) {
    return
  }
  owner = null
  notify()
}

export function subscribeMic(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
