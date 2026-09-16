/** Real browser capture, Qwen wire adapters, and ordinary Session admission with external providers replayed. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import type WebSocket from 'ws'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { launchWebScaffold, captureStableAria, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const MODE = webSnapshotMode()
const REPLY = '自動轉賬失敗，常見原因係賬單已經過期，或者銀行戶口餘額不足。請先確認轉賬當日戶口有足夠資金，亦可以聯絡開戶銀行查詢。如果仲需要協助，請聯絡網上客服。'
const GREETING = '你好，我係澳電智能客服，請問有咩可以幫到你？'
const FIRST_PROMPT_SEGMENT = '我现在的自动转账'
const SECOND_PROMPT_SEGMENT = '失败了怎么办？'
const PROMPT = `${FIRST_PROMPT_SEGMENT}\n${SECOND_PROMPT_SEGMENT}`
const FIXTURE = fileURLToPath(new URL('./snapshots/voice-call/session.jsonl', import.meta.url))

/** PCM sine followed by silence exercises the real browser's utterance detector. */
function microphoneWave(): Buffer {
  const rate = 16000
  const frames = rate * 4
  const wav = Buffer.alloc(44 + frames * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < rate; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 12000), 44 + i * 2)
  return wav
}

function fallbackPcm(): Buffer {
  const frames = 24_000
  const pcm = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 330 / 24_000) * 5000), i * 2)
  }
  return pcm
}

