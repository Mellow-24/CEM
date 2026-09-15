/** Business operations pages with separately identified runtime data and configuration previews. */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { OperationsProps } from './operations-contract.ts'
import { CUSTOMER_ADMIN_PAGES, DEMO_SESSIONS, OPERATION_PAGES } from './demo-data.ts'
import { OverviewSection } from './OverviewSection.tsx'
import { KnowledgeSection } from './KnowledgeSection.tsx'
import { EvaluationSection } from './EvaluationSection.tsx'
import { AgentWorkbench, VoiceWorkbench } from './ConfigurationWorkbench.tsx'
import { FlowWorkbench } from './FlowWorkbench.tsx'
import { KnowledgeWorkbench } from './KnowledgeWorkbench.tsx'
import { SessionWorkbench, QualityWorkbench } from './SessionWorkbench.tsx'
import { operationsText } from './operations-copy.ts'
import css from './Operations.module.css'

const DESCRIPTIONS = {
  overview: '集中處理服務反饋、知識更新與質量覆核。',
  agents: '管理服務入口、智能體策略與接待體驗。',
  flows: '編排服務路徑，驗證正常與異常分支。',
  knowledge: '從文檔加工到回答策略，管理每一份服務依據。',
  voice: '維護通用發音規則、詞條糾偏與澳門地址對照。',
  sessions: '查閲服務記錄，定位問題與處理依據。',
  evaluation: '跟蹤問題整改，驗證當前版本並完成覆核。',
  reports: '按渠道和回答策略分析服務分佈。',
} as const

/** Render a business page; resetting its drafts also resets private form buffers. */
export function OperationsSection(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const currentKnowledge = props.standalone === true && props.page === 'knowledge'
  const [real, setReal] = useState(props.standalone === true && (props.page === 'overview' || props.page === 'knowledge'))
  const [reset, setReset] = useState(false)
  const [screen, setScreen] = useState(false)
  const go = (page: string) => { props.navigate?.(`customer-service-${page}`) }
  const liveSupported = ['overview', 'knowledge', 'evaluation'].includes(props.page)
  return (
    <div className={css.workspace} data-screen={screen} data-standalone={props.standalone} data-operations-page={props.page}>
      {!props.standalone && <header className={css.masthead}>
        <div>
          <span className={css.eyebrow}>{text('深繹未來 · 澳門電力')}</span>
          <p className={css.pageDescription}>{text(DESCRIPTIONS[props.page])}</p>
        </div>
        <div className={css.actions}>
          {props.page === 'reports' && (
            <button onClick={() => { setScreen(!screen) }}>{text(screen ? '退出大屏' : '全屏展示')}</button>
          )}
          <button onClick={props.close}>{text('返回客服')}</button>
          <details className={css.workspaceTools}>
            <summary>{text('工作區設定')}</summary>
            <div className={css.toolPanel}>
              <strong>{text('配置與數據説明')}</strong>
              <p>{text('工作區內置驗證用例，配置保存在當前頁籤；刷新後重置。運行數據從已接入服務讀取。')}</p>
              <p>{text('渠道與詞典尚未接入發佈，草稿修改不會影響運行中的客服。')}</p>
              <button onClick={() => { setReset(true) }}>{text('重置工作區')}</button>
            </div>
          </details>
        </div>
      </header>}
      {reset && (
        <div className={css.banner} role="alert">
          <span>{text('清除當前頁籤的工作區草稿和驗證進度？運行配置、歷史會話和知識庫不會被刪除。')}</span>
          <button onClick={() => { props.actions.reset(); setReset(false) }}>{text('確認重置工作區')}</button>
          <button onClick={() => { setReset(false) }}>{text('取消')}</button>
        </div>
      )}
      {draft.notice && (
        <div className={css.notice} role="status">
          <span>{text(draft.notice)}</span>
          <button aria-label={text('關閉操作提示')} onClick={() => { props.actions.notify('') }}>×</button>
        </div>
      )}
      {liveSupported && !currentKnowledge && (
        <div className={css.sourceBar}>
          <div className={css.tabs} role="group" aria-label={text('數據來源')}>
            <button aria-pressed={!real} onClick={() => { setReal(false) }}>{text('營運工作區')}</button>
            <button aria-pressed={real} onClick={() => { setReal(true) }}>{text('運行數據')}</button>
          </div>
          <span className={css.sourceLabel}>{text(real ? '已接入服務' : '配置與驗證')}</span>
        </div>
      )}
      <div className={css.pageBody} key={draft.resetVersion}>
        {real && props.page === 'overview' ? <OverviewSection {...props} />
          : real && props.page === 'knowledge' ? <KnowledgeSection {...props} />
            : real && props.page === 'evaluation' ? <EvaluationSection {...props} />
              : props.page === 'overview' ? (
                <>
                  <Metrics props={props} />
                  <section className={css.hero}>
                    <div>
                      <span className={css.eyebrow}>{text('服務質量 · 重點關注')}</span>
                      <h2>{text('從每次對話，發現服務改進機會')}</h2>
                      <p>{text('檢查歷史會話，查看六維評分與原始執行證據，跟蹤人工覆核和整改驗收。')}</p>
                      <button className={css.primary} onClick={() => {
                        go('sessions')
                      }}>{text('進入會話質檢 →')}</button>
                    </div>
                    <div className={css.heroStamp}>CEM<span>{text('服務營運')}<br />{text('持續改進')}</span></div>
                  </section>
                  <div className={css.columns}>
                    <section className={css.card}>
                      <h2>{text('營運任務')}</h2>
                      <div className={css.row}>
                        <div><strong>{text('質量檢查與覆核')}</strong>
                          <p>{text('查看質檢任務、待覆核結果和未完成整改')}</p>
                        </div>
                        <button onClick={() => { go('evaluation') }}>{text('查看')}</button>
                      </div>
                      <div className={css.row}>
                        <div><strong>{text('計劃停電通知入庫')}</strong>
                          <p>{text(draft.documentStep === 5 ? '審核完成 · 待發布' : '待完成文檔加工與審核')}</p>
                        </div>
                        <button onClick={() => { go('knowledge') }}>{text('查看')}</button>
                      </div>
                    </section>
                    <section className={css.card}>
                      <h2>{text('快捷入口')}</h2>
                      <div className={css.quickGrid}>
                        {(props.standalone ? CUSTOMER_ADMIN_PAGES : OPERATION_PAGES)
                          .filter(([id]) => ['flows', 'knowledge', 'voice', 'reports'].includes(id)).map(([id, label]) => (
                            <button key={id} onClick={() => { go(id) }}>
                              <strong>{text(label)}</strong><span>{text(DESCRIPTIONS[id])}</span>
                            </button>
                          ))}
                      </div>
                    </section>
                  </div>
                  <ReportCharts props={props} />
                </>
              ) : props.page === 'agents' ? <AgentWorkbench {...props} />
                : props.page === 'flows' ? <FlowWorkbench {...props} />
                  : props.page === 'knowledge' ? <KnowledgeWorkbench {...props} />
                    : props.page === 'voice' ? <VoiceWorkbench {...props} />
                      : props.page === 'sessions' ? <SessionWorkbench {...props} />
                        : props.page === 'evaluation' ? <QualityWorkbench {...props} />
                          : <><Metrics props={props} /><ReportCharts props={props} /></>}
      </div>
    </div>
  )
}

