/** Rehearsal-only answer drafts and an explicit text-document processing walkthrough. */
import { useState } from 'react'
import type { OperationsProps } from './operations-contract.ts'
import { ANSWERS } from './demo-data.ts'
import { selectedEntry } from './demo-data.ts'
import css from './Operations.module.css'
import { operationsText } from './operations-copy.ts'

const STAGES = ['待處理', '解析預覽', '知識切片', '檢索驗證', '審核確認', '完成審核']

/** Render A/B/C answer previews and isolated document processing without publishing knowledge. */
export function KnowledgeWorkbench(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const [tab, setTab] = useState('知識加工')
  const [answerClass, setAnswerClass] = useState('A')
  const [body, setBody] = useState(selectedEntry(draft.answers['A']))
  const query = draft.documentQuery
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const approved = draft.documentApproved
  const matching = draft.chunks.filter(chunk => chunk.toLowerCase().includes(query.trim().toLowerCase()))
  return <>
    <div
      className={css.tabs}>
      {['知識加工', '回答策略 A / B / C'].map(value =>
        <button
          key={value}
          aria-pressed={tab === value}
          onClick={() => { setTab(value) }}>
          {text(value)}
        </button>)}
    </div>
    {tab === '知識加工' ? <>
      <section
        className={css.card}>
        <div
          className={css.sectionHeading}>
          <div>
            <h2>{text('知識文檔加工區')}
            </h2>
            <p>{text('與真實知識庫隔離。文件在瀏覽器內處理，尚未上傳服務器。')}
            </p>
          </div>
          <span
            className={css.badge}>
            {text(STAGES[draft.documentStep] ?? '')}
          </span>
        </div>
        <ol
          className={css.pipeline}>
          {STAGES.map((stage, index) =>
            <li
              key={stage}
              data-done={index <= draft.documentStep}>
              <span>
                {index + 1}
              </span>
              {text(stage)}
            </li>)}
        </ol>
        <div
          className={css.columns}>
          <div
            className={css.form}>
            <label>{text('選擇文本文件')}
              <input
                type="file"
                accept=".txt,.md"
                disabled={loading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  if (!/\.(txt|md)$/iu.test(file.name) || file.size > 256 * 1024) { props.actions.notify(text('加工區僅接受 256 KB 以內的 TXT / Markdown。')); return }
                  setLoading(true)
                  void file.text().then((content) => { props.actions.setDocument(file.name, content); setSearched(false) }, () => { props.actions.notify(text('文件讀取失敗，請重新選擇。')) }).finally(() => { setLoading(false) })
                }} />
            </label>
            <strong>
              {draft.documentName}
            </strong>
            <label>{text('原文 / 解析預覽')}
              <textarea
                aria-label={text('文檔內容')}
                maxLength={262144}
                value={draft.documentText}
                onChange={(event) => {
                  props.actions.setDocument(draft.documentName, event.target.value)
                  setSearched(false)
                }} />
            </label>
            <small>{text('支持 TXT / Markdown，最大 256 KB。PDF、Word 與 OCR 解析暫未接入。')}
            </small>
          </div>
          <div>
            <h3>{text('切片預覽')}
            </h3>
            {draft.chunks.length ? draft.chunks.map((chunk, index) =>
              <label
                className={css.chunk}
                key={index}>{text('切片')}
                {index + 1} · {text('工作區知識')}
                <textarea
                  aria-label={`${text('切片')} ${index + 1}`}
                  value={chunk}
                  onChange={(event) => { props.actions.editChunk(index, event.target.value); setSearched(false) }} />
              </label>) :
              <div
                className={css.empty}>{text('完成解析後生成切片。按空行分段，可手動編輯。')}
              </div>}
          </div>
        </div>
        {draft.documentStep >= 2 &&
<div
  className={css.searchBench}>
  <h3>{text('切片檢索驗證')}
  </h3>
  <p>{text('僅在當前切片中執行文本包含匹配，不調用向量模型。')}
  </p>
  <form
    className={css.actions}
    onSubmit={(event) => { event.preventDefault(); props.actions.verifyDocument(); setSearched(true) }}>
    <input
      required
      aria-label={text('檢索驗證問題')}
      value={query}
      onChange={(event) => { props.actions.setDocumentQuery(event.target.value); setSearched(false) }} />
    <button>{text('檢索切片')}
    </button>
  </form>
  {searched &&
<div
  className={css.bubble}>
  {matching.length ? matching.map((chunk, index) =>
    <p
      key={index}>
      {chunk}
    </p>) : text('未命中：請調整問題或補充知識。')}
</div>}
</div>}
        {draft.documentStep === 4 &&
<label
  className={css.check}>
  <input
    type="checkbox"
    checked={approved}
    onChange={(event) => { props.actions.approveDocument(event.target.checked) }} />{text('我已核對切片與原文，確認完成工作區審核。')}
</label>}
        <div
          className={css.actions}>
          <button
            className={css.primary}
            disabled={loading || draft.documentStep === 5
                || (draft.documentStep === 2 && !draft.documentVerified)
                || (draft.documentStep === 4 && !approved)}
            onClick={() => { props.actions.advanceDocument() }}>
            {text(['開始解析預覽', '生成知識切片', '確認檢索結果', '提交審核', '完成審核', '審核已完成'][draft.documentStep] ?? '')}
          </button>
          <span>{text('任何步驟都不會改變真實 RAG 或知識導航內容。')}
          </span>
        </div>
      </section>
    </> : <>
      <div
        className={css.grid3}>
        {ANSWERS.map(answer =>
          <button
            className={css.answerCard}
            key={answer.id}
            aria-pressed={answerClass === answer.id}
            onClick={() => { setAnswerClass(answer.id); setBody(selectedEntry(draft.answers[answer.id])) }}>
            <span
              className={css.answerLetter}>
              {answer.id}
            </span>
            <h2>
              {text(answer.name)}
            </h2>
            <p>
              {text(answer.rule)}
            </p>
          </button>)}
      </div>
      <section
        className={css.card}>
        <div
          className={css.columns}>
          <form
            className={css.form}
            onSubmit={(event) => { event.preventDefault(); props.actions.saveAnswer(answerClass, body) }}>
            <h2>
              {text(selectedEntry(ANSWERS.find(answer => answer.id === answerClass)).title)}
            </h2>
            <label>{text('回答內容 / 策略')}
              <textarea
                required
                maxLength={4000}
                value={body}
                onChange={(event) => { setBody(event.target.value) }} />
            </label>
            <button
              className={css.primary}>{text('保存回答草稿')}
            </button>
          </form>
          <div
            className={css.preview}>
            <h3>{text('電話播報文本預覽')}
            </h3>
            <div
              className={css.bubble}>
              {answerClass === 'B' ? body.replaceAll('{{amount}}', '328.50').replaceAll('{{date}}', text('9 月 30 日')) : answerClass === 'C' ? text('C 類在“運行數據”中測試真實檢索；此處僅編輯回答約束，不生成模型回覆。') : body}
            </div>
            <p>
              {text(answerClass === 'B' ? '測試賬單字段 · 非真實客戶信息' : answerClass === 'A' ? '標準話術原文預覽 · 不經過模型改寫' : '客戶回答不包含來源編號；後臺檢索證據仍然保留。')}
            </p>
          </div>
        </div>
      </section></>}
  </>
}
