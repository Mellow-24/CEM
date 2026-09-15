import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import type { SpeechTranscriptionProvider } from '@deepseek-ai/dsh-speech-transcription'
import SpeechTranscriptionRuntime from '@deepseek-ai/dsh-speech-transcription'
import SpeechSynthesisRuntime, { SpeechSynthesisError } from '@deepseek-ai/dsh-speech-synthesis'
import type { ConnectionFetchHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import {
  apply,
  Config,
  inject as speechWebInject,
  SPEECH_PROFILE_PATH,
  SPEECH_SYNTHESIZE_PATH,
  SPEECH_TRANSCRIBE_PATH,
} from '@deepseek-ai/dsh-speech-web'
import { describe, expect, it, vi } from 'vitest'

interface Route {
  handler: (request: Request) => Promise<Response>
  options: ConnectionFetchHandlerOptions
}

const INTERRUPTION = {
  confirmationMs: 420,
  minimumMeaningfulCharacters: 3,
  echoMinimumCharacters: 6,
  echoSimilarityThreshold: 0.82,
  backchannelMaximumCharacters: 6,
}

async function harness(options: {
  realtime?: SpeechTranscriptionProvider['openRealtime']
  transcription?: boolean
  synthesis?: boolean
  fallbackSynthesis?: boolean
  synthesisError?: string
  onLanguage?: (language: string | undefined) => void
  config?: NonNullable<Parameters<typeof apply>[1]>
} = {}): Promise<{
  ctx: Context
  agent: Agent
  routes: Map<string, Route>
  spoken: string[]
}> {
  const ctx = new Context()
  const routes = new Map<string, Route>()
  ctx.provide('connection', {
    fetch: {
      handle(path: string, handler: Route['handler'], routeOptions: ConnectionFetchHandlerOptions) {
        routes.set(path, { handler, options: routeOptions })
        return async () => { routes.delete(path) }
      },
    },
  } as never)
  const scope = createScope(ctx, {})
  const session = Session.create(SessionId('voice-session'))
  const live = {
    id: session.id,
    session,
    ctx: scope.ctx,
  } as Agent
  ctx.provide('agents', {
    get: (id: string) => live.id === id ? live : undefined,
    roots: () => [live],
  } as never)
  await ctx.plugin(SystemPrompt)
  if (options.transcription === true) await ctx.plugin(SpeechTranscriptionRuntime)
  if (options.synthesis === true) await ctx.plugin(SpeechSynthesisRuntime)
  const spoken: string[] = []
  if (options.transcription === true) {
    ctx.speechTranscription.registerProvider({
      ...(options.realtime === undefined ? {} : { openRealtime: options.realtime }),
      profile: 'voice',
      mediaTypes: ['audio/webm'],
      maxBytes: 100,
      maxTranscriptChars: 20,
      transcribe: vi.fn(async () => ({ text: 'transcript' })),
    })
  }
  if (options.synthesis === true) {
    ctx.speechSynthesis.registerProvider({
      profile: 'voice',
      mediaType: 'audio/mpeg',
      maxInputChars: 100,
      maxOutputBytes: 100,
      async synthesize({ text, language }) {
        options.onLanguage?.(language)
        if (options.synthesisError !== undefined) {
          throw new SpeechSynthesisError('provider detail omitted by route test', options.synthesisError)
        }
        spoken.push(text)
        return {
          metadata: { mediaType: 'audio/mpeg', contentLength: 2 },
          chunks: (async function* () { yield new Uint8Array([4, 2]) })(),
        }
      },
    })
    if (options.fallbackSynthesis === true) {
      ctx.speechSynthesis.registerProvider({
        profile: 'voice-fallback', mediaType: 'audio/wav', maxInputChars: 100, maxOutputBytes: 100,
        async synthesize({ text }) {
          spoken.push(text)
          return { metadata: { mediaType: 'audio/wav', contentLength: 2 },
            chunks: (async function* () { yield new Uint8Array([8, 4]) })() }
        },
      })
    }
  }
  let speechCtx!: Context
  await ctx.plugin({
    inject: [...speechWebInject],
    apply(pluginCtx) { speechCtx = pluginCtx },
  }).await()
  apply(speechCtx, options.config ?? { maxTranscriptionBodyBytes: 3 })
  return { ctx, agent: live, routes, spoken }
}

function profileRequest(): Request {
  return new Request(`http://dsh.internal${SPEECH_PROFILE_PATH}?sessionId=voice-session`)
}

describe('speech Web Consumer', () => {
  it('advertises call limits only with both operations and requires explicit trusted authority', async () => {
    const call = { defaultGreeting: 'yue', responseInstructions: 'Answer for a live telephone call.', greetings: { yue: { text: '你好。', asset: '@deepseek-ai/dsh-speech-web/greetings/yue.wav' } }, playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, maxPendingAudioMs: 8000, utteranceMergeMs: 10, interruption: INTERRUPTION, sentenceMaxChars: 160, sentenceQueueLimit: 32, responseTimeoutMs: 180000 }
    const enabled = await harness({ transcription: true, synthesis: true, realtime: async () => ({ send: async () => {}, close: async () => {} }), config: { call, authority: 'trusted-host' } })
    const profile = await enabled.routes.get(SPEECH_PROFILE_PATH)!.handler(profileRequest())
    const advertised: unknown = await profile.json()
    expect(advertised).toMatchObject({ call: {
      defaultGreeting: call.defaultGreeting,
      playbackRate: call.playbackRate,
      microphone: call.microphone,
      maxPendingAudioMs: call.maxPendingAudioMs,
      utteranceMergeMs: call.utteranceMergeMs,
      interruption: call.interruption,
      sentenceMaxChars: call.sentenceMaxChars,
      sentenceQueueLimit: call.sentenceQueueLimit,
      responseTimeoutMs: call.responseTimeoutMs,
      greetings: { yue: { text: '你好。', url: '/api/speech/greeting?language=yue&sessionId=voice-session' } },
    } })
    expect(advertised).not.toHaveProperty('call.responseInstructions')
    for (const route of enabled.routes.values()) expect(route.options.authority).toBe('trusted-host')
    const oneSided = await harness({ transcription: true, config: { call } })
    const partial = await oneSided.routes.get(SPEECH_PROFILE_PATH)!.handler(profileRequest())
    expect(await partial.json()).not.toHaveProperty('call')
    for (const route of oneSided.routes.values()) expect(route.options.authority).toBe('loopback')
    expect(() => new Config({ call: { ...call, responseTimeoutMs: 0 } })).toThrow()
    expect(() => new Config({ call: { ...call, utteranceMergeMs: 6001 } })).toThrow()
    expect(() => new Config({ call: { ...call, maxPendingAudioMs: 2050 } })).toThrow()
    expect(() => new Config({ authority: 'public' } as never)).toThrow()
  })

  it('advertises an available fallback while selecting the configured call provider', async () => {
    const call = {
      defaultGreeting: 'yue', responseInstructions: 'Answer for a live telephone call.',
      greetings: { yue: { text: '你好。', asset: '@deepseek-ai/dsh-speech-web/greetings/yue.wav' } },
      playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      maxPendingAudioMs: 8000, utteranceMergeMs: 10, interruption: INTERRUPTION, sentenceMaxChars: 160,
      sentenceQueueLimit: 32, responseTimeoutMs: 180000,
      synthesisProfile: 'voice', fallbackSynthesisProfile: 'voice-fallback',
    }
    const enabled = await harness({
      transcription: true, synthesis: true, fallbackSynthesis: true,
      realtime: async () => ({ send: async () => {}, close: async () => {} }), config: { call },
    })
    const response = await enabled.routes.get(SPEECH_PROFILE_PATH)!.handler(profileRequest())
    await expect(response.json()).resolves.toMatchObject({
      synthesis: { profile: 'voice', mediaType: 'audio/mpeg' },
      call: { fallbackSynthesisProfile: 'voice-fallback' },
    })
  })
  it('serves fixed greetings only to live call-capable sessions without synthesis', async () => {
    const call = { defaultGreeting: 'yue', responseInstructions: 'Answer for a live telephone call.', greetings: { yue: { text: '你好。', asset: '@deepseek-ai/dsh-speech-web/greetings/yue.wav' } }, playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, maxPendingAudioMs: 8000, utteranceMergeMs: 10, interruption: INTERRUPTION, sentenceMaxChars: 160, sentenceQueueLimit: 32, responseTimeoutMs: 1000 }
    const options = { transcription: true, synthesis: true,
      realtime: async () => ({ send: async () => {}, close: async () => {} }), config: { call } }
    const enabled = await harness(options)
    const route = enabled.routes.get('/api/speech/greeting')!
    const request = (query: string, method = 'GET') => route.handler(new Request(`http://dsh.internal/api/speech/greeting?${query}`, { method }))
    const response = await request('sessionId=voice-session&language=yue')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/wav')
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString()).toBe('RIFF')
    expect(enabled.spoken).toEqual([])
    expect((await request('sessionId=absent&language=yue')).status).toBe(404)
    expect((await request('sessionId=voice-session&language=../../secret')).status).toBe(400)
    expect((await request('sessionId=voice-session&language=yue', 'POST')).status).toBe(405)
    const disabled = await harness({ config: { call } })
    expect((await disabled.routes.get('/api/speech/greeting')!.handler(new Request('http://dsh.internal/api/speech/greeting?sessionId=voice-session&language=yue'))).status).toBe(404)
    await expect(harness({ config: { call: { ...call, defaultGreeting: 'missing' } } })).rejects.toThrow('Default call greeting')
  })

  it('reports no capabilities when neither Service Definition is mounted', async () => {
    const { routes } = await harness()
    const response = await routes.get(SPEECH_PROFILE_PATH)!.handler(profileRequest())
    await expect(response.json()).resolves.toEqual({})
  })

  it('reports a transcription-only profile using the effective bridge cap', async () => {
    const { routes } = await harness({ transcription: true })
    const response = await routes.get(SPEECH_PROFILE_PATH)!.handler(profileRequest())
    await expect(response.json()).resolves.toEqual({
      transcription: { profile: 'voice', mediaTypes: ['audio/webm'], maxBytes: 3 },
    })
    expect(routes.get(SPEECH_TRANSCRIBE_PATH)?.options).toMatchObject({
      authority: 'loopback', maxRequestBodyBytes: 3,
    })
  })

  it('reports a synthesis-only profile without treating absent transcription as an error', async () => {
    const { routes } = await harness({ synthesis: true })
    const response = await routes.get(SPEECH_PROFILE_PATH)!.handler(profileRequest())
    await expect(response.json()).resolves.toEqual({
      synthesis: {
        profile: 'voice', mediaType: 'audio/mpeg', maxInputChars: 100, maxOutputBytes: 100,
      },
    })
  })

  it('backstops transcription size before invoking the provider', async () => {
    const { routes } = await harness({ transcription: true })
    const response = await routes.get(SPEECH_TRANSCRIBE_PATH)!.handler(new Request(
      `http://dsh.internal${SPEECH_TRANSCRIBE_PATH}?sessionId=voice-session&profile=voice`,
      {
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
        body: new Uint8Array([1, 2, 3, 4]),
      },
    ))
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AUDIO_TOO_LARGE' } })
  })

  it('streams only text from an append-origin committed assistant message', async () => {
    const { agent, routes, spoken } = await harness({ synthesis: true })
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'first' }, { type: 'reasoning', text: 'private' }, { type: 'text', text: 'second' }],
      source: { provider: 'fixture', model: 'fixture' },
    })
    agent.session.append('assistant/message', { turn: 1, step: 1, message }, {
      surfaceOp: 'append', sourceEventSeqs: [],
    })
    const response = await routes.get(SPEECH_SYNTHESIZE_PATH)!.handler(new Request(
      `http://dsh.internal${SPEECH_SYNTHESIZE_PATH}?sessionId=voice-session&messageId=${message.id}&profile=voice`,
    ))
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('content-length')).toBeNull()
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 2])
    expect(spoken).toEqual(['first\n\nsecond'])
  })

  it('synthesizes historical replies in their logged language rather than the current preference', async () => {
    const onLanguage = vi.fn()
    const { agent, routes } = await harness({ synthesis: true, onLanguage })
    agent.session.append('response-language/resolved', { turn: 1, step: 1, language: 'en', preference: 'auto', basis: 'detected' })
    const message = createAssistantMessage({ content: [{ type: 'text', text: 'Hello.' }], source: { provider: 'fixture', model: 'fixture' } })
    agent.session.append('assistant/message', { turn: 1, step: 1, message }, { surfaceOp: 'append', sourceEventSeqs: [] })
    agent.session.append('response-language/resolved', { turn: 2, step: 1, language: 'pt', preference: 'pt', basis: 'fixed' })
    const response = await routes.get(SPEECH_SYNTHESIZE_PATH)!.handler(new Request(`http://dsh.internal${SPEECH_SYNTHESIZE_PATH}?sessionId=voice-session&messageId=${message.id}`))
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    expect(onLanguage).toHaveBeenCalledWith('en')
  })

  it('streams logged sentence prefixes before commit and rejects altered text, reasoning and other sessions', async () => {
    const { agent, routes, spoken } = await harness({ synthesis: true,
      config: { call: { defaultGreeting: 'yue', responseInstructions: 'Answer for a live telephone call.', greetings: { yue: { text: '你好。', asset: '@deepseek-ai/dsh-speech-web/greetings/yue.wav' } }, playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, maxPendingAudioMs: 8000, utteranceMergeMs: 10, interruption: INTERRUPTION, sentenceMaxChars: 160, sentenceQueueLimit: 32, responseTimeoutMs: 1000 } },
    })
    agent.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })
    agent.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '第一句。第二句' } })
    agent.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 1, blockType: 'reasoning' } })
    agent.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 1, text: 'private' } })
    const query = { sessionId: 'voice-session', profile: 'voice', turn: '1', step: '1', block: '0', start: '0', end: '4', digest: createHash('sha256').update('第一句。').digest('hex') }
    const request = (patch: Record<string, string> = {}) => new Request(`http://dsh.internal/api/speech/synthesize-sentence?${new URLSearchParams({ ...query, ...patch })}`)
    const route = routes.get('/api/speech/synthesize-sentence')!
    const response = await route.handler(request())
    expect(response.status).toBe(200)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 2])
    expect(spoken).toEqual(['第一句。'])
    expect((await route.handler(request({ digest: 'a'.repeat(64) }))).status).toBe(409)
    expect((await route.handler(request({ block: '1', end: '7', digest: createHash('sha256').update('private').digest('hex') }))).status).toBe(409)
    expect((await route.handler(request({ sessionId: 'another-session' }))).status).toBe(404)
    expect((await route.handler(request({ end: '-1' }))).status).toBe(400)
    expect((await route.handler(request({ text: 'unlogged' }))).status).toBe(400)
    agent.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })
    expect((await route.handler(request())).status).toBe(409)
    expect(spoken).toHaveLength(1)
  })

  it('normalizes layout whitespace before synthesizing a call sentence', async () => {
    const { agent, routes, spoken } = await harness({ synthesis: true,
      config: { call: { defaultGreeting: 'yue', responseInstructions: 'Answer for a live telephone call.', greetings: { yue: { text: '你好。', asset: '@deepseek-ai/dsh-speech-web/greetings/yue.wav' } }, playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, maxPendingAudioMs: 8000, utteranceMergeMs: 10, interruption: INTERRUPTION, sentenceMaxChars: 160, sentenceQueueLimit: 32, responseTimeoutMs: 1000 } },
    })
    const text = 'Pay through the CEM App\nwallet for a one-time payment.'
    agent.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })
    agent.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } })
    const query = new URLSearchParams({ sessionId: 'voice-session', profile: 'voice', turn: '1', step: '1', block: '0',
      start: '0', end: String(text.length), digest: createHash('sha256').update(text).digest('hex') })
    const response = await routes.get('/api/speech/synthesize-sentence')!.handler(new Request(`http://dsh.internal/api/speech/synthesize-sentence?${query}`))
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    expect(spoken).toEqual(['Pay through the CEM App wallet for a one-time payment.'])
  })

  it.each([
    ['MISSING_CREDENTIAL', 503],
    ['PROVIDER_ERROR', 502],
    ['PROVIDER_RESPONSE_TOO_LARGE', 502],
    ['AUDIO_TOO_LARGE', 502],
  ] as const)('maps synthesis failure %s to HTTP %s', async (code, status) => {
    const { agent, routes } = await harness({ synthesis: true, synthesisError: code })
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'speakable' }],
      source: { provider: 'fixture', model: 'fixture' },
    })
    agent.session.append('assistant/message', { turn: 1, step: 1, message }, {
      surfaceOp: 'append', sourceEventSeqs: [],
    })
    const response = await routes.get(SPEECH_SYNTHESIZE_PATH)!.handler(new Request(
      `http://dsh.internal${SPEECH_SYNTHESIZE_PATH}?sessionId=voice-session&messageId=${message.id}&profile=voice`,
    ))
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ error: { code } })
  })
})


