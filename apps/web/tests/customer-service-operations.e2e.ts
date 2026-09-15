/** Keyless operations workflow through the shipped Web composition. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  launchWebScaffold, captureStableAria, compareOrRefreshGolden, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'

describe('customer-service operations workspace', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-HK' })
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens real quality pages while preserving knowledge and flow workspaces', async () => {
    const logs = watchConsole(page)
    await page.goto(scaffold.baseUrl)
    await page.getByRole('button', { name: '營運管理', exact: true }).click()
    const consolePage = page.getByRole('region', { name: '澳門電力智能客服營運管理台', exact: true })
    await consolePage.getByRole('heading', { name: '從每次對話，發現服務改進機會' }).waitFor()
    expect(await consolePage.getAttribute('aria-modal')).toBeNull()
    const bounds = await consolePage.boundingBox()
    expect(bounds?.width).toBe(1440)
    expect(bounds?.height).toBe(1000)

    for (const section of ['工作台', '智能體與渠道', '對話編排', '知識與回答', '模型與發音', '會話中心', '質檢與評測', '報表與大屏']) {
      await consolePage.getByRole('button', { name: section, exact: true }).click()
      expect(await consolePage.innerText()).not.toMatch(/演示|模擬|DEMO-/iu)
    }
    await consolePage.getByRole('button', { name: '模型與發音', exact: true }).click()
    await consolePage.getByRole('heading', { name: '先按語言和場景處理通用讀法' }).waitFor()
    await consolePage.getByRole('button', { name: '運行規則試讀' }).click()
    await consolePage.getByText(/澳門一百二十三棟 地下加閣樓/u).waitFor()
    await consolePage.getByLabel('試讀語言').selectOption('葡語')
    await consolePage.getByLabel('發音規則測試文本').fill('BNU')
    await consolePage.getByRole('button', { name: '運行規則試讀' }).click()
    await consolePage.getByText('Banco Nacional Ultramarino', { exact: true }).waitFor()
    await consolePage.getByRole('button', { name: '詞條糾偏', exact: true }).click()
    await consolePage.getByLabel('粵拼讀音').waitFor()
    await consolePage.getByRole('button', { name: '工作台', exact: true }).click()

    await consolePage.getByRole('button', { name: '對話編排', exact: true }).click()
    await consolePage.getByRole('button', { name: '檢查流程' }).click()
    await consolePage.getByText('基礎校驗通過：節點可達、名稱完整、出口有效、無循環。').waitFor()
    await consolePage.getByLabel('調試場景', { exact: true }).selectOption('timeout')
    await consolePage.getByRole('button', { name: '運行至結束' }).click()
    await consolePage.getByText('業務查詢超時 → 轉人工分支；坐席線路未接入。').waitFor()

    await consolePage.getByRole('button', { name: '知識與回答', exact: true }).click()
    await consolePage.getByRole('button', { name: '開始解析預覽' }).click()
    await consolePage.getByRole('button', { name: '生成知識切片' }).click()
    await consolePage.getByRole('button', { name: '檢索切片' }).click()
    await consolePage.getByRole('button', { name: '確認檢索結果' }).click()
    await consolePage.getByRole('button', { name: '提交審核' }).click()
    await consolePage.getByRole('checkbox').check()
    await consolePage.getByRole('button', { name: '完成審核', exact: true }).click()
    await consolePage.getByRole('button', { name: '審核已完成' }).waitFor()

    await consolePage.getByRole('button', { name: '運行數據' }).click()
    await consolePage.getByRole('heading', { name: '知識處理流程' }).waitFor()
    await consolePage.getByRole('searchbox', { name: '搜索文檔名稱' }).fill('no-matching-document-operations-test')
    await consolePage.getByText('沒有符合篩選條件的文檔。').waitFor()
    await consolePage.getByRole('button', { name: '如何更改合約戶名？' }).click()
    expect(await consolePage.getByLabel('測試問題', { exact: true }).inputValue()).toBe('如何更改合約戶名？')

    await consolePage.getByRole('button', { name: '會話中心', exact: true }).click()
    await consolePage.getByText('暫無符合條件的會話。').waitFor()
    await consolePage.getByRole('button', { name: '質檢與評測', exact: true }).click()
    await consolePage.getByRole('button', { name: '選擇會話開始質檢' }).waitFor()
    const snapshot = await captureStableAria(page, '[data-operations-page="evaluation"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./snapshots/customer-service-operations/remediation.expected.md', import.meta.url)),
      snapshot, webSnapshotMode(),
    )
    expect(logs.pageErrors).toEqual([])
  })

  it('keeps a separate CEM administration root over the same operational services', async () => {
    const logs = watchConsole(page)
    await page.goto(`${scaffold.baseUrl}/customer-admin`)
    const portal = page.locator('[data-customer-admin]')
    await portal.getByRole('heading', { name: '工作台', exact: true }).waitFor()
    await portal.getByRole('img', { name: '澳電 CEM' }).waitFor()
    await portal.getByRole('link', { name: '打開客服端' }).waitFor()
    expect(await page.title()).toBe('智能客服營運管理中心｜澳門電力股份有限公司')
    expect(await page.getByText('營運管理', { exact: true }).count()).toBe(0)
    expect(await page.getByText('深绎未来', { exact: true }).count()).toBe(0)

    expect(await portal.getByRole('button', { name: '對話編排', exact: true }).count()).toBe(0)
    await portal.getByRole('button', { name: '當前知識庫', exact: true }).click()
    await portal.getByRole('heading', { name: '知識資產與檢索驗證' }).waitFor()
    expect(await portal.getByRole('button', { name: '營運工作區' }).count()).toBe(0)
    expect(await portal.getByRole('button', { name: '運行數據' }).count()).toBe(0)
    expect((await portal.innerText())).not.toMatch(/deepseek|qwen/iu)
    expect(page.url()).toContain('#knowledge')
    await portal.getByRole('button', { name: '發音與詞庫', exact: true }).click()
    expect(await portal.getByRole('button', { name: '模型配置' }).count()).toBe(0)
    expect(await portal.getByRole('button', { name: '提示詞模板' }).count()).toBe(0)
    await portal.getByRole('button', { name: '澳門地址庫' }).waitFor()
    await portal.getByRole('button', { name: '會話中心', exact: true }).click()
    await portal.getByRole('heading', { name: '會話質量中心' }).waitFor()
    expect(page.url()).toContain('#sessions')

    const snapshot = await captureStableAria(page, '[data-customer-admin]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./snapshots/customer-service-operations/standalone.expected.md', import.meta.url)),
      snapshot, webSnapshotMode(),
    )
    expect(logs.pageErrors).toEqual([])
  })
})
