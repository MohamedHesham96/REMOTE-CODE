import { useState, type ReactElement } from "react"
import { QuestionCard } from "./QuestionCard"
import type { Strings } from "../../i18n"
import type { ConversationQuestionRequest } from "../../types"

interface StickyQuestionsProps {
  questions: ConversationQuestionRequest[]
  sessionId: string
  onAnswered: () => void
  t: Strings
}

// الغلاف اللاصق قابل للطيّ: السؤال الجديد يظهر مفتوحًا بكل بروزه، ولو
// المستخدم رجع يقرأ رسائل قديمة يقدر يصغّره لشريط رفيع بدل ما يفضل
// مغطي المحادثة وهو طالع نازل. سؤال جديد (ids مختلفة) يفتحه تلقائيًا
// لأن الانتباه للجديد أهم من حالة الطيّ القديمة.
export function StickyQuestions({ questions, sessionId, onAnswered, t }: StickyQuestionsProps): ReactElement | null {
  const [collapsed, setCollapsed] = useState(false)
  const idsKey = questions.map((question) => question.id).join(",")
  const [prevKey, setPrevKey] = useState(idsKey)
  if (prevKey !== idsKey) {
    setPrevKey(idsKey)
    setCollapsed(false)
  }
  if (questions.length === 0) {
    return null
  }
  const countLabel = questions.length > 1 ? `${questions.length} ${t.questionsCount}` : t.oneQuestion
  if (collapsed) {
    return (
      <div className="questions-sticky">
        <button type="button" className="questions-minibar" onClick={() => setCollapsed(false)} aria-expanded={false}>
          <span aria-hidden>❓</span>
          <strong>{t.questionFromOpencode}</strong>
          <span className="question-count">{countLabel}</span>
          <span className="questions-expand-hint">{t.expandQuestion} ▴</span>
        </button>
      </div>
    )
  }
  return (
    <div className="questions-sticky">
      <button type="button" className="questions-collapse" onClick={() => setCollapsed(true)} aria-expanded={true}>
        {t.minimizeQuestion} ▾
      </button>
      {questions.map((question) => (
        <QuestionCard key={question.id} request={question} sessionId={sessionId} onAnswered={onAnswered} t={t} />
      ))}
    </div>
  )
}
