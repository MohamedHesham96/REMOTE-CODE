// أصوات تنبيه لطيفة ومميزة — بدون ملفات خارجية (Web Audio API)
// تعمل أوفلاين ومناسبة للموبايل.

let audioContext: AudioContext | null = null
let unlocked = false

const SOUND_KEY = "opencode-sound-enabled"

export function isSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_KEY)
    // مفعّل افتراضيًا
    return raw === null ? true : raw !== "0"
  } catch {
    return true
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "1" : "0")
  } catch {
    // تجاهل — التخزين غير متاح
  }
}

function getContext(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      return null
    }
    if (!audioContext) {
      audioContext = new Ctor()
    }
    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => undefined)
    }
    return audioContext
  } catch {
    return null
  }
}

// يجب استدعاؤها مع أول تفاعل من المستخدم (شرط المتصفحات لتشغيل الصوت)
export function unlockAudio(): void {
  if (unlocked) {
    const ctx = getContext()
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined)
    }
    return
  }
  unlocked = true
  getContext()
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
): void {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, startAt)
  // غلاف ناعم: صعود سريع ونزول تدريجي لطيف
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.03)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + duration + 0.05)
}

// صوت انتهاء المهمة: فانفار إنجاز قوي — سلم صاعد + لمعة ختامية (مثل Achievement Unlocked)
export function playCompletionSound(): boolean {
  if (!isSoundEnabled()) {
    return false
  }
  const ctx = getContext()
  if (!ctx) {
    return false
  }
  try {
    const now = ctx.currentTime + 0.02
    // C5 → E5 → G5 → C6: سلم كبير صاعد يدي إحساس الانتصار
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, index) => {
      playTone(ctx, freq, now + index * 0.12, 0.4, 0.2, "triangle")
      // لمعة أوكتاف خفيفة للقوة والوضوح
      playTone(ctx, freq * 2, now + index * 0.12, 0.3, 0.07, "sine")
    })
    // الضربة الختامية: نغمة عالية مطوّلة تثبت الإنجاز
    const finaleAt = now + notes.length * 0.12
    playTone(ctx, 1318.5, finaleAt, 0.8, 0.18, "triangle")
    playTone(ctx, 2637, finaleAt, 0.5, 0.05, "sine")
    return true
  } catch {
    return false
  }
}

// صوت مختلف للسؤال/الإذن: نغمتان للفت الانتباه
export function playAttentionSound(): boolean {
  if (!isSoundEnabled()) {
    return false
  }
  const ctx = getContext()
  if (!ctx) {
    return false
  }
  try {
    const now = ctx.currentTime + 0.02
    playTone(ctx, 880, now, 0.25, 0.18, "sine")
    playTone(ctx, 987.77, now + 0.18, 0.35, 0.18, "sine")
    return true
  } catch {
    return false
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate(pattern)
    }
  } catch {
    // غير مدعوم
  }
}
