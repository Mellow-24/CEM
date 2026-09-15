/** CEM browser media and Session admission with replayed external ASR, TTS, and model services. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import type WebSocket from 'ws'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it.skipIf(webSnapshotMode() === 'record')('records a reviewed draft and preserves a minimized CEM call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cem-mobile-voice-'))
  const audio = await readFile(fileURLToPath(new URL('./snapshots/voice-call/response.mp3', import.meta.url)))
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => { server.once('listening', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address')
  const previous = {
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
    DSH_MACAU_ASR_REALTIME_URL: process.env.DSH_MACAU_ASR_REALTIME_URL,
    DSH_MACAU_TTS_REALTIME_URL: process.env.DSH_MACAU_TTS_REALTIME_URL,
    MACAU_MINISTREAM_TTS_TOKEN: process.env.MACAU_MINISTREAM_TTS_TOKEN,
  }
  Object.assign(process.env, { DASHSCOPE_API_KEY: 'fixture', DSH_MACAU_ASR_REALTIME_URL: `ws://127.0.0.1:${address.port}`, DSH_MACAU_TTS_REALTIME_URL: `ws://127.0.0.1:${address.port}/ministream-ws/tts/{client_id}`, MACAU_MINISTREAM_TTS_TOKEN: 'fixture' })
  let socket: WebSocket | undefined
  let frames = 0
  let synthesized = 0
  server.on('connection', (peer, request) => {
    if (request.url?.startsWith('/ministream-ws/tts/')) {
      peer.on('message', (data) => {
        const event = JSON.parse(Buffer.from(data as ArrayBuffer).toString()) as { type: string; request_id: string }
        if (event.type !== 'synthesize') return
        synthesized++
        peer.send(JSON.stringify({ type: 'start', request_id: event.request_id, format: 'mp3', sample_rate: 48000, channels: 1 }))
        peer.send(audio, { binary: true })
        peer.send(JSON.stringify({ type: 'end', request_id: event.request_id }))
      })
    } else {
      socket = peer
      peer.on('message', (data) => {
        const event = JSON.parse(Buffer.from(data as ArrayBuffer).toString()) as { type: string }
        if (event.type === 'session.update') peer.send(JSON.stringify({ type: 'session.updated' }))
        if (event.type === 'input_audio_buffer.append') frames++
      })
    }
  })
  const reply = '好的，我哋可以繼續了解電費查詢方式。'
  const question = '我想繼續了解查詢方式。\n尤其是上個月的。'
  const longReply = [
    '以下是測試用的詳細說明，並非真實帳單資料。',
    '先準備電費單並核對客戶編號，再確認查詢月份與地址，留意帳單列出的用電期間和繳費期限。',
    '查看金額時請區分本期費用與以前尚未繳付的項目；若已完成繳費，可準備付款日期和收據供客服查核。',
    '請不要在聊天中提供銀行密碼或一次性驗證碼；如需核對帳戶身份，請使用官方指定的安全流程。',
    '測試參考編號：CEM' + '0123456789'.repeat(12),
    '這是最新一句，您可以繼續詢問繳費方式。',
  ].join('\n')
  const override = join(dir, 'replay.json')
  await writeFile(override, JSON.stringify([reply, longReply].map(text => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } },
  ] }))))
  const scaffold = await launchWebScaffold({ replayFixture: join(dir, 'model.jsonl'), replayOverride: override, paceMs: 100 })
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true })
  try {
    await page.route('**/api/speech/transcribe?*', route => route.fulfill({ json: { text: '查詢電費', language: 'yue' } }))
    await page.addInitScript(() => {
      const media = new Set<HTMLMediaElement>()
      const unlocked = new WeakSet<HTMLMediaElement>()
      const audible: HTMLMediaElement[] = []
      const sources = new Set<string>()
      Reflect.set(window, '__cemMedia', media)
      Reflect.set(window, '__cemAudible', audible)
      Reflect.set(window, '__cemAudibleSources', sources)
      // oxlint-disable-next-line typescript/unbound-method -- The original is called with its media receiver.
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        // Model mobile browsers that grant playback to an element, not to later-created elements.
        if (!Reflect.get(window, '__cemLockNewMedia')) unlocked.add(this)
        else if (!unlocked.has(this)) return Promise.reject(new DOMException('Element needs a user gesture', 'NotAllowedError'))
        // Reused fixture audio plays faster; capture, decoding, sentence ordering, and teardown remain real.
        this.playbackRate = Reflect.get(window, '__cemHoldReply') && this.src.startsWith('blob:') ? .25 : 4
        if (!media.has(this)) this.addEventListener('playing', () => {
          if (this.currentSrc.startsWith('blob:')) { audible.push(this); sources.add(this.currentSrc) }
        })
        media.add(this)
        return play.call(this)
      }
    })
    await page.goto(scaffold.baseUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.goto(`${scaffold.baseUrl}/mobile.html?ui=cem-chat`)
    await page.getByRole('heading', { name: '您好，有甚麼可以幫您？' }).waitFor()
    await expect.poll(() => page.getByRole('button', { name: '想直接說？ 與澳電助手通話' }).isEnabled()).toBe(true)
    await page.screenshot({ path: '/tmp/cem-mobile-welcome-ready.png' })
    await page.getByRole('button', { name: '切換語音輸入' }).click()
    await page.getByRole('button', { name: '也可點擊開始錄音' }).click()
    await page.getByText('正在聆聽…', { exact: true }).waitFor()
    await page.screenshot({ path: '/tmp/cem-mobile-recording.png' })
    await page.getByRole('button', { name: '完成錄音並轉文字' }).click()
    await expect.poll(() => page.getByRole('textbox', { name: '輸入您的問題' }).inputValue()).toBe('查詢電費')
    expect(scaffold.ctx.agents.roots().flatMap(agent => agent.session.events).filter(event => event.type === 'assistant/message')).toHaveLength(0)
    await page.getByRole('button', { name: '想直接說？ 與澳電助手通話' }).click()
    const dialog = page.getByRole('dialog', { name: '澳電語音通話' })
    await dialog.waitFor()
    await expect.poll(() => frames, { timeout: 20000 }).toBeGreaterThan(2)
    await page.evaluate(() => { Reflect.set(window, '__cemLockNewMedia', true); Reflect.set(window, '__cemHoldReply', true) })
    await dialog.getByRole('button', { name: '靜音', exact: true }).click()
    await dialog.getByRole('button', { name: '取消靜音' }).waitFor()
    socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '不應發送' }))
    expect(await dialog.getByText('不應發送', { exact: true }).count()).toBe(0)
    await dialog.getByRole('button', { name: '取消靜音' }).click()
    await dialog.getByRole('button', { name: '返回聊天' }).click()
    await page.getByRole('button', { name: /正在聆聽.*\d{2}:\d{2}/ }).click()
    socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
    socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '我想繼續了解查詢方式。' }))
    await dialog.getByText('我想繼續了解查詢方式。', { exact: true }).waitFor()
    // A conversational pause must fit within the shipped continuation window.
    await new Promise(resolve => setTimeout(resolve, 350))
    socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
    socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '尤其是上個月的。' }))
    await expect.poll(() => synthesized, { timeout: 15000 }).toBeGreaterThan(0)
    await dialog.getByText(reply, { exact: true }).waitFor()
    await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cemAudible') as HTMLMediaElement[]).length), { timeout: 15000 }).toBeGreaterThanOrEqual(2)
    expect(await page.evaluate(() => new Set(Reflect.get(window, '__cemAudible') as HTMLMediaElement[]).size)).toBe(1)
    expect(await dialog.getByRole('heading', { name: '通話字幕' }).count()).toBe(0)
    expect(await dialog.getByText('即時顯示最新對話', { exact: true }).count()).toBe(0)
    expect(await dialog.getByText(question, { exact: true }).evaluate(element => getComputedStyle(element).textAlign)).toBe('right')
    expect(await dialog.getByText(reply, { exact: true }).evaluate(element => getComputedStyle(element).textAlign)).toBe('left')
    socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
    socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', text: '嗯嗯', stash: '' }))
    socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '嗯嗯' }))
    await expect.poll(() => dialog.getByText('嗯嗯', { exact: true }).count()).toBe(0)
    expect(await dialog.getByText('· 已打斷', { exact: true }).count()).toBe(0)
    expect(await page.evaluate(() => (Reflect.get(window, '__cemAudible') as HTMLMediaElement[])
      .some(media => !media.paused))).toBe(true)
    const aria = (await captureStableAria(page, '[aria-label="澳電語音通話"]', scaffold.workspaceCwd)).replace(/\b\d{2}:\d{2}\b/g, '00:00')
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/mobile-chat/call.expected.md', import.meta.url)), aria, webSnapshotMode())
    await page.screenshot({ path: '/tmp/cem-mobile-call.png', animations: 'disabled' })
    expect(await dialog.getByText(reply, { exact: true }).count()).toBe(1)
    await page.evaluate(() => { Reflect.set(window, '__cemHoldReply', false) })
    socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
    socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', text: '請提供詳細說明。', stash: '' }))
    socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '請提供詳細說明。' }))
    await dialog.getByText(longReply, { exact: true }).waitFor({ timeout: 45000 })
    await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cemAudibleSources') as Set<string>).size), { timeout: 15000 }).toBeGreaterThanOrEqual(4)
    expect(await page.evaluate(() => new Set(Reflect.get(window, '__cemAudible') as HTMLMediaElement[]).size)).toBe(1)
    expect(await dialog.getByText(reply, { exact: true }).count()).toBe(1)
    await dialog.getByText('· 已打斷', { exact: true }).waitFor()
    const userTexts = scaffold.ctx.agents.roots().flatMap(agent => agent.session.events)
      .flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
        ? [event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : [])
    expect(userTexts).toEqual([question, `${question}\n請提供詳細說明。`])
    const log = dialog.getByRole('log', { name: '通話對話' })
    await log.dispatchEvent('wheel', { deltaY: -100 })
    await log.evaluate((element) => { element.scrollTop = 0 })
    await dialog.getByRole('button', { name: '回到最新對話 ↓' }).waitFor()
    await expect.poll(() => log.evaluate(element => element.scrollTop)).toBe(0)
    const greeting = dialog.getByText('你好，我係澳電智能客服，請問有咩可以幫到你？', { exact: true })
    expect(await greeting.evaluate((element) => {
      const bounds = element.getBoundingClientRect(), viewport = element.closest('[role="log"]')!.getBoundingClientRect()
      return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom
    })).toBe(true)
    await page.screenshot({ path: '/tmp/cem-mobile-call-history.png' })
    await dialog.getByRole('button', { name: '回到最新對話 ↓' }).click()
    const historyAria = (await captureStableAria(page, '[aria-label="澳電語音通話"]', scaffold.workspaceCwd))
      .replace(/\b\d{2}:\d{2}\b/g, '00:00')
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/mobile-chat/call-history.expected.md', import.meta.url)), historyAria, webSnapshotMode())
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const viewports = [
      { width: 390, height: 740 }, { width: 360, height: 640 }, { width: 430, height: 844 },
      { width: 320, height: 568 }, { width: 844, height: 390 },
    ]
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect.poll(() => dialog.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(viewport.height)
      const layout = await dialog.evaluate((element) => {
        const log = element.querySelector<HTMLElement>('[role="log"]')!
        const last = log.querySelector('p:last-child')!
        const paragraphs = log.querySelectorAll('p')
        const latest = paragraphs.item(paragraphs.length - 1)
        const text = latest.firstChild!
        const tail = document.createRange()
        tail.setStart(text, text.textContent!.length - 1)
        tail.setEnd(text, text.textContent!.length)
        const end = tail.getBoundingClientRect()
        const bounds = log.getBoundingClientRect()
        return {
          width: element.clientWidth, scrollWidth: element.scrollWidth,
          height: element.clientHeight, scrollHeight: element.scrollHeight,
          captionHeight: bounds.height,
          frameBorder: getComputedStyle(log.parentElement!).borderTopWidth,
          frameShadow: getComputedStyle(log.parentElement!).boxShadow,
          tailVisible: end.top >= bounds.top && end.bottom <= bounds.bottom && end.right <= bounds.right,
          scrollbars: [element, ...element.querySelectorAll('*')].filter((node) => {
            const style = getComputedStyle(node)
            return ['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflowX)
          }).length,
          controlsVisible: [...element.querySelectorAll('button')].every((button) => {
            const rect = button.getBoundingClientRect()
            return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.width >= 44 && rect.height >= 44
          }),
          fontSize: parseFloat(getComputedStyle(last).fontSize),
          animation: getComputedStyle(latest.closest('[class]')!).animationName,
        }
      })
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width)
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height)
      expect(layout.captionHeight).toBeGreaterThan(viewport.height <= 540 ? 90 : viewport.height * .22)
      expect(layout.tailVisible).toBe(true)
      expect(layout.controlsVisible).toBe(true)
      expect(layout.scrollbars).toBe(1)
      expect(layout.frameBorder).toBe('0px')
      expect(layout.frameShadow).toBe('none')
      expect(layout.fontSize).toBe(13)
      expect(layout.animation).toBe('none')
      await page.screenshot({ path: `/tmp/cem-mobile-call-${viewport.width}x${viewport.height}.png` })
    }
    await dialog.getByRole('button', { name: '結束通話' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByText(reply, { exact: true }).waitFor()
    expect(await page.getByRole('textbox', { name: '輸入您的問題' }).inputValue()).toBe('查詢電費')
    expect(await page.evaluate(() => [...Reflect.get(window, '__cemMedia') as Set<HTMLMediaElement>].every(media => media.paused))).toBe(true)
    await page.reload()
    await page.getByText(longReply, { exact: true }).waitFor()
    await page.getByText(reply, { exact: true }).waitFor()
  } catch (error) {
    console.error(error)
    console.error(await page.locator('body').innerText())
    await page.screenshot({ path: '/tmp/cem-mobile-voice-failure.png' })
    throw error
  } finally {
    await browser.close()
    try { await scaffold.close() } finally {
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
      await rm(dir, { recursive: true, force: true })
    }
  }
}, 90000)
