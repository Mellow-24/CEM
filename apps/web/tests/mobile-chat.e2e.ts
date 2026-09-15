/** CEM mobile entry through the shipped Host, Session runtime, and real browser. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it.skipIf(webSnapshotMode() === 'record')('preserves isolated mobile chat, Sessions, agents, and desktop entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cem-mobile-chat-'))
  const override = join(dir, 'replay.json')
  const answer = (text: string) => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] })
  await writeFile(override, JSON.stringify([answer('可以，請先準備電費單上的客戶編號。我會為您介紹查詢方式。'), answer('已保留本次查詢的上下文。')]))
  const scaffold = await launchWebScaffold({ replayFixture: join(dir, 'scripted.jsonl'), replayOverride: override, paceMs: 100 })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true })
  const logs = watchConsole(page)
  try {
    await page.goto(scaffold.baseUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.goto(`${scaffold.baseUrl}/mobile.html?ui=cem-chat`)
    await page.getByRole('heading', { name: '您好，有甚麼可以幫您？' }).waitFor({ timeout: 30_000 })
    expect(await page.locator('[data-mobile-app]').count()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/mobile-chat/welcome.expected.md', import.meta.url)), await captureStableAria(page, '[data-cem-conversation]', scaffold.workspaceCwd), webSnapshotMode())
    await page.screenshot({ path: '/tmp/cem-mobile-welcome.png' })
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const box = await page.getByRole('button', { name: '發送訊息' }).boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    const first = scaffold.whenTurnSettled()
    await page.getByRole('button', { name: '如何查詢本月電費？', exact: true }).click()
    const id = await first
    await page.getByText('可以，請先準備電費單上的客戶編號。我會為您介紹查詢方式。', { exact: true }).waitFor()
    await page.screenshot({ path: '/tmp/cem-mobile-chat.png' })
    await page.reload()
    await page.getByText('可以，請先準備電費單上的客戶編號。我會為您介紹查詢方式。', { exact: true }).waitFor()
    const second = scaffold.whenTurnSettled()
    await page.getByRole('textbox', { name: '輸入您的問題' }).fill('繼續剛才的查詢。')
    await page.getByRole('button', { name: '發送訊息' }).click()
    expect(await second).toBe(id)
    await page.getByText('已保留本次查詢的上下文。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '對話記錄', exact: true }).click()
    await page.getByRole('button', { name: '開始新對話', exact: true }).click()
    await page.getByRole('heading', { name: '您好，有甚麼可以幫您？' }).waitFor()
    await page.getByRole('button', { name: '對話記錄', exact: true }).click()
    await page.getByRole('dialog', { name: '對話記錄' }).getByRole('button', { name: '如何查詢本月電費？', exact: false }).click()
    await page.getByText('已保留本次查詢的上下文。', { exact: true }).waitFor()
    const agent = scaffold.ctx.agents.roots().find(item => item.id === id)!
    expect(agent.session.events.filter(event => event.type === 'user/message' && event.data.source.kind !== 'plugin')).toHaveLength(2)
    await page.getByRole('button', { name: '對話記錄', exact: true }).click()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('combobox', { name: '服務助手' }).selectOption('macau-customer-service-wiki')
    await page.getByRole('heading', { name: '您好，有甚麼可以幫您？' }).waitFor()
    await expect.poll(async () => {
      const response = await fetch(`${scaffold.baseUrl}/api/session.list`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'cem-preset-check', method: 'session.list', payload: {} }),
      })
      const body = await response.json() as { result: { value?: { items: { sessionId: string; agentPreset?: string }[] } } }
      return body.result.value?.items.some(item => item.sessionId !== id && item.agentPreset === 'macau-customer-service-wiki')
    }).toBe(true)
    expect(agent.session.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(2)
    await page.goto(`${scaffold.baseUrl}/mobile.html?ui=legacy`)
    await page.locator('[data-mobile-app]').waitFor()
    expect(await page.locator('[data-cem-mobile]').count()).toBe(0)
    await page.goto(scaffold.baseUrl)
    await page.locator('[data-shell-overlay]').waitFor({ state: 'attached' })
    expect(await page.locator('[data-cem-mobile]').count()).toBe(0)
    expect(logs.pageErrors).toEqual([])
  } catch (error) {
    console.error(error)
    await page.screenshot({ path: '/tmp/cem-mobile-failure.png' })
    console.error(await page.locator('body').innerText())
    throw error
  } finally {
    await browser.close()
    await scaffold.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 120_000)
