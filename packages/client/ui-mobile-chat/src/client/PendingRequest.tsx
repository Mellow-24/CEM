/** Mobile replies to host-owned requests; permissions remain explicit and are never auto-granted. */
import { useRef, useState } from 'react'
import type { ClientResponse } from '@deepseek-ai/dsh-api-remotes/client'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import css from './MobileChat.module.css'

interface Props {
  wait: PendingInteraction
  respond(this: void, result: ClientResponse['result']): Promise<void>
}

/** Collect each question separately; administrative approvals remain in the full permission viewer. */
export function PendingRequest({ wait, respond }: Props) {
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; custom: string }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitted = useRef(false)
  const send = async (result: ClientResponse['result']): Promise<void> => {
    if (submitted.current) return
    submitted.current = true; setBusy(true); setError('')
    try { await respond(result) }
    catch (reason) { submitted.current = false; setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <section className={css.pending} aria-label="待處理請求">
    <strong>{wait.kind === 'approval' ? '此操作需要您的授權' : '助手需要補充資料'}</strong>
    {wait.kind === 'approval' ? <>
      <p>涉及系統操作，請在完整權限頁面查看詳情後決定。您也可以在此拒絕。</p>
      <a href="/" target="_blank" rel="noreferrer">開啟原系統確認詳情</a>
      <button disabled={busy} onClick={() => { void send({ ok: true, value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome: 'rejected' } }) }}>拒絕此操作</button>
    </> : <form onSubmit={(event) => {
      event.preventDefault()
      void send({ ok: true, value: { sessionId: wait.sessionId, answer: { answers: wait.payload.questions.map((question) => {
        const answer = answers[question.id] ?? { selected: [], custom: '' }
        const custom = answer.custom.trim()
        return { id: question.id, selected: custom && question.multiSelect !== true ? [] : answer.selected, ...(custom ? { custom } : {}) }
      }) } } })
    }}>
      {wait.payload.questions.map((question) => {
        const answer = answers[question.id] ?? { selected: [], custom: '' }
        return <fieldset key={question.id} disabled={busy}>
          <legend>{question.question}</legend>
          {question.detail && <p>{question.detail}</p>}
          {question.options?.map(option => <label key={option.label}>
            <input type={question.multiSelect ? 'checkbox' : 'radio'} name={question.id} checked={answer.selected.includes(option.label)} onChange={() => { setAnswers(previous => ({ ...previous, [question.id]: { custom: '', selected: question.multiSelect ? answer.selected.includes(option.label) ? answer.selected.filter(value => value !== option.label) : [...answer.selected, option.label] : [option.label] } })) }} />
            <span>{option.label}{option.description && <small>{option.description}</small>}</span>
          </label>)}
          <input aria-label={question.question} placeholder="輸入補充內容" value={answer.custom} onChange={(event) => { const custom = event.target.value; setAnswers(previous => ({ ...previous, [question.id]: { ...answer, custom } })) }} />
        </fieldset>
      })}
      <button type="submit" disabled={busy || wait.payload.questions.some((question) => { const answer = answers[question.id]; return !answer || (!answer.custom.trim() && answer.selected.length === 0) })}>提交回覆</button>
      <button type="button" disabled={busy} onClick={() => { void send({ ok: false, error: { code: 'cancelled', message: 'User cancelled the question', details: {} } }) }}>取消此請求</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>
}
