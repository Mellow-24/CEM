import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import SpeechTranscriptionRuntime from '@deepseek-ai/dsh-speech-transcription'
import {
  Config,
  HttpSpeechSynthesisProvider,
  HttpSpeechTranscriptionProvider,
  type SpeechHttpSynthesisConfig,
  type SpeechHttpTranscriptionConfig,
} from '@deepseek-ai/dsh-speech-http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const transcriptionConfig: SpeechHttpTranscriptionConfig = {
  profile: 'voice',
  url: 'https://speech.example/transcribe',
  apiKeyEnv: 'SPEECH_KEY',
  mediaTypes: ['audio/webm'],
  maxBytes: 10,
  maxTranscriptChars: 5,
  maxResponseBytes: 100,
  timeoutMs: 1_000,
}

const synthesisConfig: SpeechHttpSynthesisConfig = {
  profile: 'voice',
  url: 'https://speech.example/synthesize',
  apiKeyEnv: 'SPEECH_KEY',
  mediaType: 'audio/mpeg',
  maxInputChars: 20,
  maxOutputBytes: 20,
  textField: 'input',
  body: { voice: 'trained' },
  timeoutMs: 1_000,
}

function context(): Context {
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'secret', source: 'test' }),
  } as never)
  return ctx
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('speech HTTP providers', () => {
  it('rejects fractional provider timeouts at the config boundary', () => {
    expect(() => new Config({
      transcription: { ...transcriptionConfig, timeoutMs: 1.5 },
    })).toThrow()
  })

  it('keeps independently omitted provider sections absent', () => {
    const transcriptionOnly = new Config({ transcription: transcriptionConfig })
    expect(transcriptionOnly.transcription).toMatchObject({ profile: 'voice' })
    expect(transcriptionOnly.synthesis).toBeUndefined()

    const synthesisOnly = new Config({ synthesis: synthesisConfig })
    expect(synthesisOnly.transcription).toBeUndefined()
    expect(synthesisOnly.synthesis).toMatchObject({ profile: 'voice' })
  })

  it('sends recording bytes without following credential-bearing redirects', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ text: 'hello', language: 'zh-HK' }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new HttpSpeechTranscriptionProvider(context(), transcriptionConfig)
    await expect(provider.transcribe({
      data: new Uint8Array([1, 2]), mediaType: 'audio/webm',
    }, new AbortController().signal)).resolves.toEqual({ text: 'hello', language: 'zh-HK' })
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(Buffer.from([1, 2]))
  })

  it('posts configured synthesis JSON and requires the declared audio content type', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new HttpSpeechSynthesisProvider(context(), synthesisConfig)
    const output = await provider.synthesize({ text: 'hello' }, new AbortController().signal)
    expect(output.metadata).toEqual({ mediaType: 'audio/mpeg' })
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body
    if (typeof requestBody !== 'string') throw new Error('synthesis request body must be JSON text')
    expect(JSON.parse(requestBody)).toEqual({ voice: 'trained', input: 'hello' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))))
    await expect(provider.synthesize({ text: 'hello' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
  })

  it('normalizes redirect and transport refusal without exposing endpoint details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('redirect mode is error') }))
    const transcription = new HttpSpeechTranscriptionProvider(context(), transcriptionConfig)
    await expect(transcription.transcribe({
      data: new Uint8Array([1]), mediaType: 'audio/webm',
    }, new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_TRANSPORT_ERROR',
      message: 'speech-http transcription request failed',
    })
    const synthesis = new HttpSpeechSynthesisProvider(context(), synthesisConfig)
    await expect(synthesis.synthesize({ text: 'hello' }, new AbortController().signal))
      .rejects.toMatchObject({
        code: 'PROVIDER_TRANSPORT_ERROR',
        message: 'speech-http synthesis request failed',
      })
  })

  it('bounds both provider requests with their configured timeout', async () => {
    const waitsForAbort = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal == null) throw new Error('provider request must carry a signal')
        const activeSignal = signal
        if (activeSignal.aborted) {
          reject(activeSignal.reason instanceof Error ? activeSignal.reason : new Error(String(activeSignal.reason)))
          return
        }
        activeSignal.addEventListener('abort', () => {
          reject(activeSignal.reason instanceof Error ? activeSignal.reason : new Error(String(activeSignal.reason)))
        }, { once: true })
      }))
    vi.stubGlobal('fetch', waitsForAbort)
    const transcription = new HttpSpeechTranscriptionProvider(context(), {
      ...transcriptionConfig, timeoutMs: 1,
    })
    await expect(transcription.transcribe({
      data: new Uint8Array([1]), mediaType: 'audio/webm',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
    const synthesis = new HttpSpeechSynthesisProvider(context(), {
      ...synthesisConfig, timeoutMs: 1,
    })
    await expect(synthesis.synthesize({ text: 'hello' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
  })

  it('bounds transcription JSON before decoding a giant single chunk or accumulated chunks', async () => {
    const response = (chunks: number[][]): Response => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
        controller.close()
      },
    }), { headers: { 'content-type': 'application/json' } })
    const provider = new HttpSpeechTranscriptionProvider(context(), {
      ...transcriptionConfig,
      maxResponseBytes: 5,
    })
    vi.stubGlobal('fetch', vi.fn(async () => response([[1, 2, 3, 4, 5, 6]])))
    await expect(provider.transcribe({
      data: new Uint8Array([1]), mediaType: 'audio/webm',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' })

    vi.stubGlobal('fetch', vi.fn(async () => response([[1, 2, 3], [4, 5, 6]])))
    await expect(provider.transcribe({
      data: new Uint8Array([1]), mediaType: 'audio/webm',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' })
  })

  it('rejects invalid UTF-8 before JSON parsing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff]), {
      headers: { 'content-type': 'application/json' },
    })))
    const provider = new HttpSpeechTranscriptionProvider(context(), transcriptionConfig)
    await expect(provider.transcribe({
      data: new Uint8Array([1]), mediaType: 'audio/webm',
    }, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
      message: 'speech-http transcription endpoint returned invalid UTF-8',
    })
  })

  it('rejects unsafe or colliding synthesis JSON fields at construction', () => {
    expect(() => new HttpSpeechSynthesisProvider(context(), {
      ...synthesisConfig, textField: '\n',
    })).toThrow(/textField/)
    expect(() => new HttpSpeechSynthesisProvider(context(), {
      ...synthesisConfig, body: { input: 'collision' },
    })).toThrow(/reserved textField/)
    expect(() => new HttpSpeechSynthesisProvider(context(), {
      ...synthesisConfig, body: { ['bad\nkey']: 'x' },
    })).toThrow(/body field/)
  })

  it('lets the transcription runtime reject an oversized endpoint transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ text: '123456' })))
    const ctx = context()
    const scope = createScope(ctx, {})
    const live = { id: SessionId('voice'), ctx: scope.ctx } as Agent
    ctx.provide('agents', { get: (id: string) => live.id === id ? live : undefined } as never)
    await ctx.plugin(SpeechTranscriptionRuntime)
    ctx.speechTranscription.registerProvider(new HttpSpeechTranscriptionProvider(ctx, transcriptionConfig))
    await expect(ctx.speechTranscription.resolve(live).transcribe({
      data: new Uint8Array([1]), mediaType: 'audio/webm',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'TRANSCRIPT_TOO_LARGE' })
  })
})

