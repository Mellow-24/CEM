/** Mobile entry drives the shipped Agent, tools, persistence, and desktop history through the real wire. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode,
} from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

function answer(parts: string[]): { kind: 'chunks'; chunks: StreamChunk[] } {
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...parts.map(text => ({ type: 'text-delta' as const, index: 0, text })),
    { type: 'block-end', index: 0, block: { type: 'text', text: parts.join('') } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }
}

async function fits(page: Page): Promise<void> {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const bounds = await page.getByRole('button', { name: 'Send message', exact: true }).boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
}

it.skipIf(webSnapshotMode() === 'record')('sends, streams, runs a tool, resumes, changes sessions, and stops on mobile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mobile-session-'))
  const override = join(dir, 'replay.json')
  const id = CallId('mobile-bash')
  const args = JSON.stringify({ command: 'printf MOBILE_TOOL_OK', description: 'Mobile tool check' })
  const tool: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'bash', argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'bash', arguments: args } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
  await writeFile(override, JSON.stringify([
    { kind: 'chunks', chunks: tool },
    answer(['手机端已收到请求。', '工具执行完成：', 'MOBILE_TOOL_OK']),
    answer(['继续之前的会话。', 'MOBILE_RESUMED']),
    answer(Array.from({ length: 60 }, (_, n) => `正在分析第 ${String(n)} 项。`)),
  ]))
  const scaffold = await launchWebScaffold({
    replayFixture: join(dir, 'override-only.jsonl'), replayOverride: override, paceMs: 100,
    agentPresets: { roots: [{ path: fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url)), trust: 'system' }], default: 'standard' },
  })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true })
  const page = await context.newPage()
  try {
    const response = await page.goto(`${scaffold.baseUrl}/mobile.html`)
    expect(await response!.text()).toContain('__DSH_BOOT__')
    await page.locator('[data-mobile-app]').waitFor()
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Standard mode', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Minimal mode/ }).click()
    await page.getByRole('button', { name: 'Minimal mode', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Standard mode/ }).first().click()
    await fits(page)
    const golden = await captureStableAria(page, '[data-mobile-app]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/mobile-session/hero.expected.md', import.meta.url)), golden, webSnapshotMode())
    await page.screenshot({ path: '/tmp/dsh-mobile-home.png' })
    const input = page.locator('textarea:visible')
    await page.setViewportSize({ width: 390, height: 430 })
    await input.fill('键盘适配检查')
    await input.scrollIntoViewIfNeeded()
    const sendBounds = await page.getByRole('button', { name: 'Send message', exact: true }).boundingBox()
    expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(430)
    await page.setViewportSize({ width: 390, height: 844 })
    const done = scaffold.whenTurnSettled()
    await input.fill('请运行一次工具，然后回答我。')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByText('手机端已收到请求。', { exact: false }).waitFor()
    const sessionId = await done
    await page.getByText('MOBILE_TOOL_OK', { exact: false }).last().waitFor()
    const agent = scaffold.ctx.agents.roots().find(agent => agent.id === sessionId)!
    expect(agent.session.events.some(event => event.type === 'tool/result')).toBe(true)
    expect(agent.session.events.some(event => event.type === 'user/message')).toBe(true)
    const transcript = await captureStableAria(page, '[data-mobile-app]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/mobile-session/conversation.expected.md', import.meta.url)), transcript, webSnapshotMode())
    await fits(page)
    await page.screenshot({ path: '/tmp/dsh-mobile-conversation.png' })
    await page.reload()
    await page.getByText('MOBILE_TOOL_OK', { exact: false }).last().waitFor()
    const continued = scaffold.whenTurnSettled()
    await input.fill('继续刚才的会话。')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    expect(await continued).toBe(sessionId)
    await page.getByText('MOBILE_RESUMED', { exact: false }).waitFor()
    const nav = page.getByRole('navigation', { name: '手机导航' })
    await nav.getByRole('button', { name: '会话与设置', exact: true }).click()
    await page.getByRole('button', { name: 'New session', exact: true }).last().click()
    await page.getByRole('heading', { name: '有什么想和我聊聊？' }).waitFor()
    await nav.getByRole('button', { name: '会话与设置', exact: true }).click()
    await page.getByRole('treeitem', { name: /请运行一次工具，然后回答我/ }).click()
    await page.getByText('MOBILE_RESUMED', { exact: false }).waitFor()
    const stopped = scaffold.whenTurnSettled()
    await input.fill('请继续分析。')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByText('正在分析第 0 项。', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
    await stopped
    expect(agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('aborted')
    const desktop = await page.context().newPage()
    await desktop.setViewportSize({ width: 1280, height: 900 })
    await desktop.goto(scaffold.baseUrl)
    await desktop.locator('[data-shell-overlay]').waitFor({ state: 'attached' })
    expect(await desktop.locator('[data-mobile-app]').count()).toBe(0)
    await desktop.getByText('MOBILE_RESUMED', { exact: false }).waitFor()
  } catch (error) {
    console.error(error)
    await page.screenshot({ path: '/tmp/dsh-mobile-failure.png' })
    console.error(await page.locator('body').innerText())
    throw error
  } finally {
    await browser.close()
    await scaffold.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 120_000)

it.skipIf(webSnapshotMode() !== 'record')('talks to the live provider through the mobile entry', async () => {
  const scaffold = await launchWebScaffold()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true })
  try {
    await page.goto(`${scaffold.baseUrl}/mobile.html`)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const settled = scaffold.whenTurnSettled()
    await page.locator('textarea:visible').fill('请只回复 MOBILE_LIVE_OK，不要调用工具。')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const id = await settled
    const agent = scaffold.ctx.agents.roots().find(agent => agent.id === id)!
    expect(agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
    await page.getByText('MOBILE_LIVE_OK', { exact: true }).waitFor()
    await page.reload()
    await page.getByText('MOBILE_LIVE_OK', { exact: true }).waitFor()
    await page.screenshot({ path: '/tmp/dsh-mobile-live.png' })
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 180_000)
