/** A pinned conversation, evidence-linked scores, and append-only human review. */
import { useEffect, useState } from 'react'
import type { QualityInspection, QualityRun, QualityReviewRequest, QualityRunSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type { QualitySessionsProps } from './quality-contract.ts'
import { QUALITY_LABELS, QUALITY_STATUS, qualityTotals } from './quality-format.ts'
import css from './Operations.module.css'
import { operationsText } from './operations-copy.ts'

/** Render one independent session inspection; all evaluation evidence comes from its saved snapshot. */
export function QualityDetail(props: QualitySessionsProps & {
  inspection: QualityInspection
  initialRun: QualityRun | null
  history: QualityRunSummary[]
  onChanged: () => void
}) {
  const text = (source: string) => operationsText(props.t, source)
  const view = props.useStore(state => state)
  const [run, setRun] = useState(props.initialRun)
  const [tab, setTab] = useState('對話與評分')
  const [turn, setTurn] = useState('')
  const [focus, setFocus] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [manualScore, setManualScore] = useState('')
  const inspection = run?.inspection ?? props.inspection
  const totals = run ? qualityTotals(run) : null
  const humanConfirmed = run?.reviews.some(item => item.action === 'review') === true
  const weightSum = Object.values(view.weights).reduce((a, b) => a + b, 0)
  const selectedUnfinished = turn ? props.inspection.unfinishedTurns.includes(Number(turn)) : false
  const completedTurns = props.inspection.turns.filter(value => !props.inspection.unfinishedTurns.includes(value))
  const records = inspection.records.filter(record => !turn || record.turn === Number(turn))
  const selected = records.find(record => record.seq === focus || record.endSeq === focus)
  useEffect(() => {
    if (run?.status !== 'running') return
    let cancelled = false
    const timer = setTimeout(() => {
      void props.getQuality(run.id).then((value) => {
        if (!cancelled) { setRun(value); if (value.status !== 'running') props.onChanged() }
      }).catch(() => { if (!cancelled) setError(text('狀態讀取失敗，請點擊刷新質檢結果。')) })
    }, 2000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [run, props.getQuality, props.onChanged])
  const perform = async (operation: () => Promise<QualityRun>) => {
    setBusy(true); setError('')
    try { setRun(await operation()); props.onChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : text('操作失敗，請重試。')) }
    finally { setBusy(false) }
  }
  const evaluate = () => perform(() => props.startQuality({ sessionId: props.inspection.sessionId,
    expectedFingerprint: props.inspection.fingerprint, ...(turn ? { turn: Number(turn) } : {}), weights: view.weights }))
  const review = (action: QualityReviewRequest['action']) => {
    if (!run) return
    void perform(() => props.reviewQuality({ id: run.id, expectedRevision: run.revision, action, reason,
      ...(action === 'review' && manualScore !== '' ? { score: Number(manualScore) } : {}) }))
  }
  const jump = (seq: number) => { setFocus(seq); setTab('執行過程') }
  const issueAction = run?.reviews.filter(item => item.action !== 'review').at(-1)?.action
  return <>
    <header className={css.sectionHeading}>
      <div><span className={css.eyebrow}>{text('會話詳情')} · {inspection.preset}</span><h2>{inspection.title}</h2>
        <small>{inspection.sessionId} · {inspection.turns.length} {text('個輪次')} · {text('快照截至事件')} #{inspection.throughSeq}</small>
      </div>
      <button onClick={() =>{  props.actions.select(null) }}>{text('返回會話列表')}</button>
    </header>
    <div className={css.qualitySummary}>
      <div><small>{text('自動質檢總分')}</small><strong>{totals?.score ?? '—'}<small> / 100</small></strong></div>
      <div><small>{text('證據覆蓋')}</small><strong>{totals ? `${totals.coverage}%` : text('待檢查')}</strong></div>
      <div><small>{text('質檢狀態')}</small><strong>{text(humanConfirmed ? '已人工確認' : run ? QUALITY_STATUS[run.status] : '未質檢')}</strong></div>
      <div><small>{text('安全關注')}</small><strong>{text(totals?.critical ? '高風險 · 必須覆核' : run?.status === 'completed' ? '查看分項結論' : '待評估')}</strong></div>
    </div>
    {run && <p className={css.sourceLabel}>{text('規則')} {run.ruleVersion} · {props.standalone ? '' : `${text('評估模型')} ${run.model} · `}{new Date(run.createdAt).toLocaleString()}.
      {run.selectedTurn === null ? text('完整會話檢查') : `${text('輪')} ${run.selectedTurn}`}.
      {run.inspection.fingerprint !== props.inspection.fingerprint && ` ${text('原會話已有更新，當前展示歷史質檢快照。')}`}
    </p>}
    <div className={css.filterBar}>
      <select aria-label={text('查看或檢查輪次')} value={turn} disabled={busy || run?.status === 'running'} onChange={(event) => { setTurn(event.target.value); setFocus(null) }}>
        <option value="">{text('全部已結束輪次')}</option>{inspection.turns.map(value => <option key={value} value={value}>{text('輪')} {value}</option>)}
      </select>
      <button className={css.primary} disabled={busy || run?.status === 'running' || weightSum !== 100
        || selectedUnfinished || completedTurns.length === 0}
      onClick={() => { void evaluate() }}>{text(run?.status === 'running' ? '正在質檢…' : run ? '重新質檢' : '開始質檢')}</button>
      {run && <button disabled={busy} onClick={() => { void perform(() => props.getQuality(run.id)) }}>{text('刷新質檢結果')}</button>}
      <small>{text('重新質檢會創建新記錄，不重跑原業務工具。')}</small>
    </div>
    {props.inspection.unfinishedTurns.length > 0
      && <p role="status">{text('未結束輪次仍可查看，但自動質檢會跳過；也可以選擇任一已結束輪次單獨質檢。')}</p>}
    {error && <div role="alert" className={css.banner}>{error}</div>}
    {run?.error && <div role="alert" className={css.banner}>{run.error}</div>}
    <div className={css.tabs} role="group" aria-label={text('會話詳情視圖')}>
      {['對話與評分', '執行過程', '檢索依據', '質檢與覆核記錄'].map(value => <button key={value} aria-pressed={tab === value}
        onClick={() => { setTab(value) }}>{text(value)}</button>)}
    </div>
    {tab === '對話與評分' && <div className={css.qualityColumns}>
      <section className={css.card}><h3>{text('原始對話')}</h3>
        {records.filter(record => record.kind === 'user' || (record.kind === 'assistant' && record.output)).map(record =>
          <div key={record.seq} className={css.bubble} data-role={record.kind === 'user' ? '客戶' : '客服'}>
            <small>{text('輪')} {record.turn} · {text(record.kind === 'user' ? '客戶' : '客服')} · #{record.seq}</small>
            <p>{record.kind === 'user' ? record.input : record.output}</p>
            <button onClick={() => { jump(record.seq) }}>{text('查看對應過程')}</button>
          </div>)}
      </section>
      <section className={css.card} data-quality-scores><h3>{text('六維質量評分')}</h3>
        {!run?.result.length && <div className={css.empty}>{text('開始質檢後顯示逐輪評分、扣分原因及證據。')}</div>}
        {run?.result.filter(result => !turn || result.turn === Number(turn)).map(result => <div key={result.turn}>
          <h4>{text('輪')} {result.turn} · {result.intent}</h4><small>{text('意圖為質檢事後分析')}</small>
          {result.scores.map(score => <article key={score.dimension} className={css.scoreItem} data-risk={score.severity}>
            <div className={css.sectionHeading}><strong>{text(QUALITY_LABELS[score.dimension])}</strong>
              <span className={css.badge}>{score.status === 'scored' ? `${score.score} ${text('分')}` : text(score.status === 'not-applicable' ? '不適用' : '證據不足')}</span>
            </div>
            <p>{score.reason}</p>{score.suggestion && <small>{text('建議：')} {score.suggestion}</small>}
            <div className={css.actions}>{score.evidenceSeqs.map(seq => (
              <button key={seq} onClick={() => { jump(seq) }}>{text('證據')} #{seq}</button>
            ))}</div>
          </article>)}
        </div>)}
        <p className={css.sourceLabel}>{text('語音專項：錄音、STT準確率、播報中斷和字幕對齊未採集，不參與評分。')}</p>
      </section>
    </div>}
    {tab === '執行過程' && <section className={css.card}>
      <div className={css.sectionHeading}><h3>{text('執行軌跡')}</h3><span className={css.badge}>{text('歷史事件 · 只讀')}</span></div>
      {selected && <p role="status">{text('已定位證據')} #{focus}: {selected.name} · {text('輪')} {selected.turn}
        {selected.durationMs !== null && ` · ${text('耗時')} ${selected.durationMs}ms`}
        {selected.firstTokenMs !== null && ` · ${text('首 token')} ${selected.firstTokenMs}ms`}</p>}
      <div className={css.tracePanel}>{props.renderSlot('operations.trace', { records, selectedSeq: focus, onSelect: setFocus })}</div>
    </section>}
    {tab === '檢索依據' && <section className={css.card}><h3>{text('當時的檢索依據')}</h3>
      <p>{text('展示記錄中的知識檢索工具輸入和返回。排序分數不等於準確率；沒有人工標註時不計算 Precision / Recall。')}</p>
      {records.filter(record => record.kind === 'tool' && /knowledge|wiki|search|retriev/iu.test(record.name)).map(record =>
        <article className={css.scoreItem} key={record.seq}>
          <div className={css.sectionHeading}>
            <strong>{record.name} · {text('輪')} {record.turn}</strong>
            <button onClick={() => { jump(record.seq) }}>{text('定位軌跡')} #{record.seq}</button></div>
          <h4>{text('查詢參數')}</h4><pre className={css.evidenceText}>{record.input}</pre>
          <h4>{text('已記錄返回')}</h4><pre className={css.evidenceText}>{record.output || text('未記錄返回結果')}</pre>
        </article>)}
      {!records.some(record => record.kind === 'tool' && /knowledge|wiki|search|retriev/iu.test(record.name))
        && <div className={css.empty}>{text('當前範圍沒有知識檢索工具記錄，無法展示歷史命中片段。')}</div>}
    </section>}
    {tab === '質檢與覆核記錄' && <section className={css.card}><h3>{text('人工覆核與整改')}</h3>
      <p>{text('保留自動結果。覆核和整改動作均需填寫依據；此處為本機操作記錄，不代表已接入人員身份認證。')}</p>
      {run?.status === 'completed' && <>
        <label>{text('覆核或驗收依據')}<textarea aria-label={text('覆核或驗收依據')} value={reason} onChange={(event) => { setReason(event.target.value) }} /></label>
        <label>{text('人工總分（留空保留自動結果）')}<input type="number" aria-label={text('人工總分')} min={0} max={100} value={manualScore}
          onChange={(event) => { setManualScore(event.target.value) }} /></label>
        <div className={css.actions}>
          <button disabled={busy || !reason.trim()} onClick={() => { review('review') }}>{text('確認並保存人工評分')}</button>
          <button disabled={busy || !reason.trim()} onClick={() => { review(!issueAction ? 'open-issue'
            : issueAction === 'resolve-issue' ? 'reopen-issue' : 'resolve-issue') }}>
            {text(!issueAction ? '建立整改' : issueAction === 'resolve-issue' ? '重新打開整改' : '完成整改驗收')}</button>
        </div>
        {run.reviews.map((item, index) => <div key={index} className={css.scoreItem}>
          <strong>{text({ review: '人工覆核', 'open-issue': '建立整改', 'resolve-issue': '整改驗收', 'reopen-issue': '重新打開' }[item.action])}</strong>
          <small> · {new Date(item.time).toLocaleString()}{item.score !== null && ` · ${text('人工分數')} ${item.score}`}</small><p>{item.reason}</p>
        </div>)}
      </>}
      <h3>{text('歷史質檢版本')}</h3>
      {props.history.filter(item => item.sessionId === inspection.sessionId).map(item => <div className={css.row} key={item.id}>
        <span>{new Date(item.createdAt).toLocaleString()} · {text(QUALITY_STATUS[item.status])} · {item.score ?? '—'} {text('分')}</span>
        <button disabled={busy} onClick={() => { void perform(() => props.getQuality(item.id)) }}>{text('查看該次結果')}</button>
      </div>)}
      <details className={css.explanation}><summary>{text('本次權重與範圍')}</summary><pre>{JSON.stringify(run ? {
        ruleVersion: run.ruleVersion, weights: run.weights, throughSeq: run.inspection.throughSeq, fingerprint: run.inspection.fingerprint,
      } : view.weights, null, 2)}</pre></details>
    </section>}
  </>
}
