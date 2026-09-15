// Web e2e scenario: the shipped Hong Kong feng-shui preset authorizes one
// scoped synthesis profile. A real Chromium drives the committed-message
// action through the real client bundle, Connection raw Fetch bridge, Host
// message lookup, speech runtime, and DashScope provider. The provider fixture
// holds its chunked SSE response until the loading state is captured; audio
// completion is not the assertion because headless media decoding is platform-dependent.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/voice-synthesis', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const LOADING_EXPECTED = join(SNAPSHOT_DIR, 'loading.expected.md')
const MODE = webSnapshotMode()
const REPLY = '客廳可以先保持光猛、通風同動線順暢。'
const PROMPT = `Reply exactly with this sentence and stop: ${REPLY}`
const DASH_SCOPE_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'
const DASH_SCOPE_AUDIO = Uint8Array.from([0x49, 0x44, 0x33, 0x04])
const DASH_SCOPE_INSTRUCTION = '以自然、親切的香港粵語語氣朗讀；咬字清楚，節奏同停頓自然。'

interface ProviderRequest {
  readonly body: unknown
  readonly authorization?: string
}

interface SpeechProvider {
  readonly request: Promise<ProviderRequest>
  release(): void
  close(): Promise<void>
}

/** Install one outbound DashScope fixture whose successful SSE arrives in two chunks. */
function startSpeechProvider(): SpeechProvider {
  let resolveRequest!: (request: ProviderRequest) => void
  const received = new Promise<ProviderRequest>((resolve) => { resolveRequest = resolve })
  let releaseResponse!: () => void
  const responseRelease = new Promise<void>((resolve) => { releaseResponse = resolve })
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    releaseResponse()
  }
  const originalFetch = globalThis.fetch
  const fixtureFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url !== DASH_SCOPE_ENDPOINT) return await originalFetch(input, init)
    if (typeof init?.body !== 'string') throw new Error('DashScope request body must be JSON text')
    const authorization = new Headers(init.headers).get('authorization') ?? undefined
    resolveRequest({
      body: JSON.parse(init.body) as unknown,
      ...authorization === undefined ? {} : { authorization },
    })
    await responseRelease
    return dashScopeResponse()
  }
  globalThis.fetch = fixtureFetch
  return {
    request: received,
    release,
    close(): Promise<void> {
      release()
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = originalFetch
      return Promise.resolve()
    },
  }
}

/** Successful DashScope response split across two stream pulls. */
function dashScopeResponse(): Response {
  const events = [
    { output: { type: 'sentence-synthesis', audio: { data: Buffer.from(DASH_SCOPE_AUDIO).toString('base64') } } },
    { output: { finish_reason: 'stop' } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  const bytes = new TextEncoder().encode(events)
  const split = Math.floor(bytes.byteLength / 2)
  const chunks = [bytes.subarray(0, split), bytes.subarray(split)]
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      if (chunk === undefined) {
        controller.close()
        return
      }
      index += 1
      controller.enqueue(chunk)
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

/** Install the shipped preset's environment contract and return exact restoration. */
function installSpeechEnvironment(): () => void {
  const values: Record<string, string | undefined> = {
    DASHSCOPE_API_KEY: 'voice-e2e-secret',
    DSH_HK_FENG_SHUI_STT_URL: undefined,
  }
  const prior = new Map(Object.keys(values).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  return () => {
    for (const [key, value] of prior) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  }
}

/** Wait for one provider request without letting a missing browser fetch hang the lane. */
async function providerRequest(provider: SpeechProvider): Promise<ProviderRequest> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      provider.request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('speech provider received no synthesis request')) }, 15_000)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe.skipIf(MODE === 'record')('web e2e: committed assistant speech synthesis', () => {
  it('routes a committed message through the scoped provider and exposes loading honestly', async () => {
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    let page: Page | undefined
    const provider = startSpeechProvider()
    const restoreEnvironment = installSpeechEnvironment()
    const failures: unknown[] = []
    try {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
      scaffold = await launchWebScaffold({
        replayFixture: FIXTURE,
        paceMs: 10,
        agentPresets: {
          roots: [{ path: fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url)), trust: 'system' }],
          default: 'hk-feng-shui',
        },
      })
      browser = await chromium.launch()
      page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)

      const settled = scaffold.whenTurnSettled()
      const composer = page.locator('textarea:enabled').last()
      await composer.fill(PROMPT)
      await composer.press('Enter')
      await settled
      await page.getByText(REPLY, { exact: true }).waitFor({ timeout: 10_000 })
      const play = page.getByRole('button', { name: 'Play AI-generated speech' })
      await play.waitFor({ timeout: 10_000 })
      const hostRequest = page.waitForRequest((request) => {
        return new URL(request.url()).pathname === '/api/speech/synthesize'
      })
      await play.click()

      const requestToHost = await hostRequest
      const hostUrl = new URL(requestToHost.url())
      expect(requestToHost.method()).toBe('GET')
      expect([...hostUrl.searchParams.keys()].sort()).toEqual(['messageId', 'profile', 'sessionId'])
      expect(hostUrl.searchParams.get('messageId')).not.toBe('')
      expect(hostUrl.searchParams.get('profile')).toBe('hk-feng-shui')
      expect(hostUrl.searchParams.get('sessionId')).not.toBe('')
      const request = await providerRequest(provider)
      expect(request).toEqual({
        authorization: 'Bearer voice-e2e-secret',
        body: {
          model: 'qwen-audio-3.0-tts-flash',
          input: {
            text: REPLY,
            voice: 'qwen-audio-3.0-tts-flash-yishuiyue-e46ca9514e714a479eeb17e5fbfbfab7',
            format: 'mp3',
            sample_rate: 22050,
            instruction: DASH_SCOPE_INSTRUCTION,
            enable_aigc_tag: true,
          },
        },
      })
      await page.getByText('Generating AI-generated speech…', { exact: true }).waitFor({ timeout: 10_000 })
      const loading = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(LOADING_EXPECTED, loading, MODE)

      provider.release()
      await expect.poll(async () => {
        if (await page!.getByRole('button', { name: 'Play AI-generated speech' }).count() > 0) return 'idle'
        if (await page!.getByRole('button', { name: 'AI-generated speech playback failed; select to retry' }).count() > 0) return 'error'
        return 'pending'
      }, { timeout: 15_000 }).not.toBe('pending')
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      await assertFixtureInventory(SNAPSHOT_DIR, ['loading.expected.md', 'session.jsonl'])
    } catch (error) {
      failures.push(error)
      if (page !== undefined) await saveFailureShot(page, 'web-e2e-voice-synthesis')
    } finally {
      provider.release()
      await browser?.close().catch((error: unknown) => failures.push(error))
      await scaffold?.close().catch((error: unknown) => failures.push(error))
      restoreEnvironment()
      await provider.close().catch((error: unknown) => failures.push(error))
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'voice synthesis e2e teardown failed')
    }
  }, 120_000)
})
