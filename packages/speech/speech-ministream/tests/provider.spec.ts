import { Context } from '@deepseek-ai/cordis'
import SpeechSynthesisRuntime from '@deepseek-ai/dsh-speech-synthesis'
import { createServer, type Server as NetServer } from 'node:net'
import { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Config,
  MiniStreamSpeechSynthesisProvider,
  apply,
  type Config as MiniStreamConfig,
} from '../src/index.ts'

const servers: WebSocketServer[] = []
const netServers: NetServer[] = []
const baseConfig = {
  profile: 'customer-service',
  endpoint: 'ws://127.0.0.1:1/tts/{client_id}',
  apiKeyEnv: 'MINISTREAM_TOKEN',
  defaultLanguage: 'yue',
  voicePresetKey: 'mailinlin',
  voicePresetByLanguage: { zh: 'zh_daily_female', en: 'en_jennifer', pt: 'pt_sofia' },
  generationMode: 'preset_voice',
  maxGenerateLength: 500,
  normalize: true,
  timeoutMs: 1_000,
  firstAudioTimeoutMs: 500,
  connectionIdleTimeoutMs: 5_000,
  maxIdleConnectionsPerVoice: 1,
  maxInputChars: 600,
  maxOutputBytes: 100,
  maxEventBytes: 1_000,
} satisfies MiniStreamConfig

function context(token = 'trial-token'): Context {
  const ctx = new Context()
  ctx.provide('credentials', { resolve: vi.fn(async () => ({ value: token, source: 'test' })) } as never)
  return ctx
}