function Metrics({ props }: { props: OperationsProps }) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const unresolved = DEMO_SESSIONS.filter(session => session.result === '待覆核').length - (draft.issueClosed ? 1 : 0)
  const metrics = [
    [text('驗證集會話'), String(DEMO_SESSIONS.length), text('電話 / Web / App')],
    [text('已完成'), String(DEMO_SESSIONS.length - unresolved), text('按工作區處理狀態統計')],
    [text('待覆核'), String(unresolved), text('需要營運人員跟進')],
    [text('規則迴歸'), draft.testedVersion ? `${draft.terms['氹仔'] === 'taam5 zai2' ? '20' : '18'} / 20` : text('待運行'), text('獨立測試集')],
  ]
  return <div className={css.metrics}>{metrics.map(([label, value, hint]) => (
    <section className={css.metric} key={label}>
      <span>{label}</span><strong>{value}</strong><small>{hint}</small>
    </section>
  ))}</div>
}

function ReportCharts({ props }: { props: OperationsProps }) {
  const text = (source: string) => operationsText(props.t, source)
  const [channel, setChannel] = useState('全部渠道')
  const sessions = DEMO_SESSIONS.filter(session => channel === '全部渠道' || session.channel === channel)
  const groups: { label: string; categories: string[]; field: 'title' | 'answerClass' }[] = [
    { label: text('諮詢主題'), categories: [...new Set(sessions.map(session => session.title))], field: 'title' },
    { label: text('回答策略'), categories: ['A', 'B', 'C'], field: 'answerClass' },
  ]
  return (
    <section className={css.card}>
      <div className={css.sectionHeading}>
        <div><h2>{text('服務分佈')}</h2><p>{text('驗證集')} · {text('當前篩選')} {sessions.length} {text('條記錄')}</p></div>
        <select aria-label={text('報表渠道')} value={channel} onChange={(event) => { setChannel(event.target.value) }}>
          {['全部渠道', '電話', 'Web', 'App'].map(value => <option key={value} value={value}>{text(value)}</option>)}
        </select>
      </div>
      <div className={css.columns}>{groups.map(({ label, categories, field }) => (
        <div key={label}><h3>{label}</h3>{categories.map((category) => {
          const count = sessions.filter(session => session[field] === category).length
          const percent = Math.round(count / Math.max(1, sessions.length) * 100)
          return (
            <div className={css.barRow} key={category}>
              <span>{category.length === 1 ? `${category} ${text('類回答')}` : text(category)}</span>
              <div className={css.barTrack}><i style={{ '--bar-width': `${percent}%` } as CSSProperties} /></div>
              <strong>{count}</strong><small>{percent}%</small>
            </div>
          )
        })}</div>
      ))}</div>
      <details className={css.explanation}>
        <summary>{text('統計口徑')}</summary>
        <p>{text('當前圖表來自內置驗證集，不作為線上業務指標。迴歸結果單獨統計，運行數據請在工作台切換查看。')}</p>
      </details>
    </section>
  )
}