describe.skipIf(MODE === 'record')('web voice calls', () => {
  it.each([
    { preset: 'macau-customer-service', entry: '/' },
    { preset: 'macau-customer-service-wiki', entry: '/' },
    { preset: 'macau-customer-service', entry: '/mobile.html' },
  ])('retains $preset voice messages after hangup at $entry', async ({ preset, entry }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-voice-call-'))
    const wave = join(root, 'microphone.wav')
    await writeFile(wave, microphoneWave())
    const priorUrl = process.env.DSH_MACAU_ASR_REALTIME_URL
    const priorTtsUrl = process.env.DSH_MACAU_TTS_REALTIME_URL
    const priorTtsToken = process.env.MACAU_MINISTREAM_TTS_TOKEN
    const priorFallbackUrl = process.env.DSH_MACAU_TTS_FALLBACK_URL
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) throw new Error('WebSocket address unavailable')
    process.env.DSH_MACAU_ASR_REALTIME_URL = `ws://127.0.0.1:${String(address.port)}`
    process.env.DSH_MACAU_TTS_REALTIME_URL = `ws://127.0.0.1:${String(address.port)}/ministream-ws/tts/{client_id}`
    process.env.MACAU_MINISTREAM_TTS_TOKEN = 'voice-call-fixture-token'
    const fallbackRequests: Array<{ text: string; voice: string; language_type: string }> = []
    const fallbackAuthorizations: Array<string | undefined> = []
    const qwenAudio = fallbackPcm().toString('base64')
    const fallbackServer = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          input: { text: string; voice: string; language_type: string }
        }
        fallbackAuthorizations.push(request.headers.authorization)
        fallbackRequests.push(body.input)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end([
          `data: ${JSON.stringify({ code: '', status_code: 200,
            output: { audio: { data: qwenAudio }, finish_reason: null } })}\n\n`,
          `data: ${JSON.stringify({ output: { audio: { data: '', url: 'https://unused.invalid/fallback.wav' },
            finish_reason: 'stop' } })}\n\n`,
        ].join(''))
      })
    })
    await new Promise<void>(resolve => fallbackServer.listen(0, '127.0.0.1', resolve))
    const fallbackAddress = fallbackServer.address()
    if (typeof fallbackAddress === 'string' || fallbackAddress === null) throw new Error('HTTP address unavailable')
    process.env.DSH_MACAU_TTS_FALLBACK_URL = `http://127.0.0.1:${String(fallbackAddress.port)}/qwen-tts`
    const ttsAudio = await readFile(fileURLToPath(new URL('./snapshots/voice-call/response.mp3', import.meta.url)))
    let socket: WebSocket | undefined
    let pcmFrames = 0
    const ttsTexts: string[] = []
    const ttsVoices: string[] = []
    let releaseTtsFailure!: () => void
    const ttsFailure = new Promise<void>((resolve) => { releaseTtsFailure = resolve })
    server.on('connection', (peer, request) => {
      const url = new URL(request.url ?? '', 'ws://127.0.0.1')
      if (url.pathname.startsWith('/ministream-ws/tts/')) {
        expect(request.headers.authorization).toBe('Bearer voice-call-fixture-token')
        ttsVoices.push(url.searchParams.get('voice_preset_key') ?? '')
        expect(url.searchParams.get('generation_mode')).toBe('preset_voice')
        peer.on('message', (data) => {
          const event = JSON.parse(Buffer.from(data as ArrayBuffer).toString()) as {
            type: string
            text: string
            request_id: string
          }
          if (event.type !== 'synthesize') return
          ttsTexts.push(event.text)
          if (ttsTexts.length === 3) {
            void ttsFailure.then(() => {
              if (peer.readyState === 1) peer.send(JSON.stringify({
                type: 'error', request_id: event.request_id, code: 'fixture_failure', message: 'fixture TTS failure',
              }))
            })
            return
          }
          peer.send(JSON.stringify({ type: 'start', request_id: event.request_id,
            format: 'mp3', sample_rate: 48000, channels: 1 }))
          peer.send(ttsAudio, { binary: true })
          peer.send(JSON.stringify({ type: 'end', request_id: event.request_id }))
        })
        return
      }
      socket = peer
      peer.on('message', (data) => {
        const event = JSON.parse((Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)).toString('utf8')) as {
          type: string
          audio?: string
          session?: { turn_detection?: { threshold?: number; silence_duration_ms?: number } }
        }
        if (event.type === 'session.update') {
          expect(event).toMatchObject({ session: { turn_detection: { threshold: 0.75, silence_duration_ms: 250 } } })
          peer.send(JSON.stringify({ type: 'session.updated' }))
        }
        if (event.type === 'input_audio_buffer.append') {
          expect(Buffer.from(event.audio!, 'base64')).toHaveLength(3200)
          pcmFrames++
        }
      })
    })
    const prior = process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'voice-call-fixture-key'
    const scaffold = await launchWebScaffold({
      replayFixture: FIXTURE, paceMs: 1000,
      agentPresets: { roots: [{ path: fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url)), trust: 'system' }], default: preset },
    })
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wave}`] })
    const page = entry === '/mobile.html'
      ? await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true })
      : await newEnglishPage(browser)
    try {
      let rejectGreeting = entry === '/mobile.html'
      let mobileGreetingRequests = 0
      let mobileMediaRequests = 0
      if (entry === '/mobile.html') await page.route('**/api/speech/greeting?*', async (route) => {
        // Native media loading cannot use this fixture's authenticated route; page fetch can.
        const media = route.request().resourceType() === 'media'
        if (media) mobileMediaRequests++
        else mobileGreetingRequests++
        if (media || rejectGreeting) await route.fulfill({ status: 403, body: 'Authentication required' })
        else await route.continue()
      })
      // A slower-than-frame response exercises real capture, batching, HTTP authorization, and provider writes.
      await page.route('**/api/speech/realtime/audio?*', async (route) => {
        const response = await route.fetch()
        await new Promise(resolve => setTimeout(resolve, 250))
        await route.fulfill({ response })
      })
      await page.addInitScript(() => {
        const media = new Set<HTMLMediaElement>()
        Reflect.set(window, '__voiceMedia', media)
        // oxlint-disable-next-line typescript/unbound-method -- The wrapper restores the media receiver with original.call(this).
        const original = HTMLMediaElement.prototype.play
        HTMLMediaElement.prototype.play = function () {
          media.add(this)
          if (this.src.includes('/api/speech/greeting?') || this.src.startsWith('blob:')) {
            this.addEventListener('ended', () => { Reflect.set(window, '__voiceGreetingEnded', true) }, { once: true })
          }
          return original.call(this)
        }
      })
      const greetingLoaded = page.waitForResponse(response => response.url().includes('/api/speech/greeting?')
        && response.status() === (entry === '/mobile.html' ? 403 : 200))
      await page.goto(`${scaffold.baseUrl}${entry}`, { waitUntil: 'load' })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      const callButton = page.getByRole('button', { name: 'Start voice call', exact: true })
      await callButton.waitFor({ timeout: 15000 })
      await greetingLoaded
      if (entry === '/mobile.html') {
        await callButton.click()
        const failedCall = page.getByRole('dialog', { name: 'Customer service voice call' })
        await failedCall.getByRole('alert').filter({ hasText: 'HTTP 403' }).waitFor()
        expect(socket).toBeUndefined()
        expect(ttsTexts).toEqual([])
        const failureAria = (await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd))
          .replace(/\b\d{2}:\d{2}\b/g, '00:00')
        await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/voice-call/greeting-auth-failure.expected.md', import.meta.url)), failureAria, MODE)
        rejectGreeting = false
        const retryLoaded = page.waitForResponse(response => response.url().includes('/api/speech/greeting?') && response.status() === 200)
        await failedCall.getByRole('button', { name: 'End call', exact: true }).click()
        await retryLoaded
      }
      await callButton.click()
      const dialog = page.getByRole('dialog', { name: 'Customer service voice call' })
      await dialog.waitFor()
      await expect.poll(() => socket !== undefined).toBe(true)
      await page.getByText('Speaking…', { exact: true }).waitFor()
      if (entry === '/mobile.html') {
        expect(mobileGreetingRequests).toBeGreaterThanOrEqual(2)
        expect(mobileMediaRequests).toBe(0)
      }
      const completedReplies = () => scaffold.ctx.agents.roots().flatMap(agent => agent.session.events)
        .filter(event => event.type === 'assistant/message').length
      expect(completedReplies()).toBe(0)
      expect(await page.evaluate(() => {
        const media = Reflect.get(window, '__voiceMedia') as Set<HTMLMediaElement>
        return [...media].some(element => !element.paused && !element.src.startsWith('data:')
          && element.playbackRate === 1.15 && element.preservesPitch)
      })).toBe(true)
      expect(ttsTexts).toEqual([])
      await dialog.getByText(GREETING, { exact: true }).waitFor()

      socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
      socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', text: '你好', stash: '' }))
      socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: GREETING }))
      await expect.poll(() => page.evaluate(() => {
        const media = Reflect.get(window, '__voiceMedia') as Set<HTMLMediaElement>
        return [...media].some(element => !element.paused && element.currentTime >= 1
          && (element.src.includes('/api/speech/greeting?') || element.src.startsWith('blob:')))
      }), { timeout: 3000 }).toBe(true)
      expect(pcmFrames).toBe(0)
      expect(completedReplies()).toBe(0)
      const openingAria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/voice-call/greeting.expected.md', import.meta.url)), openingAria, MODE)
      await page.waitForFunction(() => Reflect.get(window, '__voiceGreetingEnded') === true)

      await expect.poll(() => pcmFrames, { timeout: 15000 }).toBeGreaterThan(2)
      const viewport = page.viewportSize()!
      const bounds = await dialog.boundingBox()
      expect(bounds).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height })
      expect(await dialog.getByRole('button', { name: 'Send this utterance' }).count()).toBe(0)
      socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
      socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', text: '', stash: FIRST_PROMPT_SEGMENT }))
      socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: FIRST_PROMPT_SEGMENT }))
      socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
      socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', text: '', stash: SECOND_PROMPT_SEGMENT }))
      await dialog.getByText(PROMPT, { exact: true }).waitFor()
      await page.getByText('Listening. What can we help with?', { exact: true }).waitFor()
      expect(await page.evaluate(() => {
        const media = Reflect.get(window, '__voiceMedia') as Set<HTMLMediaElement>
        return media.size > 0 && [...media].every(element => element.paused)
      })).toBe(true)
      expect(completedReplies()).toBe(0)
      socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: SECOND_PROMPT_SEGMENT }))
      await expect.poll(() => ttsTexts.length, { timeout: 15000 }).toBeGreaterThanOrEqual(1)
      await page.getByText('Speaking…', { exact: true }).waitFor()
      await expect.poll(completedReplies, { timeout: 15000 }).toBe(1)
      const callContext = scaffold.ctx.agents.roots().flatMap(agent => agent.session.events)
        .find(event => event.type === 'user/message'
          && event.data.source.kind === 'plugin'
          && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
          && event.data.source.form === 'snapshot'
          && event.data.source.sections.some(section => section.name === 'speech-web:active-call'))
      expect(callContext?.type === 'user/message' && callContext.data.content[0]?.type === 'text'
        ? callContext.data.content[0].text
        : '').toContain('当前客服只提供澳门粤语和英文')
      expect(ttsVoices[0]).toBe('mailinlin')
      await expect.poll(() => pcmFrames, { timeout: 15000 }).toBeGreaterThan(40)
      expect(await dialog.getByRole('alert').count()).toBe(0)
      const assistantCaption = dialog.getByText(REPLY, { exact: true })
      await assistantCaption.waitFor()
      if (entry === '/mobile.html') {
        expect(await assistantCaption.evaluate((element) => {
          const bubble = element.parentElement!
          return bubble.getBoundingClientRect().right <= bubble.parentElement!.getBoundingClientRect().right
        })).toBe(true)
      }
      const captionsAtBottom = () => assistantCaption.evaluate((element) => {
        const container = element.parentElement!.parentElement!
        return Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 2
      })
      await expect.poll(captionsAtBottom).toBe(true)
      const aria = (await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)).replace(/\b\d{2}:\d{2}\b/g, '00:00')
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/voice-call/call.expected.md', import.meta.url)), aria, MODE)
      await page.screenshot({ path: `/tmp/dsh-realtime-${preset}.png` })
      if (preset === 'macau-customer-service') {
        await page.setViewportSize({ width: 390, height: 844 })
        expect(await dialog.boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 })
        await expect.poll(captionsAtBottom).toBe(true)
        await page.screenshot({ path: '/tmp/dsh-realtime-mobile.png' })
      }
      releaseTtsFailure()
      await expect.poll(() => fallbackRequests.length, { timeout: 20000 }).toBe(1)
      expect(fallbackAuthorizations).toEqual(['Bearer voice-call-fixture-key'])
      expect(fallbackRequests).toEqual([{ text: ttsTexts[2], voice: 'Kiki', language_type: 'Chinese' }])
      await page.getByText('Listening. What can we help with?', { exact: true }).waitFor({ timeout: 20000 })
      expect(await assistantCaption.textContent()).toBe(REPLY)
      expect(await dialog.getByRole('alert').count()).toBe(0)
      const fallbackAria = (await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd))
        .replace(/\b\d{2}:\d{2}\b/g, '00:00')
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/voice-call/tts-fallback.expected.md', import.meta.url)), fallbackAria, MODE)
      const framesAfterFallback = pcmFrames
      await expect.poll(() => pcmFrames, { timeout: 5000 }).toBeGreaterThan(framesAfterFallback)
      socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
      socket!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Still connected' }))
      await dialog.getByText('Still connected', { exact: true }).waitFor()
      expect(await dialog.getByRole('alert').count()).toBe(0)
      await dialog.getByRole('button', { name: 'End call', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await page.getByText(PROMPT, { exact: true }).last().waitFor()
      await page.getByText(REPLY, { exact: true }).last().waitFor()
      await page.reload()
      await page.getByText(REPLY, { exact: true }).last().waitFor({ timeout: 15000 })
      expect(await page.getByRole('dialog', { name: 'Customer service voice call' }).count()).toBe(0)
    } catch (error) {
      console.error(error)
      console.error(await page.locator('body').innerText())
      await page.screenshot({ path: `/tmp/dsh-voice-${preset}.png` })
      throw error
    } finally {
      await browser.close()
      await scaffold.close()
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve, reject) =>{  server.close((error) =>{  if (error) reject(error); else resolve() }) })
      await new Promise<void>((resolve, reject) => {
        fallbackServer.close((error) => { if (error) reject(error); else resolve() })
      })
      if (priorUrl === undefined) Reflect.deleteProperty(process.env, 'DSH_MACAU_ASR_REALTIME_URL')
      else process.env.DSH_MACAU_ASR_REALTIME_URL = priorUrl
      if (priorTtsUrl === undefined) Reflect.deleteProperty(process.env, 'DSH_MACAU_TTS_REALTIME_URL')
      else process.env.DSH_MACAU_TTS_REALTIME_URL = priorTtsUrl
      if (priorTtsToken === undefined) Reflect.deleteProperty(process.env, 'MACAU_MINISTREAM_TTS_TOKEN')
      else process.env.MACAU_MINISTREAM_TTS_TOKEN = priorTtsToken
      if (priorFallbackUrl === undefined) Reflect.deleteProperty(process.env, 'DSH_MACAU_TTS_FALLBACK_URL')
      else process.env.DSH_MACAU_TTS_FALLBACK_URL = priorFallbackUrl
      if (prior === undefined) Reflect.deleteProperty(process.env, 'DASHSCOPE_API_KEY')
      else process.env.DASHSCOPE_API_KEY = prior
      await rm(root, { recursive: true, force: true })
    }
  }, 60000)
})
