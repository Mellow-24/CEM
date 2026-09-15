import { Context } from '@deepseek-ai/cordis'
import SpeechSynthesisRuntime from '@deepseek-ai/dsh-speech-synthesis'
import * as DashScopePlugin from '../src/index.ts'
import {
  Config,
  DEFAULT_DASHSCOPE_TTS_ENDPOINT,
  DashScopeSpeechSynthesisProvider,
  type Config as DashScopeConfig,
} from '../src/index.ts'
import {
  apply as applyInvariant,
  inject as invariantInject,
  name as invariantName,
} from '../src/invariant.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const encoder = new TextEncoder()

const baseConfig = {
  profile: 'fortune-voice',
  model: 'qwen-audio-tts',
  voice: 'trained-voice',
  format: 'mp3',
  timeoutMs: 1_000,
  maxInputChars: 1_000,
  maxOutputBytes: 32,
  maxResponseBytes: 16_384,
  maxEventBytes: 4_096,
} satisfies DashScopeConfig

function context(key = 'test-key'): Context {
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: vi.fn(async () => ({ value: key, source: 'test' })),
  } as never)
  return ctx
}

function event(value: unknown, eol: '\n' | '\r\n' = '\n'): string {
  return `data: ${JSON.stringify(value)}${eol}${eol}`
}

function response(
  values: Array<string | Uint8Array>,
  options: { status?: number; contentType?: string; headers?: Record<string, string> } = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const value of values) {
        controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value)
      }
      controller.close()
    },
  })
  return new Response(stream, {
    ...options.status === undefined ? {} : { status: options.status },
    headers: {
      ...options.contentType === undefined ? {} : { 'content-type': options.contentType },
      ...options.headers,
    },
  })
}

function sentence(bytes: number[], finishReason: unknown = 'null') {
  return {
    output: {
      type: 'sentence-synthesis',
      audio: { data: Buffer.from(bytes).toString('base64') },
      finish_reason: finishReason,
    },
  }
}

