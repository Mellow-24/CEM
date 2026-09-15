/** Keyless assembled-Web evidence for the customer-facing CEM portal. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/feedback-command/session.jsonl', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('customer-facing CEM portal', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5 })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-HK' })
    await page.goto(scaffold.baseUrl)
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'cem-customer')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('replaces the operator shell only on /customer and offers real conversation input', async () => {
    const logs = watchConsole(page)
    await page.goto(`${scaffold.baseUrl}/customer`)
    await page.getByRole('heading', { name: '你好，有甚麼可以幫到你？' }).waitFor({ timeout: 30_000 })
    await page.getByRole('img', { name: '澳電 CEM' }).waitFor()
    expect(await page.getByRole('textbox', { name: '輸入你的問題' }).isEnabled()).toBe(true)
    await page.getByRole('button', { name: '語音輸入' }).waitFor()
    await page.getByRole('button', { name: '開始語音通話' }).waitFor()
    await page.getByRole('button', { name: '如何查閱過往十二個月的電子賬單？' }).waitFor()
    await page.getByRole('button', { name: '新對話' }).waitFor()
    await page.getByRole('navigation', { name: '客服對話記錄' }).waitFor()
    expect(await page.getByRole('link', { name: '進入營運管理後台' }).count()).toBe(0)
    expect(await page.getByText('營運管理', { exact: true }).count()).toBe(0)
    expect(await page.getByText('深绎未来', { exact: true }).count()).toBe(0)

    const snapshot = await captureStableAria(page, '[data-customer-conversation]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./snapshots/customer-portal/initial.expected.md', import.meta.url)),
      snapshot,
      webSnapshotMode(),
    )
    expect(logs.pageErrors).toEqual([])
  })

  it('sends a prompt through the existing Session service and renders its answer', async () => {
    const settled = scaffold.whenTurnSettled()
    const input = page.getByRole('textbox', { name: '輸入你的問題' })
    await input.fill(PROMPT)
    await input.press('Enter')
    await settled

    await page.getByText(PROMPT, { exact: true }).waitFor()
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()

    await page.reload()
    await page.getByRole('heading', { name: '你好，有甚麼可以幫到你？' }).waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: '開始語音通話' }).waitFor()
    await page.getByRole('button', { name: '如何查閱過往十二個月的電子賬單？' }).waitFor()
    expect(await page.getByText('LIGHTHOUSE', { exact: true }).count()).toBe(0)

    const historySnapshot = await captureStableAria(page, '[data-customer-history]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./snapshots/customer-portal/history.expected.md', import.meta.url)),
      historySnapshot,
      webSnapshotMode(),
    )

    await page.getByRole('button', { name: /^開啟對話：Reply with the single word/ }).click()
    await page.getByText(PROMPT, { exact: true }).waitFor()
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()

    const remove = page.getByRole('button', { name: /^刪除對話：Reply with the single word/ })
    await remove.hover()
    await remove.click()
    await page.getByRole('dialog', { name: '刪除對話' }).waitFor()
    await page.getByRole('button', { name: '確認刪除對話' }).click()
    await page.getByRole('button', { name: /^開啟對話：Reply with the single word/ }).waitFor({ state: 'detached' })
    await page.getByRole('heading', { name: '你好，有甚麼可以幫到你？' }).waitFor()
  })
})
