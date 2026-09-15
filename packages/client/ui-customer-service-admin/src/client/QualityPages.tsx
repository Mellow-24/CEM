/** Real conversation inspection and the persisted quality task workbench. */
import { useCallback, useEffect, useState } from 'react'
import type { QualityInspection, QualityRun, QualityRunSummary, QualityDimension } from '@deepseek-ai/dsh-api-remotes/client'
import type { QualityPageProps, QualitySessionsProps } from './quality-contract.ts'
import { QualityDetail } from './QualityDetail.tsx'
import { QUALITY_LABELS, QUALITY_STATUS } from './quality-format.ts'
import css from './Operations.module.css'
import { operationsText } from './operations-copy.ts'

/** Inspect canonical conversations without switching the active customer session. */
export function QualitySessionsPage(props: QualitySessionsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const view = props.useStore(state => state)
  const sessions = props.useSessions(state => state)
  const [runs, setRuns] = useState<QualityRunSummary[]>([])
  const [inspection, setInspection] = useState<QualityInspection | null>(null)
  const [run, setRun] = useState<QualityRun | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const changed = useCallback(() => { void props.listQuality().then(setRuns).catch(() => { setError(operationsText(props.t, '質檢列表讀取失敗，請刷新重試。')) }) }, [props.listQuality, props.t])
  useEffect(() => {
    let cancelled = false
    void props.listQuality().then((rows) => { if (!cancelled) setRuns(rows) }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : text('質檢列表讀取失敗。'))
    })
    return () => { cancelled = true }
  }, [props.listQuality, reload])
  useEffect(() => {
    const lifecycle = new AbortController()
    setInspection(null); setRun(null); setError('')
    const sessionId = view.selectedSession
    if (sessionId === null) return
    setLoading(true)
    void (async () => {
      const prior = view.selectedRun ?? (await props.listQuality()).find(row => row.sessionId === sessionId)?.id
      const value = prior ? await props.getQuality(prior) : null
      const snapshot = view.selectedRun !== null && value !== null ? value.inspection : await props.inspectQuality(sessionId)
      if (!lifecycle.signal.aborted) { setInspection(snapshot); setRun(value) }
    })().catch((cause: unknown) => { if (!lifecycle.signal.aborted) setError(cause instanceof Error ? cause.message : text('會話讀取失敗。')) })
      .finally(() => { if (!lifecycle.signal.aborted) setLoading(false) })
    return () => { lifecycle.abort() }
  }, [view.selectedSession, view.selectedRun, props.inspectQuality, props.getQuality, props.listQuality, reload])
  const all = sessions.ids.flatMap(id => sessions.byId[id] ? [sessions.byId[id]] : [])
    .filter(session => !session.blank && session.origin !== 'subagent').sort((a, b) => b.updatedAt - a.updatedAt)
  const latest = (id: string) => runs.find(value => value.sessionId === id)
  const rows = all.filter((session) => {
    const result = latest(session.id)
    return `${session.displayTitle} ${session.id} ${result?.intent ?? ''}`.toLowerCase().includes(view.query.trim().toLowerCase())
      && (!view.preset || session.agentPreset === view.preset)
      && (!view.status || (view.status === 'unrated' ? !result : view.status === 'reviewed' ? result?.reviewed
        : view.status === 'critical' ? result?.critical : view.status === 'issue' ? result?.issue === 'open' : result?.status === view.status))
      && (!view.minScore || (result?.score !== null && result?.score !== undefined && result.score < Number(view.minScore)))
  })
  const pages = Math.max(1, Math.ceil(rows.length / 10)), page = Math.min(view.page, pages)
  return <div className={css.workspace} data-operations-page="sessions">
    {view.selectedSession === null ? <>
      <header className={css.sectionHeading}><div><span className={css.eyebrow}>{text(props.standalone ? '澳電智能客服 · 服務營運' : '深繹未來 · 服務營運')}</span><h2>{text('會話質量中心')}</h2>
        <p>{text('從真實對話定位問題，用原始執行記錄核驗每一項評分。')}</p></div>
      <button onClick={() => { setError(''); setReload(value => value + 1) }}>{text('刷新記錄')}</button></header>
      <div className={css.qualitySummary}>
        <div><small>{text('歷史會話')}</small><strong>{sessions.phase === 'ready' ? all.length : '—'}</strong></div>
        <div>
          <small>{text('已質檢會話')}</small>
          <strong>{new Set(runs.filter(item => item.status === 'completed').map(item => item.sessionId)).size}</strong>
        </div>
        <div><small>{text('待覆核任務')}</small><strong>{runs.filter(item => item.status === 'completed' && !item.reviewed).length}</strong></div>
        <div><small>{text('未關閉整改')}</small><strong>{runs.filter(item => item.issue === 'open').length}</strong></div>
      </div>
      <section className={css.card}><div className={css.filterBar}>
        <input type="search" aria-label={text('搜索歷史會話')} placeholder={text('搜索標題、編號或質檢意圖')} value={view.query}
          onChange={(event) => { props.actions.filter('query', event.target.value) }} />
        <select aria-label={text('預設篩選')} value={view.preset} onChange={(event) =>{  props.actions.filter('preset', event.target.value) }}>
          <option value="">{text('全部預設')}</option>{[...new Set(all.flatMap(item => item.agentPreset ? [item.agentPreset] : []))].map(value => <option key={value}>{value}</option>)}
        </select>
        <select aria-label={text('質檢狀態篩選')} value={view.status} onChange={(event) =>{  props.actions.filter('status', event.target.value) }}>
          <option value="">{text('全部狀態')}</option><option value="unrated">{text('未質檢')}</option><option value="running">{text('評估中')}</option>
          <option value="completed">{text('已完成')}</option><option value="failed">{text('失敗待重試')}</option><option value="reviewed">{text('已覆核')}</option>
          <option value="critical">{text('高風險')}</option><option value="issue">{text('整改中')}</option>
        </select>
        <select aria-label={text('質檢分數篩選')} value={view.minScore} onChange={(event) =>{  props.actions.filter('minScore', event.target.value) }}>
          <option value="">{text('全部分數')}</option>
          <option value="60">{text('低於 60 分')}</option>
          <option value="80">{text('低於 80 分')}</option>
          <option value="90">{text('低於 90 分')}</option>
        </select>
        <button onClick={() => { props.actions.clear() }}>{text('清空篩選')}</button>
      </div>
      {sessions.phase === 'pending' && <p role="status">{text('正在加載會話…')}</p>}
      <div className={css.tableWrap}><table><thead><tr><th>{text('會話 / 時間')}</th><th>{text('意圖與預設')}</th><th>{text('自動評分')}</th><th>{text('狀態')}</th><th>{text('操作')}</th></tr></thead>
        <tbody>{rows.slice((page - 1) * 10, page * 10).map((session) => {
          const summary = latest(session.id)
          return <tr key={session.id}>
            <td>
              <strong>{session.displayTitle}</strong>
              <small>{new Date(session.updatedAt).toLocaleString()}</small>
            </td>
            <td>{summary?.intent || text('待分析')}<small>{session.agentPreset ?? text('未記錄預設')}</small></td>
            <td>{summary?.score ?? '—'}{summary?.score !== null && summary?.score !== undefined && ' / 100'}
              {summary && <small>{text('覆蓋')} {summary.coverage}%{summary.reviewedScore !== null && ` · ${text('人工')} ${summary.reviewedScore}`}</small>}</td>
            <td>
              <span className={css.badge}>{text(session.running ? '會話進行中' : summary ? summary.reviewed ? '已覆核' : QUALITY_STATUS[summary.status] : '未質檢')}</span>
              {summary?.critical && <small>{text('高風險')}</small>}</td>
            <td><button disabled={session.running} onClick={() => { props.actions.select(session.id) }}>{text('查看詳情')}</button></td></tr>
        })}</tbody></table></div>
      {!rows.length && sessions.phase === 'ready' && <div className={css.empty}>{text('暫無符合條件的會話。')}</div>}
      <nav className={css.pagination}><small>{text('共')} {rows.length} {text('條')} · {text('第')} {page} / {pages}</small><div className={css.actions}>
        <button disabled={page === 1} onClick={() =>{  props.actions.page(page - 1) }}>{text('上一頁')}</button>
        <button disabled={page === pages} onClick={() =>{  props.actions.page(page + 1) }}>{text('下一頁')}</button></div></nav>
      </section>
    </> : <>
      {loading && <p role="status">{text('正在讀取完整會話與工具記錄…')}</p>}
      {inspection && <QualityDetail {...props} key={`${inspection.sessionId}:${view.selectedRun ?? ''}:${reload}`} inspection={inspection}
        initialRun={run} history={runs} onChanged={changed} />}
      {!inspection && !loading && <button onClick={() =>{  props.actions.select(null) }}>{text('返回會話列表')}</button>}
    </>}
    {error && <div role="alert" className={css.banner}>{error}<button onClick={() => { setReload(value => value + 1) }}>{text('重試讀取')}</button></div>}
    <p className={css.sourceLabel}>{text('歷史快照只讀；查看與質檢不切換正在使用的客服會話。未採集的渠道、錄音和語音版本不推斷補齊。')}</p>
  </div>
}

