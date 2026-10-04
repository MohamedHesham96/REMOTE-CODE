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

// نغمة بنقرة: بتبدأ أعلى من النغمة الهدف وتهبط ليها بسرعة، فتبان "بوب/طرقعة"
// في أولها بدل نغمة مسطّحة تبدأ وتقف فجأة. ده اللي يدي الطابع الشبيه بصوت
// Slack مع إن الإحساس يفضل مبهج.
function playPop(ctx: AudioContext, frequency: number, startAt: number, duration: number, volume: number): void {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = "sine"
  oscillator.frequency.setValueAtTime(frequency * 1.9, startAt)
  oscillator.frequency.exponentialRampToValueAtTime(frequency, startAt + 0.05)
  // غلاف سريع: صعود في أجزاء من الألف ثم نزول ناعم — الطرقعة في الهجوم والدفء في الذيل
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + duration + 0.05)
}

// طرقعة خشبية: انفجار ضوضاء قصير عبر مرشّح تمرير-عالٍ، بيتحطّ مع البوب في
// أول كل نغمة. البافر متخزّن لكل معدّل عيّنات عشان ما يتولّدش من جديد كل نداء.
let noiseCache: AudioBuffer | null = null
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) {
    return noiseCache
  }
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.08))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    // تضاؤل أسّي حاد: أعلى العيّنات في الأول، فالصوت نقرة مش ضجيج ثابت
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 4)
  }
  noiseCache = buffer
  return buffer
}

function playKnock(ctx: AudioContext, startAt: number, volume: number): void {
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = "highpass"
  filter.frequency.setValueAtTime(2200, startAt)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(volume, startAt)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.06)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  source.start(startAt)
  source.stop(startAt + 0.09)
}

// صوت انتهاء المهمة: ثلاثة نغمات صاعدة (دو → مي → صول) بطرقعة على أول كل
// نغمة — تتابع نغمي قصير مبهج، أوضح وأميز من النغمتين المسطّحتين السابقتين
// ومن غير فانفار طويل يشد الانتباه.
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
    const notes = [1046.5, 1318.5, 1568]
    notes.forEach((freq, index) => {
      const at = now + index * 0.11
      playKnock(ctx, at, index === 0 ? 0.18 : 0.1)
      playPop(ctx, freq, at, index === notes.length - 1 ? 0.5 : 0.3, 0.16)
    })
    return true
  } catch {
    return false
  }
}

// صوت السؤال/الإذن: طرقتان منخفضتان على نفس النغمة ("خبطة خبطة") — إيقاع
// مختلف عن صعود الإنجاز عشان المستخدم يفرّق الحدثين من غير ما يبص، والطرقعة
// هي اللي بتخليه مميز.
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
    playKnock(ctx, now, 0.18)
    playPop(ctx, 659.25, now, 0.2, 0.16)
    playKnock(ctx, now + 0.18, 0.15)
    playPop(ctx, 659.25, now + 0.18, 0.3, 0.16)
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