function stop() {
  return { output: { finish_reason: 'stop' } }
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<number[][]> {
  const chunks: number[][] = []
  for await (const chunk of source) chunks.push([...chunk])
  return chunks
}

async function outputFor(provider: DashScopeSpeechSynthesisProvider, text = 'hello') {
  return provider.synthesize({ text }, new AbortController().signal)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashScope speech provider', () => {
  it.each([
    [undefined, 'Kiki', 'Chinese'], ['yue-Hant-MO', 'Kiki', 'Chinese'],
    ['zh-Hans', 'Cherry', 'Chinese'], ['en', 'Jennifer', 'English'], ['pt', 'Maia', 'Portuguese'],
  ])('routes language %s and streams browser WAV before the provider finishes', async (language, voice, languageType) => {
    let sink!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(controller) { sink = controller } })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, protocol: 'qwen-tts', model: 'qwen3-tts-flash', voice: 'Kiki',
      endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      defaultLanguage: 'yue', voiceByLanguage: { zh: 'Cherry', en: 'Jennifer', pt: 'Maia' },
      format: 'wav', sampleRate: 24000, maxInputChars: 600, maxOutputBytes: 1000,
    })
    const output = await provider.synthesize({ text: 'sample', ...language === undefined ? {} : { language } }, new AbortController().signal)
    const rawBody = fetchMock.mock.calls[0]?.[1]?.body
    if (typeof rawBody !== 'string') throw new Error('Expected JSON request')
    const body = JSON.parse(rawBody) as unknown
    expect(body).toEqual({ model: 'qwen3-tts-flash', input: { text: 'sample', voice, language_type: languageType } })
    const chunks = output.chunks[Symbol.asyncIterator]()
    sink.enqueue(encoder.encode(event({ code: '', status_code: 200, output: { audio: { data: 'AQIDBA==' }, finish_reason: null } })))
    const header = await chunks.next()
    if (header.done) throw new Error('Missing WAV header')
    expect(Buffer.from(header.value).subarray(0, 4).toString()).toBe('RIFF')
    const audio = await chunks.next()
    if (audio.done) throw new Error('Missing PCM data')
    expect([...audio.value]).toEqual([1, 2, 3, 4])
    sink.enqueue(encoder.encode(event({ output: { audio: { data: '', url: 'https://unused.invalid/audio.wav' }, finish_reason: 'stop' } })))
    sink.close()
    expect((await chunks.next()).done).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects unsupported language and incompatible Qwen-TTS controls', async () => {
    const config = { ...baseConfig, protocol: 'qwen-tts' as const, format: 'wav' as const,
      endpoint: 'https://example.com/tts', sampleRate: 24000 as const, maxInputChars: 600, maxOutputBytes: 1000 }
    expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...config, format: 'mp3' })).toThrow(/WAV/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...config, instruction: 'soft' })).toThrow(/controls/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...config, defaultLanguage: 'unknown' })).toThrow(/language/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...config, maxInputChars: 601 })).toThrow(/600/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...config, endpoint: 'http://127.0.0.1:8080/tts' }))
      .not.toThrow()
    expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...config, endpoint: 'http://example.com/tts' }))
      .toThrow(/HTTPS/)
  })

  it('sends the official request fields and decodes multiple streamed sentences', async () => {
    const wire = encoder.encode([
      event({ output: { type: 'sentence-begin', finish_reason: null } }, '\r\n'),
      event(sentence([1, 2], 'null'), '\n'),
      event(sentence([3, 4], null), '\r\n'),
      event({ output: { type: 'sentence-end', finish_reason: 'null' } }, '\n'),
      event(stop(), '\r\n'),
    ].join(''))
    const pieces = [...wire].map(byte => new Uint8Array([byte]))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response(pieces, { contentType: 'text/event-stream; charset=utf-8' }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig,
      sampleRate: 24000,
      volume: 80,
      rate: 1.2,
      pitch: 0.9,
      languageHints: ['zh'],
      instruction: 'Warm and measured.',
      enableAigcTag: true,
    })
    const output = await outputFor(provider, '你好')
    expect(output.metadata).toEqual({ mediaType: 'audio/mpeg', sampleRateHz: 24000 })
    await expect(collect(output.chunks)).resolves.toEqual([[1, 2], [3, 4]])

    const [url, init] = fetchMock.mock.calls[0] ?? []
    const requestUrl = url instanceof Request ? url.url : url instanceof URL ? url.href : url
    expect(requestUrl).toBe(DEFAULT_DASHSCOPE_TTS_ENDPOINT)
    expect(init?.redirect).toBe('error')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer test-key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-dashscope-sse')).toBe('enable')
    if (typeof init?.body !== 'string') throw new Error('DashScope request body must be JSON text')
    expect(JSON.parse(init.body)).toEqual({
      model: 'qwen-audio-tts',
      input: {
        text: '你好',
        voice: 'trained-voice',
        format: 'mp3',
        sample_rate: 24000,
        volume: 80,
        rate: 1.2,
        pitch: 0.9,
        language_hints: ['zh'],
        instruction: 'Warm and measured.',
        enable_aigc_tag: true,
      },
    })
  })

  it('derives the public media type from the provider format', () => {
    expect(new DashScopeSpeechSynthesisProvider(context(), { ...baseConfig, format: 'mp3' }).mediaType)
      .toBe('audio/mpeg')
    expect(new DashScopeSpeechSynthesisProvider(context(), { ...baseConfig, format: 'wav' }).mediaType)
      .toBe('audio/wav')
    expect(new DashScopeSpeechSynthesisProvider(context(), { ...baseConfig, format: 'opus' }).mediaType)
      .toBe('audio/ogg')
  })

  it.each([
    ['malformed JSON', 'data: {oops\n\n'],
    ['non-object JSON', 'data: []\n\n'],
    ['missing output', event({ request_id: 'x' })],
    ['wrong output fields', event({ output: { type: 42 } })],
    ['missing audio data', event({ output: { type: 'sentence-synthesis', audio: {} } })],
  ])('rejects %s without exposing event data', async (_label, wire) => {
    vi.stubGlobal('fetch', vi.fn(async () => response([wire], { contentType: 'text/event-stream' })))
    const output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig))
    await expect(collect(output.chunks)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
  })

  it.each(['%===', 'AB==', 'AQI'])('rejects non-canonical Base64 %s', async (data) => {
    vi.stubGlobal('fetch', vi.fn(async () => response([
      event({ output: { type: 'sentence-synthesis', audio: { data }, finish_reason: 'null' } }),
      event(stop()),
    ], { contentType: 'text/event-stream' })))
    const output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig))
    await expect(collect(output.chunks)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
  })

  it('enforces decoded output exactly for a single and accumulated audio chunk', async () => {
    const config = { ...baseConfig, maxOutputBytes: 2 }
    vi.stubGlobal('fetch', vi.fn(async () => response([
      event(sentence([1, 2])), event(stop()),
    ], { contentType: 'text/event-stream' })))
    let output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), config))
    await expect(collect(output.chunks)).resolves.toEqual([[1, 2]])

    vi.stubGlobal('fetch', vi.fn(async () => response([
      event(sentence([1, 2, 3])), event(stop()),
    ], { contentType: 'text/event-stream' })))
    output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), config))
    await expect(collect(output.chunks)).rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE' })

    vi.stubGlobal('fetch', vi.fn(async () => response([
      event(sentence([1, 2])), event(sentence([3])), event(stop()),
    ], { contentType: 'text/event-stream' })))
    output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), config))
    await expect(collect(output.chunks)).rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE' })
  })

  it('rejects missing stop, stop before audio, non-stop finish, and provider error events', async () => {
    const cases: Array<{ wire: string; code: string }> = [
      { wire: event(sentence([1])), code: 'INVALID_PROVIDER_RESPONSE' },
      { wire: event(stop()), code: 'INVALID_PROVIDER_RESPONSE' },
      { wire: event({ output: { finish_reason: 'error' } }), code: 'PROVIDER_ERROR' },
      { wire: event({ code: 'InvalidApiKey', message: 'provider body' }), code: 'PROVIDER_ERROR' },
    ]
    for (const item of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => response([item.wire], { contentType: 'text/event-stream' })))
      const output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig))
      await expect(collect(output.chunks)).rejects.toMatchObject({ code: item.code })
    }
  })

  it('rejects non-SSE and HTTP failures without reading response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(['secret body'], {
      contentType: 'application/json',
    })))
    await expect(outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig)))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })

    vi.stubGlobal('fetch', vi.fn(async () => response(['private provider body'], {
      status: 429,
      contentType: 'text/event-stream',
    })))
    await expect(outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig)))
      .rejects.toMatchObject({ code: 'PROVIDER_HTTP_ERROR', message: 'speech-dashscope endpoint returned HTTP 429' })
  })

  it('rejects a missing SSE body and invalid or oversized Content-Length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      headers: { 'content-type': 'text/event-stream' },
    })))
    await expect(outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig)))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })

    for (const contentLength of ['not-a-number', '9007199254740992']) {
      vi.stubGlobal('fetch', vi.fn(async () => response([event(sentence([1])), event(stop())], {
        contentType: 'text/event-stream',
        headers: { 'content-length': contentLength },
      })))
      await expect(outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig)))
        .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
    }

    vi.stubGlobal('fetch', vi.fn(async () => response([event(sentence([1])), event(stop())], {
      contentType: 'text/event-stream',
      headers: { 'content-length': String(baseConfig.maxResponseBytes + 1) },
    })))
    await expect(outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig)))
      .rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' })

    vi.stubGlobal('fetch', vi.fn(async () => response([event(sentence([1])), event(stop())], {
      contentType: 'text/event-stream',
      headers: { 'content-length': '1' },
    })))
    const output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig))
    await expect(collect(output.chunks)).resolves.toEqual([[1]])
  })

  it('maps setup timeout and gives caller abort precedence', async () => {
    const waitsForAbort = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal == null) throw new Error('DashScope request requires a signal')
        if (signal.aborted) {
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
          return
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
        }, { once: true })
      }))
    vi.stubGlobal('fetch', waitsForAbort)
    const timed = new DashScopeSpeechSynthesisProvider(context(), { ...baseConfig, timeoutMs: 1 })
    await expect(outputFor(timed)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })

    const abort = new AbortController()
    const reason = new Error('user stopped')
    const aborted = new DashScopeSpeechSynthesisProvider(context(), baseConfig)
    const pending = aborted.synthesize({ text: 'hello' }, abort.signal)
    abort.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it('maps a setup transport failure separately from timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
    await expect(outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig)))
      .rejects.toMatchObject({
        code: 'PROVIDER_TRANSPORT_ERROR',
        message: 'speech-dashscope request failed',
      })
  })

  it('maps response-stream timeout and transport failure', async () => {
    const streamAfterSignal = (signal: AbortSignal): Response => responseBody(new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener('abort', () => { controller.error(signal.reason) }, { once: true })
      },
    }))
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal == null) throw new Error('missing signal')
      return streamAfterSignal(init.signal)
    }))
    let output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), { ...baseConfig, timeoutMs: 1 }))
    await expect(collect(output.chunks)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })

    vi.stubGlobal('fetch', vi.fn(async () => responseBody(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('socket broke')) },
    }))))
    output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig))
    await expect(collect(output.chunks)).rejects.toMatchObject({ code: 'PROVIDER_TRANSPORT_ERROR' })
  })

  it('requires a configured credential and resolves it for every operation', async () => {
    const ctx = new Context()
    const resolve = vi.fn(async () => ({ value: 'rotating-key', source: 'test' }))
    ctx.provide('credentials', { resolve } as never)
    vi.stubGlobal('fetch', vi.fn(async () => response([
      event(sentence([1])), event(stop()),
    ], { contentType: 'text/event-stream' })))
    const provider = new DashScopeSpeechSynthesisProvider(ctx, baseConfig)
    await collect((await outputFor(provider)).chunks)
    await collect((await outputFor(provider)).chunks)
    expect(resolve).toHaveBeenCalledTimes(2)

    const missing = new DashScopeSpeechSynthesisProvider(new Context(), baseConfig)
    await expect(outputFor(missing)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('rejects invalid provider-owned config before any request', () => {
    expect(() => new Config({ ...baseConfig, timeoutMs: 1.5 })).toThrow()
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, maxEventBytes: baseConfig.maxResponseBytes + 1,
    })).toThrow(/maxEventBytes/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, endpoint: 'http://dashscope.example.test',
    })).toThrow(/HTTPS/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, sampleRate: 12345 as never,
    })).toThrow(/sampleRate/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, volume: 10.5,
    })).toThrow(/volume/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, rate: 2.1,
    })).toThrow(/rate/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, languageHints: ['zh', 'zh'],
    })).toThrow(/languageHints/)
  })

  it('materializes defaults and rejects every locally decidable endpoint or limit error', () => {
    const minimal = {
      profile: 'defaulted',
      model: 'model',
      voice: 'voice',
      format: 'mp3' as const,
      maxResponseBytes: 1024,
      maxEventBytes: 512,
    }
    const defaulted = new DashScopeSpeechSynthesisProvider(context(), minimal)
    expect(defaulted).toMatchObject({
      maxInputChars: 4_000,
      maxOutputBytes: 20 * 1024 * 1024,
      mediaType: 'audio/mpeg',
    })

    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, endpoint: 'not a URL',
    })).toThrow(/absolute HTTPS URL/)
    for (const endpoint of [
      'https://user@dashscope.example.test/path',
      'https://:password@dashscope.example.test/path',
      'https://dashscope.example.test/path#fragment',
    ]) {
      expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...baseConfig, endpoint }))
        .toThrow(/without credentials or a fragment/)
    }

    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, maxInputChars: 1.5,
    })).toThrow(/positive safe integer/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, maxInputChars: 0,
    })).toThrow(/positive safe integer/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, timeoutMs: 2_147_483_648,
    })).toThrow(/must not exceed/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, format: 'pcm' as never,
    })).toThrow(/format/)

    for (const volume of [-1, 101]) {
      expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...baseConfig, volume }))
        .toThrow(/volume/)
    }
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, rate: Number.NaN,
    })).toThrow(/rate/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, rate: 0.4,
    })).toThrow(/rate/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, pitch: 2.1,
    })).toThrow(/pitch/)

    for (const field of ['profile', 'model', 'voice'] as const) {
      expect(() => new DashScopeSpeechSynthesisProvider(context(), { ...baseConfig, [field]: ' ' }))
        .toThrow(new RegExp(field))
    }
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, instruction: ' ',
    })).toThrow(/instruction/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, languageHints: ['' as never],
    })).toThrow(/languageHints/)
  })

  it('distinguishes an omitted language hint from invalid present arrays', () => {
    const omitted = new Config(baseConfig)
    expect(omitted.languageHints).toBeUndefined()
    expect(() => new DashScopeSpeechSynthesisProvider(context(), omitted)).not.toThrow()

    const one = new Config({ ...baseConfig, languageHints: ['zh'] })
    expect(one.languageHints).toEqual(['zh'])
    expect(() => new DashScopeSpeechSynthesisProvider(context(), one)).not.toThrow()

    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, languageHints: [],
    })).toThrow(/languageHints/)
    expect(() => new DashScopeSpeechSynthesisProvider(context(), {
      ...baseConfig, languageHints: ['zh', 'en'],
    })).toThrow(/languageHints/)
    expect(() => new Config({
      ...baseConfig, languageHints: ['unsupported' as never],
    })).toThrow()
  })

  it('maps every encoded SSE parser failure through the provider error taxonomy', async () => {
    const invalidUtf8 = new Uint8Array([
      ...encoder.encode('data: '), 0xff, ...encoder.encode('\n\n'),
    ])
    const cases: Array<{
      values: Array<string | Uint8Array>
      config: DashScopeConfig
      code: string
    }> = [
      {
        values: [event(sentence([1])), event(stop())],
        config: { ...baseConfig, maxEventBytes: 8 },
        code: 'PROVIDER_EVENT_TOO_LARGE',
      },
      {
        values: [event(sentence([1])), event(stop())],
        config: { ...baseConfig, maxResponseBytes: 32, maxEventBytes: 32 },
        code: 'PROVIDER_RESPONSE_TOO_LARGE',
      },
      { values: [invalidUtf8], config: baseConfig, code: 'INVALID_PROVIDER_RESPONSE' },
      { values: ['data: {}\n'], config: baseConfig, code: 'INVALID_PROVIDER_RESPONSE' },
    ]
    for (const item of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => response(item.values, { contentType: 'text/event-stream' })))
      const output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), item.config))
      await expect(collect(output.chunks)).rejects.toMatchObject({ code: item.code })
    }
  })

  it('rejects a non-string finish reason and the alternate provider error field', async () => {
    for (const { wire, code } of [
      { wire: event({ output: { finish_reason: 42 } }), code: 'INVALID_PROVIDER_RESPONSE' },
      { wire: event({ error: { code: 'bad-request', message: 'private body' } }), code: 'PROVIDER_ERROR' },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => response([wire], { contentType: 'text/event-stream' })))
      const output = await outputFor(new DashScopeSpeechSynthesisProvider(context(), baseConfig))
      await expect(collect(output.chunks)).rejects.toMatchObject({ code })
    }
  })

  it('registers and disposes its scoped provider through the real synthesis registry', async () => {
    const ctx = new Context()
    ctx.provide('agents', { get: () => undefined } as never)
    await ctx.plugin(SpeechSynthesisRuntime)
    const first = ctx.plugin(DashScopePlugin, baseConfig)
    await first.await()
    const duplicate = ctx.plugin(DashScopePlugin, baseConfig)
    await expect(duplicate).rejects.toThrow(/already registered globally/)
    await duplicate.dispose()
    await first.dispose()
    const replacement = ctx.plugin(DashScopePlugin, baseConfig)
    await replacement.await()
    await replacement.dispose()
  })

  it('registers the package invariant companion', async () => {
    const dispose = vi.fn()
    const fakeCtx = {} as Context
    const register = vi.fn((_packageName, install: (context: Context, fail: (message: string) => never) => void) => {
      install(fakeCtx, (message): never => { throw new Error(message) })
      return dispose
    })
    Object.assign(fakeCtx, { invariants: { register } })
    const unregister = await applyInvariant(fakeCtx)
    expect(invariantName).toBe('speech-dashscope-invariant')
    expect(invariantInject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-speech-dashscope', expect.any(Function))
    unregister()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

function responseBody(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}
