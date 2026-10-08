import type { Strings } from "../i18n"

interface VoiceFabProps {
  t: Strings
  onOpen: () => void
}

// زر التحكم الصوتي العايم: كان في الترويسة واتنقل لنص الشاشة فوق شريط الكتابة
// عشان الإبهام يوصله من غير ما يمتد لفوق، ويفضل في نفس المكان على كل الشاشات.
// الأيقونة فقاعة كلام جوّاها مايك عشان تعبّر إن الكلام موجّه للمشروع نفسه،
// مش مجرد تفريغ صوتي. وبيحمل [data-voice-trigger] اللي لوحة التحكم بتستخدمه
// لترجيع التركيز له عند الإغلاق.
export function VoiceFab({ t, onOpen }: VoiceFabProps) {
  return (
    <button type="button" className="voice-fab" onClick={onOpen} aria-label={t.voiceControl} title={t.voiceControlOpen} data-voice-trigger>
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden focusable="false" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h12a3 3 0 0 1 3 3v7.5a3 3 0 0 1-3 3h-6.6l-3.9 3.6V16.5H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" />
        <rect x="10.5" y="6" width="3" height="5" rx="1.5" />
        <path d="M15.2 10.2v.5a3.2 3.2 0 0 1-6.4 0v-.5" />
      </svg>
    </button>
  )
}