describe('streaming speech route lifetime', () => {
  it('authorizes live scope, enforces ordered PCM frames, and closes on downlink cancellation', async () => {
    const send = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const b = await harness({ transcription: true, synthesis: true,
      config: { call: { defaultGreeting: 'yue', responseInstructions: 'Answer for a live telephone call.', greetings: { yue: { text: '你好。', asset: '@deepseek-ai/dsh-speech-web/greetings/yue.wav' } }, playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, maxPendingAudioMs: 8000, utteranceMergeMs: 10, interruption: INTERRUPTION, sentenceMaxChars: 160, sentenceQueueLimit: 32, responseTimeoutMs: 1000 } },
      realtime: async () => ({ send, close }),
    })
    const token = 'f5918cc4-b206-47cb-9ba9-e981cc263856'
    const url = `http://dsh.internal/api/speech/realtime?sessionId=voice-session&call=${token}&profile=voice`
    const route = b.routes.get('/api/speech/realtime')!
    const response = await route.handler(new Request(url))
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready')
    expect((await b.ctx.systemPrompt.assemble({ agent: b.agent, scope: b.agent })).contexts)
      .toContainEqual({ name: 'speech-web:active-call', text: 'Answer for a live telephone call.' })
    const profile = await b.routes.get(SPEECH_PROFILE_PATH)!.handler(profileRequest())
    expect(await profile.json()).toMatchObject({ transcription: { realtime: true } })
    expect((await route.handler(new Request(url))).status).toBe(409)
    const upload = b.routes.get('/api/speech/realtime/audio')!
    const frame = (sequence: number, call = token, bytes = 3200) => new Request(
      `http://dsh.internal/api/speech/realtime/audio?sessionId=voice-session&call=${call}&sequence=${sequence}`,
      { method: 'POST', body: new Uint8Array(bytes) },
    )
    expect((await upload.handler(frame(0, 'wrong'))).status).toBe(403)
    expect((await upload.handler(frame(0, token, 2))).status).toBe(400)
    expect((await upload.handler(frame(0, token, 0))).status).toBe(400)
    expect((await upload.handler(frame(0, token, 67200))).status).toBe(400)
    expect((await upload.handler(frame(0))).status).toBe(204)
    expect((await upload.handler(frame(0))).status).toBe(409)
    expect(send).toHaveBeenCalledOnce()
    const racing = await Promise.all([upload.handler(frame(1)), upload.handler(frame(1))])
    expect(racing.map(response => response.status).sort()).toEqual([204, 409])
    expect(send).toHaveBeenCalledTimes(2)
    expect((await upload.handler(frame(2, token, 64000))).status).toBe(204)
    expect(send).toHaveBeenCalledTimes(22)
    expect(send).toHaveBeenLastCalledWith(new Uint8Array(3200))
    let release!: () => void
    send.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { release = resolve }) })
    const batch = upload.handler(frame(3, token, 6400))
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(23) })
    expect((await upload.handler(frame(4))).status).toBe(409)
    release()
    expect((await batch).status).toBe(204)
    expect(send).toHaveBeenCalledTimes(24)
    expect((await upload.handler(frame(4))).status).toBe(204)
    await reader.cancel()
    expect(close).toHaveBeenCalledOnce()
    expect(renderContextSections(await b.ctx.systemPrompt.assemble({ agent: b.agent, scope: b.agent }))).toEqual([])
    expect((await upload.handler(frame(1))).status).toBe(403)
  })
})