async function server(): Promise<{ server: WebSocketServer; endpoint: string }> {
  const instance = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  servers.push(instance)
  await new Promise<void>((resolve) => { instance.once('listening', resolve) })
  const address = instance.address()
  if (typeof address === 'string' || address === null) throw new Error('WebSocket server did not expose a port')
  return { server: instance, endpoint: `ws://127.0.0.1:${String(address.port)}/tts/{client_id}` }
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<number[]> {
  const chunks: Uint8Array[] = []
  for await (const chunk of source) chunks.push(chunk)
  return [...Buffer.concat(chunks)]
}

afterEach(async () => {
  for (const instance of servers.splice(0)) {
    for (const client of instance.clients) client.terminate()
    await new Promise<void>((resolve) => { instance.close(() => { resolve() }) })
  }
  for (const instance of netServers.splice(0)) {
    await new Promise<void>((resolve) => { instance.close(() => { resolve() }) })
  }
})

describe('MiniStream speech provider', () => {
  it.each([
    ['yue-Hant-MO', 'mailinlin'], ['zh-Hans', 'zh_daily_female'],
    ['en', 'en_jennifer'], ['pt', 'pt_sofia'],
  ])('routes %s to its preset voice and streams MP3 frames', async (language, expectedVoice) => {
    const harness = await server()
    let requestUrl: URL | undefined
    let authorization: string | undefined
    harness.server.on('connection', (socket, request) => {
      requestUrl = new URL(request.url ?? '', 'ws://127.0.0.1')
      authorization = request.headers.authorization
      socket.on('message', (data) => {
        const message = JSON.parse(Buffer.from(data as ArrayBuffer).toString()) as { request_id: string; text: string }
        expect(message.text).toBe('客服测试。')
        socket.send(JSON.stringify({ type: 'start', request_id: message.request_id, format: 'mp3', sample_rate: 48000, channels: 1 }))
        socket.send(new Uint8Array([73, 68, 51, 4]), { binary: true })
        socket.send(JSON.stringify({ type: 'end', request_id: message.request_id }))
      })
    })
    const provider = new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, endpoint: harness.endpoint })
    const output = await provider.synthesize({ text: '客服测试。', language }, new AbortController().signal)
    await expect(collect(output.chunks)).resolves.toEqual([73, 68, 51, 4])
    expect(output.metadata).toEqual({ mediaType: 'audio/mpeg', sampleRateHz: 48000, channels: 1 })
    expect(authorization).toBe('Bearer trial-token')
    expect(requestUrl?.searchParams.get('language')).toBe(language.split('-')[0])
    expect(requestUrl?.searchParams.get('generation_mode')).toBe('preset_voice')
    expect(requestUrl?.searchParams.get('voice_preset_key')).toBe(expectedVoice)
    expect(requestUrl?.searchParams.get('buffer')).toBe('off')
  })

  it('rejects malformed lifecycle events and bounded audio overflow', async () => {
    const invalid = await server()
    invalid.server.on('connection', (socket) => { socket.on('message', (data) => {
      const request = JSON.parse(Buffer.from(data as ArrayBuffer).toString()) as { request_id: string }
      socket.send(JSON.stringify({ type: 'start', request_id: request.request_id,
        format: 'wav', sample_rate: 24000, channels: 2 }))
    }) })
    const first = new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, endpoint: invalid.endpoint })
    const invalidOutput = await first.synthesize({ text: '测试' }, new AbortController().signal)
    await expect(collect(invalidOutput.chunks)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })

    const excessive = await server()
    excessive.server.on('connection', (socket) => { socket.on('message', (data) => {
      const request = JSON.parse(Buffer.from(data as ArrayBuffer).toString()) as { request_id: string }
      socket.send(JSON.stringify({ type: 'start', request_id: request.request_id,
        format: 'mp3', sample_rate: 48000, channels: 1 }))
      socket.send(new Uint8Array([1, 2, 3]), { binary: true })
    }) })
    const second = new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, endpoint: excessive.endpoint, maxOutputBytes: 2 })
    const excessiveOutput = await second.synthesize({ text: '测试' }, new AbortController().signal)
    await expect(collect(excessiveOutput.chunks)).rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE' })
  })

  it('propagates cancellation and rejects missing credentials', async () => {
    const harness = await server()
    harness.server.on('connection', (socket) => { socket.on('message', () => {}) })
    const provider = new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, endpoint: harness.endpoint })
    const abort = new AbortController()
    const output = await provider.synthesize({ text: '测试' }, abort.signal)
    const reading = collect(output.chunks)
    await vi.waitFor(() => { expect(harness.server.clients.size).toBe(1) })
    abort.abort()
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    const missing = new MiniStreamSpeechSynthesisProvider(new Context(), baseConfig)
    await expect(missing.synthesize({ text: '测试' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    await expect(provider.synthesize({ text: 'bonjour', language: 'fr' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'PROFILE_UNAVAILABLE' })
  })

  it('contains the terminal socket error when cancellation interrupts the opening handshake', async () => {
    let accepted!: () => void
    const connected = new Promise<void>((resolve) => { accepted = resolve })
    const instance = createServer((socket) => {
      socket.once('data', () => { accepted() })
    })
    netServers.push(instance)
    await new Promise<void>((resolve) => { instance.listen(0, '127.0.0.1', resolve) })
    const address = instance.address()
    if (typeof address === 'string' || address === null) throw new Error('TCP server did not expose a port')
    const provider = new MiniStreamSpeechSynthesisProvider(context(), {
      ...baseConfig,
      endpoint: `ws://127.0.0.1:${String(address.port)}/tts/{client_id}`,
    })
    const abort = new AbortController()
    const output = await provider.synthesize({ text: '测试' }, abort.signal)
    const reading = collect(output.chunks)

    await connected
    abort.abort()

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  })

  it('reuses one authenticated socket for sequential operations and closes it on disposal', async () => {
    const harness = await server()
    let connections = 0
    harness.server.on('connection', (socket) => {
      connections++
      socket.on('message', (data) => {
        const request = JSON.parse(Buffer.from(data as ArrayBuffer).toString()) as { request_id: string }
        socket.send(JSON.stringify({ type: 'start', request_id: request.request_id,
          format: 'mp3', sample_rate: 48000, channels: 1 }))
        socket.send(new Uint8Array([1, 2]), { binary: true })
        socket.send(JSON.stringify({ type: 'end', request_id: request.request_id }))
      })
    })
    const provider = new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, endpoint: harness.endpoint })
    const first = await provider.synthesize({ text: '第一句。' }, new AbortController().signal)
    await expect(collect(first.chunks)).resolves.toEqual([1, 2])
    const second = await provider.synthesize({ text: '第二句。' }, new AbortController().signal)
    await expect(collect(second.chunks)).resolves.toEqual([1, 2])
    expect(connections).toBe(1)
    provider.dispose()
    await vi.waitFor(() => { expect(harness.server.clients.size).toBe(0) })
  })

  it('fails quickly when generation stalls after start and classifies exhausted capacity', async () => {
    const stalled = await server()
    stalled.server.on('connection', (socket) => { socket.on('message', (data) => {
      const request = JSON.parse(Buffer.from(data as ArrayBuffer).toString()) as { request_id: string }
      socket.send(JSON.stringify({ type: 'start', request_id: request.request_id,
        format: 'mp3', sample_rate: 48000, channels: 1 }))
    }) })
    const first = new MiniStreamSpeechSynthesisProvider(context(), {
      ...baseConfig, endpoint: stalled.endpoint, firstAudioTimeoutMs: 20,
    })
    const stalledOutput = await first.synthesize({ text: '测试' }, new AbortController().signal)
    await expect(collect(stalledOutput.chunks)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })

    const busy = await server()
    busy.server.on('connection', (socket) => { socket.on('message', () => {
      socket.send(JSON.stringify({ code: 429, state: 'busy', result: 'capacity exhausted' }))
    }) })
    const second = new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, endpoint: busy.endpoint })
    const busyOutput = await second.synthesize({ text: '测试' }, new AbortController().signal)
    await expect(collect(busyOutput.chunks)).rejects.toMatchObject({ code: 'PROVIDER_BUSY' })
  })

  it('validates config and registers through a scoped effect', async () => {
    expect(() => new Config({ ...baseConfig, generationMode: 'random_voice' } as never)).toThrow()
    expect(() => new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, endpoint: 'https://example.com/tts/{client_id}' }))
      .toThrow(/WSS/)
    expect(() => new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, endpoint: 'wss://user@example.com/tts/{client_id}' }))
      .toThrow(/WSS/)
    expect(() => new MiniStreamSpeechSynthesisProvider(context(), { ...baseConfig, firstAudioTimeoutMs: 1_001 }))
      .toThrow(/firstAudioTimeoutMs/)
    const ctx = new Context()
    ctx.provide('agents', { get: () => undefined } as never)
    ctx.provide('credentials', { resolve: async () => ({ value: 'trial-token', source: 'test' }) } as never)
    await ctx.plugin(SpeechSynthesisRuntime)
    const first = ctx.plugin({ name: 'ministream-test', inject: ['credentials', 'speechSynthesis'], apply }, baseConfig)
    await first.await()
    const duplicate = ctx.plugin({ name: 'ministream-test-duplicate', inject: ['credentials', 'speechSynthesis'], apply }, baseConfig)
    await expect(duplicate).rejects.toThrow(/already registered globally/)
    await duplicate.dispose()
    await first.dispose()
  })
})
