import { useRef, useState } from "react"
import { rejectQuestion, replyQuestion } from "../../api"
import type { Strings } from "../../i18n"
import type { ConversationQuestionAnswers, ConversationQuestionRequest } from "../../types"

export function QuestionCard({ request, sessionId, onAnswered, t }: { request: ConversationQuestionRequest; sessionId: string; onAnswered: () => void; t: Strings }) {
  const [answers, setAnswers] = useState<ConversationQuestionAnswers>(() => request.questions.map(() => []))
  const [customDrafts, setCustomDrafts] = useState<string[]>(() => request.questions.map(() => ""))
  const [working, setWorking] = useState<"reply" | "reject" | null>(null)
  const workingRef = useRef(false)
  const [error, setError] = useState("")

  const toggleOption = (questionIndex: number, label: string) => {
    const multiple = request.questions[questionIndex]?.multiple
    setAnswers((current) => current.map((selected, index) => {
      if (index !== questionIndex) {
        return selected
      }
      if (!multiple) {
        return [label]
      }
      return selected.includes(label) ? selected.filter((value) => value !== label) : [...selected, label]
    }))
    if (!multiple) {
      setCustomDrafts((current) => current.map((draft, index) => index === questionIndex ? "" : draft))
    }
  }

  const updateCustomDraft = (questionIndex: number, value: string) => {
    setCustomDrafts((current) => current.map((draft, index) => index === questionIndex ? value : draft))
    if (!request.questions[questionIndex]?.multiple) {
      setAnswers((current) => current.map((selected, index) => index === questionIndex ? [] : selected))
    }
  }

  const payload = request.questions.map((question, index) => {
    const draft = customDrafts[index]?.trim() || ""
    if (question.multiple) {
      return [...new Set(draft && question.custom ? [...answers[index], draft] : answers[index])]
    }
    if (draft && question.custom) {
      return [draft]
    }
    return answers[index].slice(0, 1)
  })

  const canReply = request.questions.every((question, index) => {
    const draft = customDrafts[index]?.trim() || ""
    if (question.custom && draft) {
      return true
    }
    if (question.multiple) {
      return payload[index]?.length > 0
    }
    return payload[index]?.length === 1
  })

  const submitReply = async () => {
    if (!canReply || workingRef.current) {
      return
    }
    workingRef.current = true
    setWorking("reply")
    setError("")
    try {
      const result = await replyQuestion(sessionId, request.id, payload)
      if (!result.accepted) {
        throw new Error(t.replyFailed)
      }
      // الكارت اختفى وشايفه بعينك — من غير toast
      onAnswered()
    } catch (replyError: unknown) {
      setError(replyError instanceof Error ? replyError.message : t.replyFailed)
    } finally {
      workingRef.current = false
      setWorking(null)
    }
  }

  const submitReject = async () => {
    if (workingRef.current) {
      return
    }
    workingRef.current = true
    setWorking("reject")
    setError("")
    try {
      const result = await rejectQuestion(sessionId, request.id)
      if (!result.accepted) {
        throw new Error(t.rejectFailed)
      }
      // الكارت اختفى وشايفه بعينك — من غير toast
      onAnswered()
    } catch (rejectError: unknown) {
      setError(rejectError instanceof Error ? rejectError.message : t.rejectFailed)
    } finally {
      workingRef.current = false
      setWorking(null)
    }
  }

  return (
    <div className="question-card">
      <div className="question-card-top">
        <div><div className="eyebrow">{t.questionFromOpencode}</div><h3>{t.chooseBeforeContinue}</h3></div>
        <span className="question-count">{request.questions.length > 1 ? `${request.questions.length} ${t.questionsCount}` : t.oneQuestion}</span>
      </div>
      {request.questions.map((question, questionIndex) => (
        <div className="question-block" key={`${request.id}:${questionIndex}`}>
          <div className="question-header">{question.header}</div>
          <p className="question-text">{question.question}</p>
          {question.multiple ? <div className="question-hint">{t.multiChoiceHint}</div> : null}
          <div className="question-options">
            {question.options.map((option) => {
              const selected = answers[questionIndex]?.includes(option.label) || false
              return (
                <button
                  type="button"
                  className={`question-option${selected ? " selected" : ""}`}
                  disabled={Boolean(working)}
                  onClick={() => toggleOption(questionIndex, option.label)}
                  aria-pressed={selected}
                  key={`${request.id}:${questionIndex}:${option.label}`}
                >
                  <span className="question-option-check" aria-hidden>{question.multiple ? (selected ? "☑" : "☐") : selected ? "●" : "○"}</span>
                  <span className="question-option-body"><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
                </button>
              )
            })}
          </div>
          {question.custom ? (
            <label className="question-custom"><span>{t.customAnswer}</span><input value={customDrafts[questionIndex] || ""} onChange={(event) => updateCustomDraft(questionIndex, event.target.value)} placeholder={t.customAnswerPlaceholder} disabled={Boolean(working)} /></label>
          ) : null}
          {question.options.length === 0 && !question.custom ? <div className="empty-state">{t.noOptions}</div> : null}
        </div>
      ))}
      {error ? <div className="form-error">{error}</div> : null}
      <div className="question-actions">
        <button className="button button-primary" disabled={!canReply || Boolean(working)} onClick={() => void submitReply()}>{working === "reply" ? t.sending : t.sendChoice}</button>
        <button className="button button-ghost" disabled={Boolean(working)} onClick={() => void submitReject()}>{working === "reject" ? t.rejecting : t.rejectQuestion}</button>
      </div>
    </div>
  )
}
