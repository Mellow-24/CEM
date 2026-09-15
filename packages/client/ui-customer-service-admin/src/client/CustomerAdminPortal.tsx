/** Standalone CEM-branded operations shell. */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CustomerAdminPortalProps } from './customer-admin-contract.ts'
import { CUSTOMER_ADMIN_PAGES, type OperationPage } from './demo-data.ts'
import { operationsText } from './operations-copy.ts'
import css from './CustomerAdminPortal.module.css'

const CEM_LOGO = 'https://www.cem-macau.com/_nuxt/img/logo.5ab12fa.svg'
const PRODUCT_TITLE = '智能客服營運管理中心｜澳門電力股份有限公司'

const PAGE_DESCRIPTIONS: Readonly<Record<OperationPage, string>> = {
  overview: '掌握服務運行情況、知識狀態和質量待辦。',
  agents: '配置智能體能力、服務入口與渠道接待策略。',
  flows: '編排客戶服務流程，驗證正常與異常處理路徑。',
  knowledge: '查看當前知識庫、文檔狀態、知識切片與檢索效果。',
  voice: '維護通用發音規則、詞條糾偏與澳門地址對照。',
  sessions: '查看真實歷史會話、執行證據與質量狀態。',
  evaluation: '啟動 AI 質檢，完成人工評分、確認與整改閉環。',
  reports: '按渠道、主題和回答策略觀察服務分佈。',
}

const NAV_GROUPS: readonly { title: string; pages: readonly OperationPage[] }[] = [
  { title: '營運概覽', pages: ['overview'] },
  { title: '服務配置', pages: ['agents', 'knowledge', 'voice'] },
  { title: '運營質量', pages: ['sessions', 'evaluation', 'reports'] },
]

function pageFromHash(): OperationPage {
  const candidate = window.location.hash.replace(/^#\/?/u, '')
  return CUSTOMER_ADMIN_PAGES.some(([page]) => page === candidate) ? candidate as OperationPage : 'overview'
}

function normalizePage(id: string): OperationPage | null {
  const candidate = id.replace(/^customer-service-/u, '')
  return CUSTOMER_ADMIN_PAGES.some(([page]) => page === candidate) ? candidate as OperationPage : null
}

/** Full-page CEM operations portal at the dedicated administration URL. */
export function CustomerAdminPortal(props: CustomerAdminPortalProps) {
  const text = (source: string) => operationsText(props.t, source)
  const [page, setPage] = useState<OperationPage>(pageFromHash)
  const [mobileNav, setMobileNav] = useState(false)
  const labels = new Map<OperationPage, string>(CUSTOMER_ADMIN_PAGES)

  useEffect(() => {
    const previousLanguage = document.documentElement.lang
    const previousTitle = document.title
    const projectTitle = () => {
      if (document.title !== PRODUCT_TITLE) document.title = PRODUCT_TITLE
    }
    const changed = () => { setPage(pageFromHash()) }
    window.addEventListener('hashchange', changed)
    document.documentElement.lang = 'zh-Hant'
    projectTitle()
    const title = document.querySelector('title')
    const observer = new MutationObserver(projectTitle)
    if (title !== null) observer.observe(title, { childList: true, characterData: true, subtree: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('hashchange', changed)
      document.documentElement.lang = previousLanguage
      document.title = previousTitle
    }
  }, [])

  const navigate = (id: string) => {
    const next = normalizePage(id)
    if (next === null) return
    setPage(next)
    setMobileNav(false)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${next}`)
  }

  return (
    <div className={css.portal} data-customer-admin>
      <aside className={css.sidebar} data-open={mobileNav}>
        <div className={css.brand}>
          <img src={CEM_LOGO} alt="澳電 CEM" />
          <div><strong>{text('智能客服')}</strong><span>{text('營運管理中心')}</span></div>
        </div>
        <nav className={css.navigation} aria-label={text('營運管理導航')}>
          {NAV_GROUPS.map(group => (
            <section key={group.title}>
              <h2>{text(group.title)}</h2>
              {group.pages.map(id => (
                <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => { navigate(id) }}>
                  <NavIcon page={id} /><span>{text(labels.get(id) ?? id)}</span>
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className={css.operator}>
          <span className={css.avatar}>營</span>
          <div><strong>{text('營運管理員')}</strong><span><i />{text('服務運行正常')}</span></div>
        </div>
      </aside>
      {mobileNav && <button className={css.scrim} aria-label={text('關閉導航')} onClick={() => { setMobileNav(false) }} />}
      <div className={css.shell}>
        <header className={css.topbar}>
          <button className={css.menuButton} aria-label={text('打開導航')} onClick={() => { setMobileNav(true) }}><MenuIcon /></button>
          <div className={css.heading}>
            <span>{text('澳電智能客服')}</span>
            <h1>{text(labels.get(page) ?? page)}</h1>
          </div>
          <div className={css.headerActions}>
            <span className={css.health}><i />{text('系統服務正常')}</span>
            <a href="/customer"><CustomerIcon />{text('打開客服端')}</a>
          </div>
        </header>
        <main className={css.content}>
          <div className={css.pageIntro}>
            <div><span>{text('智能客服營運管理')}</span><p>{text(PAGE_DESCRIPTIONS[page])}</p></div>
            <time>{new Intl.DateTimeFormat('zh-HK', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())}</time>
          </div>
          <div className={css.pageSurface}>
            {props.renderSlot('customer-admin.page', {
              close: () => { window.location.assign('/customer') }, navigate, standalone: true,
            }, { entryKey: page })}
          </div>
        </main>
        <footer className={css.footer}><span>© Companhia de Electricidade de Macau</span><span>{text('智能客服服務平台')}</span></footer>
      </div>
    </div>
  )
}

function NavIcon({ page }: { page: OperationPage }): ReactNode {
  const paths: Readonly<Record<OperationPage, ReactNode>> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    agents: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /><path d="M18 5h3M19.5 3.5v3" /></>,
    flows: <><rect x="3" y="3" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M9 5.5h5a3 3 0 0 1 3 3v7.5M14 13l3 3 3-3" /></>,
    knowledge: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H6.5A2.5 2.5 0 0 0 4 20.5Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h.5a2.5 2.5 0 0 1 2.5 2.5Z" /></>,
    voice: <><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    sessions: <><path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1-5a9 9 0 1 1 17-5Z" /><path d="M8 11h8M8 15h5" /></>,
    evaluation: <><path d="m9 11 2 2 4-5" /><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M17 3v4h4" /></>,
    reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[page]}</svg>
}

function MenuIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
}

function CustomerIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1-5a9 9 0 1 1 17-5Z" /></svg>
}