describe('Qwen ASR protocol', () => {
  it('encodes audio as a data URL and accepts only a complete final transcript', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '你好' } }] }))
    vi.stubGlobal('fetch', fetcher)
    const provider = new HttpSpeechTranscriptionProvider(context(), {
      ...transcriptionConfig, protocol: 'qwen-asr', model: 'qwen3-asr-flash', maxResponseBytes: 1024,
    })
    await expect(provider.transcribe({ data: new Uint8Array([1, 2]), mediaType: 'audio/webm' }, new AbortController().signal)).resolves.toEqual({ text: '你好' })
    const request = fetcher.mock.calls[0]![1]!
    expect(new Headers(request.headers).get('content-type')).toBe('application/json')
    expect(request.redirect).toBe('error')
    expect(JSON.parse(request.body as string)).toEqual({
      model: 'qwen3-asr-flash', stream: false, asr_options: { enable_itn: true },
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/webm;base64,AQI=' } }] }],
    })
    for (const value of [ {}, { choices: [] }, { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, { choices: [{ finish_reason: 'stop', message: { content: [] } }] } ]) {
      fetcher.mockResolvedValueOnce(Response.json(value))
      await expect(provider.transcribe({ data: new Uint8Array([1]), mediaType: 'audio/webm' }, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
    }
  })

  it('rejects Qwen configuration without a model before provider IO', () => {
    expect(() => new HttpSpeechTranscriptionProvider(context(), { ...transcriptionConfig, protocol: 'qwen-asr' })).toThrow('requires a non-empty model')
  })
})
