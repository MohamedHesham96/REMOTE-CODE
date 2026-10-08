import type { SessionMessageAssistant } from "@opencode/client"
import type { RequestUsage, SessionUsage, TokenUsage } from "./types.js"

// أي عنصر فيه بيانات استخدام: رسالة assistant من المحرك. الحقول اختيارية
// لأن المحرك لا يرفق أرقام الرموز/التكلفة إلا لما المزوّد يرجّعها فعلًا.
interface UsageEntry {
  id: string
  tokens?: SessionMessageAssistant["tokens"]
  cost?: SessionMessageAssistant["cost"]
}

// طابق واحد كما تحتاجه مدة الجلسة؛ الشكل مطابق لـ RequestTurn في opencode.ts
// بدون استيراد داخلي (الدالة نفسها ما لها علاقة بالمحرك).
export interface UsageTurn {
  createdAt: number
  updatedAt: number
  completedAt: number
  entries: SessionMessageAssistant[]
}

// تجميع استهلاك مجموعة ردود. التكرار يُزال بالـ id: نفس الرسالة قد تصل أكثر
// من مرة عبر إعادة الاتصال أو استئناف القراءة، واحتسابها مرتين يعطي أرقامًا
// مضخّمة. المجموع يستخدم معادلة OpenCode الرسمية للرموز: الإدخال + الإخراج +
// التفكير + قراءة الكاش + كتابة الكاش.
export function sumUsage(entries: Iterable<UsageEntry>): RequestUsage {
  const seen = new Set<string>()
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let tokenEntries = 0
  let costEntries = 0
  let cost = 0

  for (const entry of entries) {
    if (entry.id) {
      if (seen.has(entry.id)) {
        continue
      }
      seen.add(entry.id)
    }
    if (entry.tokens) {
      tokenEntries += 1
      input += entry.tokens.input
      output += entry.tokens.output
      reasoning += entry.tokens.reasoning
      cacheRead += entry.tokens.cache.read
      cacheWrite += entry.tokens.cache.write
    }
    if (typeof entry.cost === "number" && Number.isFinite(entry.cost)) {
      costEntries += 1
      cost += entry.cost
    }
  }

  const tokens: TokenUsage | null = tokenEntries > 0
    ? {
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      total: input + output + reasoning + cacheRead + cacheWrite,
    }
    : null
  // التكلفة لا تُعرض إلا إذا كانت كل نداءات الرموز لها تكلفة مسجّلة كذلك؛
  // مجموع ناقص يظهر كرقم أقل من الحقيقة — والأمانة تقتضي "غير متاح" بدلًا منه.
  const reliableCost = costEntries > 0 && costEntries >= tokenEntries ? cost : null
  return { tokens, cost: reliableCost }
}

// ملخص الجلسة: مجموع كل الردود (بإزالة التكرار على مستوى الجلسة أيضًا) مع
// عدد الطلبات ومدة العمل. المدة مجموع مدد الطلبات الفعلية لا الفارق بين أول
// وآخر رسالة، حتى لا تحسب فترات الخمول الطويلة بين الطلبات.
export function sessionUsage(turns: UsageTurn[]): SessionUsage {
  const all: UsageEntry[] = []
  let durationMs = 0
  for (const turn of turns) {
    for (const entry of turn.entries) {
      all.push(entry)
    }
    const end = turn.completedAt > 0 ? turn.completedAt : turn.updatedAt
    durationMs += Math.max(0, end - turn.createdAt)
  }
  const base = sumUsage(all)
  return { tokens: base.tokens, cost: base.cost, requests: turns.length, durationMs }
}