/** Quality jobs, unresolved findings, and versioned scoring weights. */
export function QualityQueuePage(props: QualityPageProps) {
  const text = (source: string) => operationsText(props.t, source)
  const view = props.useStore(state => state)
  const [rows, setRows] = useState<QualityRunSummary[]>([])
  const [tab, setTab] = useState('質檢任務')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    void props.listQuality().then((result) => { if (!cancelled) setRows(result) })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : text('質檢記錄加載失敗。')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [props.listQuality, reload])
  const filtered = tab === '待覆核與整改' ? rows.filter(row => row.status === 'completed' && (!row.reviewed || row.issue === 'open')) : rows
  const sum = Object.values(view.weights).reduce((a, b) => a + b, 0)
  return <div className={css.workspace} data-operations-page="evaluation">
    <header className={css.sectionHeading}><div><span className={css.eyebrow}>{text('質量營運 · 證據可追溯')}</span><h2>{text('會話質檢工作台')}</h2>
      <p>{text('自動評分、人工覆核與整改記錄分別保留。歷史質檢不會修改原始對話。')}</p></div>
    <button onClick={() => { setReload(value => value + 1) }}>{text('刷新質檢任務')}</button></header>
    <div className={css.tabs}>{['質檢任務', '待覆核與整改', '評分規則'].map(value => <button key={value} aria-pressed={tab === value}
      onClick={() => { setTab(value) }}>{text(value)}</button>)}</div>
    {error && <div role="alert" className={css.banner}>{error}</div>}
    {tab === '評分規則' ? <section className={css.card}><h3>{text('六維評分權重')}</h3>
      <p>{text(
        '規則 quality-v2。調整只影響下一次檢查，每次任務保存完整權重，不會覆蓋歷史評分。',
      )}</p>
      <div className={css.ruleGrid}>{(Object.keys(QUALITY_LABELS) as QualityDimension[]).map(key =>
        <label key={key}>{text(QUALITY_LABELS[key])}
          <input type="number" min={0} max={100}
            aria-label={`${text(QUALITY_LABELS[key])} ${text('權重')}`} value={view.weights[key]}
            onChange={(event) => { props.actions.weight(key, Number(event.target.value)) }} />
        </label>)}</div>
      <p role="status">{text('權重合計：')} {sum}%{sum !== 100 && text('，必須為 100% 才能開始質檢。')}</p>
      <p>{text('不適用維度不計入總分。缺少應有證據時顯示覆蓋率並暫不生成總分。高風險問題獨立標記，不能用平均分抵消。')}</p>
      <p>{text('執行效率使用事件計時規則；其他維度為模型建議，人工覆核後保留獨立記錄。未採集的語音指標不參與評分。')}</p>
    </section> : <section className={css.card}>
      {loading && <p role="status">{text('正在加載質檢任務…')}</p>}
      <div className={css.tableWrap}><table><thead><tr><th>{text('會話 / 評估時間')}</th><th>{text('自動評分')}</th><th>{text('覆核 / 整改')}</th><th>{text('操作')}</th></tr></thead>
        <tbody>{filtered.map(row => <tr key={row.id}>
          <td>
            <strong>{row.title}</strong>
            <small>{new Date(row.createdAt).toLocaleString()} · {text(QUALITY_STATUS[row.status])}</small>
          </td>
          <td>{row.score ?? '—'}<small>{text('證據覆蓋')} {row.coverage}%{row.critical && ` · ${text('高風險')}`}</small></td>
          <td>{text(row.reviewed ? '已覆核' : '待覆核')}<small>{text({ none: '未建立整改', open: '整改中', resolved: '已驗收' }[row.issue])}</small></td>
          <td>
            <button onClick={() => { props.actions.select(row.sessionId, row.id); props.navigate?.('customer-service-sessions') }}>{text('查看評分與證據')}</button>
          </td>
        </tr>)}</tbody></table></div>
      {!filtered.length && !loading && <div className={css.empty}>{text('暫無質檢任務。')}<button onClick={() => {
        props.actions.select(null); props.navigate?.('customer-service-sessions')
      }}>{text('選擇會話開始質檢')}</button></div>}
    </section>}
  </div>
}
