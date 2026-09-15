/** In-console history and the isolated pronunciation quality workflow. */
import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { OperationsProps, ConversationReadout } from './operations-contract.ts'
import { DEMO_SESSIONS, selectedEntry } from './demo-data.ts'
import css from './Operations.module.css'
import { operationsText } from './operations-copy.ts'

/** Show paged validation records and explicitly loaded runtime history as separate sources. */
export function SessionWorkbench(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const sessions = props.useSessions(state => state)
  const [source, setSource] = useState('服務記錄')
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState('全部渠道')
  const [status, setStatus] = useState('全部狀態')
  const [answerClass, setAnswerClass] = useState('全部策略')
  const [page, setPage] = useState(1)
  const [realId, setRealId] = useState<SessionId | null>(null)
  const [readout, setReadout] = useState<ConversationReadout | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [timelineStep, setTimelineStep] = useState(0)
  const selected = selectedEntry(DEMO_SESSIONS.find(session => session.id === draft.selectedSession))
  const statusOf = (id: string, result: string) => id === 'CS-001' && draft.issueClosed ? '覆核完成' : result
  const search = query.trim().toLowerCase()
  const rows = DEMO_SESSIONS.filter(session =>
    (channel === '全部渠道' || channel === session.channel)
    && (status === '全部狀態' || status === statusOf(session.id, session.result))
    && (answerClass === '全部策略' || answerClass === session.answerClass)
    && `${session.id} ${session.title} ${session.query}`.toLowerCase().includes(search))
  const pages = Math.max(1, Math.ceil(rows.length / 8))
  const currentPage = Math.min(page, pages)
  const pageRows = rows.slice((currentPage - 1) * 8, currentPage * 8)
  const realRows = sessions.ids.map(id => selectedEntry(sessions.byId[id]))
    .filter(session => !session.blank && session.origin !== 'subagent'
      && `${session.displayTitle} ${session.id}`.toLowerCase().includes(search))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const load = async (id: SessionId, older = false) => {
    setRealId(id); setLoading(true); setError(false)
    if (!older) setReadout(null)
    try {
      const result = await props.readConversation(id, older ? readout?.beforeSeq : undefined)
      setReadout(older && readout ? { ...result, messages: [...result.messages, ...readout.messages] } : result)
    } catch { setError(true) }
    finally { setLoading(false) }
  }
  const stages: [string, string][] = [
    ['客戶進入', `${text(selected.channel)} · ${text(selected.language)} · ${text('測試賬戶')}`],
    ['識別與路由', `${text('意圖：')} ${text(selected.title)}; ${text('回答策略：')} ${selected.answerClass}`],
    ['流程處理', `${text(selected.flowId === 'billing' ? '賬單查詢' : '知識問答')} · v1`],
    ['知識與業務依據', selected.evidence],
    ['回答與語音', '客戶側輸出不包含證據編號；發音詞典待接入語音服務。'],
    ['服務結果', statusOf(selected.id, selected.result)],
  ]
  const clearFilters = () => {
    setQuery(''); setChannel('全部渠道'); setStatus('全部狀態'); setAnswerClass('全部策略'); setPage(1)
  }
  return (
    <>
      <div className={css.sourceBar}>
        <div className={css.tabs} role="group" aria-label={text('會話數據來源')}>
          {['服務記錄', '歷史會話'].map(value => (
            <button key={value} aria-pressed={source === value} onClick={() => { setSource(value); clearFilters() }}>
              {text(value)}
            </button>
          ))}
        </div>
        <span className={css.sourceLabel}>{text(source === '歷史會話' ? '已接入服務' : '驗證集')}</span>
      </div>
      <section className={css.card}>
        <div className={css.sectionHeading}>
          <div><h2>{text(source)}</h2>
            <p>{text(source === '歷史會話' ? '按最近更新時間排序，保留原始對話記錄。' : '按渠道、回答策略和處理狀態快速定位服務記錄。')}</p>
          </div>
          <input type="search" aria-label={text('搜索服務會話')}
            placeholder={text(source === '歷史會話' ? '搜索會話標題或編號' : '搜索標題、問題或編號')}
            value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
        </div>
        {source === '歷史會話' ? (
          <div className={css.historyLayout}>
            <div className={css.sessionList}>
              {sessions.phase === 'pending' && <p>{text('正在加載會話…')}</p>}
              {sessions.phase === 'ready' && !realRows.length && <div className={css.empty}>{text('暫無符合條件的會話。')}</div>}
              {realRows.map(session => (
                <button disabled={loading} key={session.id} className={css.listItem}
                  aria-pressed={realId === session.id} onClick={() => { void load(session.id) }}>
                  <strong>{session.displayTitle}</strong>
                  <small>{text(session.running ? '處理中' : '歷史會話')} · {new Date(session.updatedAt).toLocaleDateString()}</small>
                </button>
              ))}
            </div>
            <div className={css.inspector} aria-busy={loading}>
              <div className={css.sectionHeading}><h3>{text('會話詳情')}</h3>
                {readout && <span className={css.badge}>{readout.messages.length} {text('條消息')}</span>}
              </div>
              {loading && <p>{text('讀取中…')}</p>}
              {error && <div role="alert">{text('會話讀取失敗。')}
                <button disabled={loading} onClick={() => { if (realId) void load(realId) }}>{text('重試讀取')}</button>
              </div>}
              {!realId && <div className={css.empty}>{text('選擇一條會話，查看客戶問題與客服回覆。')}</div>}
              {readout && <>
                <div className={css.actions}>
                  <button disabled={loading} onClick={() => { if (realId) void load(realId) }}>{text('刷新快照')}</button>
                  {readout.hasMore && (
                    <button disabled={loading} onClick={() => { if (realId) void load(realId, true) }}>{text('加載更早記錄')}</button>
                  )}
                </div>
                {!readout.messages.length && <p>{text('當前窗口沒有客戶消息或客服回覆。')}</p>}
                <div className={css.transcript} role="log" aria-label={text('歷史對話')}>
                  {readout.messages.map(message => (
                    <div className={css.bubble} key={message.seq} data-role={message.role}>
                      <small>{text(message.role)} · {new Date(message.time).toLocaleString()}</small><p>{message.text}</p>
                    </div>
                  ))}
                </div>
                <small>{text('記錄快照 · 渠道、語言和語音版本未採集。')}</small>
              </>}
            </div>
          </div>
        ) : <>
          <div className={css.filterBar}>
            <select aria-label={text('會話渠道')} value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1) }}>
              {['全部渠道', '電話', 'Web', 'App'].map(value => <option key={value} value={value}>{text(value)}</option>)}
            </select>
            <select aria-label={text('處理狀態')} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
              {['全部狀態', '待覆核', '已解決', '覆核完成'].map(value => <option key={value} value={value}>{text(value)}</option>)}
            </select>
            <select aria-label={text('回答策略篩選')} value={answerClass} onChange={(event) => { setAnswerClass(event.target.value); setPage(1) }}>
              <option>{text('全部策略')}</option>{['A', 'B', 'C'].map(value => <option key={value} value={value}>{value} {text('類回答')}</option>)}
            </select>
            <button onClick={clearFilters}>{text('清空篩選')}</button>
            <span className={css.sourceLabel}>{text('共')} {rows.length} {text('條記錄')}</span>
          </div>
          <div className={css.tableWrap}>
            <table><thead><tr><th>{text('服務主題')}</th><th>{text('渠道 / 語言')}</th><th>{text('回答策略')}</th><th>{text('處理狀態')}</th><th>{text('操作')}</th></tr></thead>
              <tbody>{pageRows.map(session => (
                <tr key={session.id} data-selected={session.id === selected.id}>
                  <td><strong>{text(session.title)}</strong><small>{session.id}</small></td>
                  <td>{text(session.channel)}<small>{text(session.language)}</small></td><td>{session.answerClass}</td>
                  <td><span className={css.badge}>{text(statusOf(session.id, session.result))}</span></td>
                  <td><button aria-label={`${text('查看')} ${session.id}`} onClick={() => {
                    props.actions.selectSession(session.id); setTimelineStep(0)
                  }}>{text('查看詳情')}</button></td>
                </tr>
              ))}</tbody>
            </table>
            {!rows.length && <div className={css.empty}>{text('沒有匹配的會話。')}<button onClick={clearFilters}>{text('清空篩選條件')}</button></div>}
          </div>
          <nav className={css.pagination} aria-label={text('服務記錄分頁')}>
            <small>{text('每頁 8 條')} · {text('第')} {currentPage} / {pages}</small>
            <div className={css.actions}>
              <button disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1) }}>{text('上一頁')}</button>
              <button disabled={currentPage === pages} onClick={() => { setPage(currentPage + 1) }}>{text('下一頁')}</button>
            </div>
          </nav>
        </>}
      </section>
      {source === '服務記錄' && (
        <section className={css.card} aria-label={text('服務記錄詳情')}>
          <div className={css.sectionHeading}>
            <div><span className={css.eyebrow}>{text('服務詳情')} · {selected.id}</span><h2>{text(selected.title)}</h2></div>
            <div className={css.actions}>
              <span className={css.badge}>{text(statusOf(selected.id, selected.result))}</span>
              {selected.id === 'CS-001' && (
                <button className={css.primary} onClick={() => {
                  props.actions.createIssue(); props.navigate?.('customer-service-evaluation')
                }}>{text(draft.issueCreated ? '查看關聯整改' : '標註問題並建立整改')}</button>
              )}
            </div>
          </div>
          <div className={css.columns}>
            <div><h3>{text('對話內容')}</h3>
              <div className={css.bubble} data-role="客戶"><small>{text('客戶')} · {text(selected.language)}</small><p>{selected.query}</p></div>
              <div className={css.bubble}><small>{text('客服')} · {selected.answerClass}</small><p>{selected.answer}</p></div>
            </div>
            <div>
              <h3>{text('處理依據')}</h3>
              <div className={css.stepTabs}>
                {stages.map(([label], index) => (
                  <button key={label} aria-pressed={timelineStep === index} onClick={() => { setTimelineStep(index) }}>
                    {index + 1}. {text(label)}
                  </button>
                ))}
              </div>
              <aside className={css.inspector}>
                <h3>{text(selectedEntry(stages[timelineStep])[0])}</h3><p>{text(selectedEntry(stages[timelineStep])[1])}</p>
                <button onClick={() => { props.navigate?.('customer-service-flows') }}>{text('查看流程編排')}</button>
              </aside>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

/** Render the version-checked synthetic regression and review loop. */
export function QualityWorkbench(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const [filter, setFilter] = useState('全部用例')
  const tested = draft.testedVersion === draft.termVersion
  const corrected = draft.terms['氹仔'] === 'taam5 zai2'
  const rows = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, name: index < 2 ? (index === 0 ? '氹仔完整地名播報' : '氹仔地址上下文匹配') : `${['標準話術保持原文', '賬單字段填充', '知識依據保留'][index % 3]} · 用例 ${index + 1}`,
    pass: index >= 2 || corrected,
  })).filter(row => filter === '全部用例' || (filter === '未通過' ? !row.pass && tested : row.pass && tested))
  return <>
    <section
      className={css.hero}>
      <div>
        <span
          className={css.eyebrow}>{text('質檢整改 · 可重複驗證')}
        </span>
        <h2>{text('氹仔地址讀音核對')}
        </h2>
        <p>CS-001 → {text('發音規則庫')} → 20 {text('條')} → {text('完成覆核')}
        </p>
      </div>
      <span
        className={css.badge}>
        {text(draft.issueClosed ? '覆核完成' : draft.issueCreated ? '整改中' : '待標註')}
      </span>
    </section>
    <div
      className={css.columns}>
      <section
        className={css.card}>
        <h2>{text('問題臺賬')}
        </h2>
        <dl
          className={css.facts}>
          <dt>{text('來源')}
          </dt>
          <dd>{text('驗證集')} · {text('電話')} CS-001
          </dd>
          <dt>{text('問題分類')}
          </dt>
          <dd>{text('地址 / 粵語發音')}
          </dd>
          <dt>{text('責任角色')}
          </dt>
          <dd>{text('知識與語音營運')}
          </dd>
          <dt>{text('驗收要求')}
          </dt>
          <dd>{text('完整詞條使用 taam5 zai2；不替換其他詞中的單字。')}
          </dd>
          <dt>{text('配置版本')}
          </dt>
          <dd>{text('草稿')} v
            {draft.termVersion} /
            {draft.reviewedVersion ? `${text('覆核完成')} v${draft.reviewedVersion}` : text('尚未完成審核')}
          </dd>
        </dl>
        <div
          className={css.actions}>
          {!draft.issueCreated &&
<button
  onClick={props.actions.createIssue}>{text('建立整改任務')}
</button>}
          <button
            onClick={() => { props.actions.selectSession('CS-001'); props.navigate?.('customer-service-sessions') }}>{text('查看來源會話')}
          </button>
          <button
            className={css.primary}
            onClick={() => { props.actions.selectTerm('氹仔'); props.navigate?.('customer-service-voice') }}>{text('編輯關聯發音規則')}
          </button>
        </div>
      </section>
      <section
        className={css.card}>
        <h2>{text('迴歸與覆核')}
        </h2>
        <div
          className={css.compare}>
          <div>
            <span>{text('基線結果')}
            </span>
            <strong>18 / 20
            </strong>
            <small> v1
            </small>
          </div>
          <div>
            <span>{text('當前草稿')}
            </span>
            <strong>
              {tested ? `${corrected ? '20' : '18'} / 20` : text('待運行')}
            </strong>
            <small> v
              {draft.termVersion}
            </small>
          </div>
        </div>
        <p>{text('規則校驗 · 當前版本測試集；不包含模型評分和音頻質量檢測。')}
        </p>
        <div
          className={css.actions}>
          <button
            className={css.primary}
            onClick={props.actions.runTests}>{text('運行規則迴歸')}
          </button>
          <button
            disabled={!draft.issueCreated || !tested || !corrected || draft.issueClosed}
            onClick={props.actions.review}>{text('完成覆核')}
          </button>
        </div>
        {draft.issueClosed &&
<p
  className={css.success}>{text('整改覆核完成，等待發布。')}
</p>}
      </section>
    </div>
    <section
      className={css.card}>
      <div
        className={css.sectionHeading}>
        <div>
          <h2>{text('迴歸測試集')}
          </h2>
          <p>{text('固定 20 條用例 · 修改詞典後必須重新運行當前版本')}
          </p>
        </div>
        <select
          aria-label={text('評測結果篩選')}
          value={filter}
          onChange={(event) => { setFilter(event.target.value) }}>
          {['全部用例', '通過', '未通過'].map(value =>
            <option
              key={value}
              value={value}>
              {text(value)}
            </option>)}
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th>{text('編號')}
            </th>
            <th>{text('檢查項')}
            </th>
            <th>{text('基線')}
            </th>
            <th>{text('當前結果')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row =>
            <tr
              key={row.id}>
              <td>CASE-
                {String(row.id).padStart(2, '0')}
              </td>
              <td>
                {row.id < 3 ? text(row.name) : `${text(row.name.split(' · ')[0] ?? '')} · ${text('用例')} ${row.id}`}
              </td>
              <td>
                {text(row.id <= 2 ? '未通過' : '通過')}
              </td>
              <td>
                {text(tested ? row.pass ? '通過' : '未通過' : '待運行')}
              </td>
            </tr>)}
        </tbody>
      </table>
      {!rows.length &&
<p>{text('暫無符合條件的結果。')}
</p>}
    </section>
  </>
}
