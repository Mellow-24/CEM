/** Single-session quality through the shipped Remote, persistence, slots and trace ledger. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { QualityAdapter, seedQualityConversation } from '../../../packages/host/customer-service-admin/tests/quality-fixture.ts'
import { launchWebScaffold, seedSession, captureStableAria, compareOrRefreshGolden, watchConsole,
  webSnapshotMode, type WebScaffold } from './scaffold.ts'

describe('customer-service session quality', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  const adapter = new QualityAdapter()
  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    scaffold.ctx.llm.registerAdapter(['quality-test'], adapter)
    const session = Session.create(SessionId('quality-web-source'))
    seedQualityConversation(session)
    await seedSession(scaffold, [JSON.stringify(session.header), ...session.events.map(event => JSON.stringify(event))].join('\n'), session.id)
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-HK' })
  })
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('scores a cold historical session, links evidence, persists human review and reopens the same result', async () => {
    const logs = watchConsole(page)
    await page.goto(scaffold.baseUrl)
    await page.getByRole('button', { name: '營運管理', exact: true }).click()
    const admin = page.getByRole('region', { name: '澳門電力智能客服營運管理台', exact: true })
    await admin.getByRole('button', { name: '會話中心', exact: true }).click()
    await admin.getByRole('button', { name: '查看詳情', exact: true }).click()
    await admin.getByRole('heading', { name: '如何繳費？', exact: true }).waitFor()
    await admin.getByRole('button', { name: '開始質檢', exact: true }).click()
    await admin.getByText('輪 1 · 繳費方式查詢', { exact: true }).waitFor()
    expect(adapter.requests).toHaveLength(1)
    expect(await admin.innerText()).not.toContain('PRIVATE_REASONING')
    const snapshot = await captureStableAria(page, '[data-quality-scores]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/customer-service-operations/quality.expected.md', import.meta.url)),
      snapshot, webSnapshotMode())
    await admin.getByRole('button', { name: '證據 #3', exact: true }).first().click()
    await admin.getByText('已定位證據 #3: search_company_knowledge', { exact: false }).waitFor()
    await admin.getByRole('button', { name: '檢索依據', exact: true }).click()
    await admin.getByText('可通過澳電 App 繳費。', { exact: false }).waitFor()
    await admin.getByRole('button', { name: '質檢與覆核記錄', exact: true }).click()
    await admin.getByLabel('覆核或驗收依據', { exact: true }).fill('人工覆核：證據與回答一致，請補充其他繳費渠道。')
    await admin.getByLabel('人工總分', { exact: true }).fill('85')
    await admin.getByRole('button', { name: '確認並保存人工評分', exact: true }).click()
    await admin.getByText('人工分數 85', { exact: false }).waitFor()
    await admin.getByRole('button', { name: '建立整改', exact: true }).click()
    await admin.getByRole('button', { name: '完成整改驗收', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: '營運管理', exact: true }).click()
    await admin.getByRole('button', { name: '質檢與評測', exact: true }).click()
    await admin.getByRole('button', { name: '查看評分與證據', exact: true }).click()
    await admin.getByText('輪 1 · 繳費方式查詢', { exact: true }).waitFor()
    await admin.getByRole('button', { name: '質檢與覆核記錄', exact: true }).click()
    await admin.getByText('人工分數 85', { exact: false }).waitFor()
    await admin.getByLabel('覆核或驗收依據', { exact: true }).fill('整改驗收：已補充渠道內容並完成人工核實。')
    await admin.getByRole('button', { name: '完成整改驗收', exact: true }).click()
    await admin.getByRole('button', { name: '重新打開整改', exact: true }).waitFor()
    expect(logs.pageErrors).toEqual([])
  })
})
