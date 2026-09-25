/** Optional HTTP providers for the speech transcription and synthesis services. */

import type { Context } from '@deepseek-ai/cordis'
import { openQwenRealtime, type QwenRealtimeConfig } from './realtime.ts'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  SpeechTranscriptionError,
  type SpeechTranscript,
  type SpeechTranscriptionInput,
  type SpeechTranscriptionProvider,
} from '@deepseek-ai/dsh-speech-transcription'
import {
  SpeechSynthesisError,
  type SpeechSynthesisInput,
  type SpeechSynthesisOutput,
  type SpeechSynthesisProvider,
} from '@deepseek-ai/dsh-speech-synthesis'

/** Shared HTTP endpoint and optional credential-reference config. */
export interface SpeechHttpEndpointConfig {
  /** Scope-local profile name registered in the owning speech service. */
  profile: string
  /** Absolute HTTP or HTTPS operation URL. */
  url: string
  /** Credential reference resolved immediately before every HTTP request. */
  apiKeyEnv?: string
  /** Header receiving the resolved credential; defaults to `authorization`. */
  apiKeyHeader?: string
  /** Prefix prepended to the credential; defaults to `Bearer `. */
  apiKeyPrefix?: string
  /** Provider request timeout in milliseconds. */
  timeoutMs: number
}

/** Complete-recording HTTP transcription profile. */
export interface SpeechHttpTranscriptionConfig extends SpeechHttpEndpointConfig {
  /** Wire protocol; Qwen accepts a Base64 data URL through chat completions. */
  protocol?: 'raw' | 'qwen-asr'
  /** Required model id for the Qwen protocol. */
  model?: string
  /** Optional streaming Qwen ASR endpoint and VAD settings. */
  realtime?: QwenRealtimeConfig
  /** Accepted lowercase base media types. */
  mediaTypes: string[]
  /** Maximum encoded recording bytes. */
  maxBytes: number
  /** Maximum transcript characters accepted from the endpoint. */
  maxTranscriptChars: number
  /** Maximum encoded JSON response bytes read before parsing. */
  maxResponseBytes: number
}

/** Streaming HTTP synthesis profile. */
export interface SpeechHttpSynthesisConfig extends SpeechHttpEndpointConfig {
  /** Expected response media type. */
  mediaType: string
  /** Maximum input characters. */
  maxInputChars: number
  /** Maximum streamed response bytes. */
  maxOutputBytes: number
  /** JSON field carrying text; defaults to `text`. */
  textField?: string
  /** Non-secret static JSON fields sent beside the text. */
  body?: Record<string, string | number | boolean>
}

/** Optional provider registrations; an absent section registers nothing. */
export interface Config {
  /** Complete-recording transcription provider; omission registers none. */
  transcription?: SpeechHttpTranscriptionConfig
  /** Streaming synthesis provider; omission registers none. */
  synthesis?: SpeechHttpSynthesisConfig
}

const endpointConfig = {
  profile: z.string().required(),
  url: z.string().required(),
  apiKeyEnv: z.string().role('credential-ref'),
  apiKeyHeader: z.string(),
  apiKeyPrefix: z.string(),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
}

const transcriptionConfig: z<SpeechHttpTranscriptionConfig> = z.object({
  ...endpointConfig,
  protocol: z.union(['raw', 'qwen-asr']).default('raw'),
  model: z.string(),
  realtime: z.union([z.object({
    url: z.string().required(),
    model: z.string().required(),
    silenceMs: z.number().step(1).min(200).max(2000).required(),
    threshold: z.number().min(0).max(1).required(),
    traditionalChineseOutput: z.boolean(),
    maxDurationMs: z.number().step(1).min(1000).max(MAX_TIMER_DELAY_MS).required(),
    maxBufferedBytes: z.number().step(1).min(3200).max(1048576).required(),
  })]),
  mediaTypes: z.array(z.string()).required(),
  maxBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxTranscriptChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxResponseBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

const synthesisConfig: z<SpeechHttpSynthesisConfig> = z.object({
  ...endpointConfig,
  mediaType: z.string().required(),
  maxInputChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxOutputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  textField: z.string().default('text'),
  body: z.dict(z.union([z.string(), z.number(), z.boolean()])),
})

/** Provider plugin config. */
export const Config: z<Config> = z.object({
  // A bare object schema defaults to `{}` in schemastery. The one-arm union
  // keeps omission absent so a preset can enable only one speech capability.
  transcription: z.union([transcriptionConfig]),
  synthesis: z.union([synthesisConfig]),
})

/** Stable Cordis plugin name. */
export const name = 'speech-http'
/** Registries are optional because each independently optional config section installs its own child injection. */
export const inject: string[] = []

interface ResolvedEndpoint {
  readonly profile: string
  readonly url: URL
  readonly apiKey?: {
    readonly ref: CredentialRef
    readonly header: string
    readonly prefix: string
  }
  readonly timeoutMs: number
}

/** Resolve and validate one endpoint without reading a credential value. */
function resolveEndpoint(config: SpeechHttpEndpointConfig): ResolvedEndpoint {
  if (config.profile.trim() === '') throw new Error('speech-http profile must be non-empty')
  let url: URL
  try {
    url = new URL(config.url)
  } catch (error) {
    throw new Error('speech-http url must be an absolute HTTP or HTTPS URL', { cause: error })
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== '' || url.password !== '') {
    throw new Error('speech-http url must use HTTP or HTTPS and must not contain credentials')
  }
  let apiKey: ResolvedEndpoint['apiKey']
  if (config.apiKeyEnv !== undefined) {
    const header = (config.apiKeyHeader ?? 'authorization').trim().toLowerCase()
    if (header === '') throw new Error('speech-http apiKeyHeader must be non-empty')
    try {
      new Headers({ [header]: 'probe' })
    } catch (error) {
      throw new Error('speech-http apiKeyHeader is not a valid HTTP header name', { cause: error })
    }
    apiKey = {
      ref: credentialRef(config.apiKeyEnv),
      header,
      prefix: config.apiKeyPrefix ?? 'Bearer ',
    }
  }
  return {
    profile: config.profile,
    url,
    timeoutMs: config.timeoutMs,
    ...apiKey === undefined ? {} : { apiKey },
  }
}

async function requestHeaders(
  ctx: Context,
  endpoint: ResolvedEndpoint,
  initial: HeadersInit,
): Promise<Headers> {
  const headers = new Headers(initial)
  const key = endpoint.apiKey
  if (key === undefined) return headers
  const credential = await ctx.get('credentials')?.resolve(key.ref)
  if (credential === undefined) {
    throw new Error(`speech-http credential reference ${JSON.stringify(String(key.ref))} is not configured`)
  }
  headers.set(key.header, `${key.prefix}${credential.value}`)
  return headers
}

/** HTTP provider for complete-recording transcription responses shaped as `{ text, language? }`. */
export class HttpSpeechTranscriptionProvider implements SpeechTranscriptionProvider {
  readonly profile: string
  readonly mediaTypes: readonly string[]
  readonly maxBytes: number
  readonly maxTranscriptChars: number
  private readonly maxResponseBytes: number
  private readonly endpoint: ResolvedEndpoint
  private readonly qwenModel: string | undefined
  readonly openRealtime?: NonNullable<SpeechTranscriptionProvider['openRealtime']>

  /** @param ctx - credential-resolution context. @param config - validated profile config. */
  constructor(private readonly ctx: Context, config: SpeechHttpTranscriptionConfig) {
    this.endpoint = resolveEndpoint(config)
    this.profile = this.endpoint.profile
    this.mediaTypes = Object.freeze([...config.mediaTypes])
    this.maxBytes = config.maxBytes
    this.maxTranscriptChars = config.maxTranscriptChars
    this.maxResponseBytes = config.maxResponseBytes
    if (config.protocol === 'qwen-asr' && !config.model?.trim()) {
      throw new Error('speech-http qwen-asr requires a non-empty model')
    }
    this.qwenModel = config.protocol === 'qwen-asr' ? config.model : undefined
    if (config.realtime !== undefined) {
      const realtime = config.realtime
      const url = new URL(realtime.url)
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || !realtime.model.trim()) {
        throw new Error('Qwen realtime requires a WebSocket URL without credentials and a model')
      }
      this.openRealtime = async (event, signal) => {
        const headers = await requestHeaders(this.ctx, this.endpoint, { 'OpenAI-Beta': 'realtime=v1' })
        signal.throwIfAborted()
        return await openQwenRealtime(realtime, Object.fromEntries(headers), this.endpoint.timeoutMs,
          this.maxResponseBytes, this.maxTranscriptChars, event, signal)
      }
    }
  }

  async transcribe(input: SpeechTranscriptionInput, signal: AbortSignal): Promise<SpeechTranscript> {
    const timeout = AbortSignal.timeout(this.endpoint.timeoutMs)
    const requestSignal = AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetch(this.endpoint.url, {
        method: 'POST',
        headers: await requestHeaders(this.ctx, this.endpoint, {
          'content-type': this.qwenModel === undefined ? input.mediaType : 'application/json',
        }),
        body: this.qwenModel === undefined ? Buffer.from(input.data) : JSON.stringify({
          model: this.qwenModel,
          messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: {
            data: `data:${input.mediaType};base64,${Buffer.from(input.data).toString('base64')}`,
          } }] }],
          stream: false,
          asr_options: { enable_itn: true },
        }),
        signal: requestSignal,
        redirect: 'error',
      })
    } catch (error) {
      signal.throwIfAborted()
      if (timeout.aborted) {
        throw new SpeechTranscriptionError(
          'speech-http transcription request timed out',
          'PROVIDER_TIMEOUT',
          { cause: error },
        )
      }
      throw new SpeechTranscriptionError(
        'speech-http transcription request failed',
        'PROVIDER_TRANSPORT_ERROR',
        { cause: error },
      )
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new SpeechTranscriptionError(
        `speech-http transcription endpoint returned HTTP ${response.status}`,
        'PROVIDER_HTTP_ERROR',
      )
    }
    const responseMediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (responseMediaType !== 'application/json') {
      await response.body?.cancel()
      throw new SpeechTranscriptionError(
        'speech-http transcription endpoint must return application/json',
        'INVALID_PROVIDER_RESPONSE',
      )
    }
    let value: unknown
    try {
      value = await readBoundedJson(response, this.maxResponseBytes, requestSignal)
    } catch (error) {
      if (error instanceof SpeechTranscriptionError) throw error
      signal.throwIfAborted()
      if (timeout.aborted) {
        throw new SpeechTranscriptionError(
          'speech-http transcription request timed out',
          'PROVIDER_TIMEOUT',
          { cause: error },
        )
      }
      throw new SpeechTranscriptionError(
        'speech-http transcription response stream failed',
        'PROVIDER_TRANSPORT_ERROR',
        { cause: error },
      )
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new SpeechTranscriptionError(
        'speech-http transcription endpoint must return a JSON object',
        'INVALID_PROVIDER_RESPONSE',
      )
    }
    if (this.qwenModel !== undefined) return qwenTranscript(value)
    const record = value as Record<string, unknown>
    if (typeof record.text !== 'string'
      || (record.language !== undefined && typeof record.language !== 'string')) {
      throw new SpeechTranscriptionError(
        'speech-http transcription endpoint requires string text and optional string language fields',
        'INVALID_PROVIDER_RESPONSE',
      )
    }
    return {
      text: record.text,
      ...record.language === undefined ? {} : { language: record.language },
    }
  }
}

/** Validate final Qwen chat-completion output before returning transcript text. */
function qwenTranscript(value: object): SpeechTranscript {
  const record = value as Record<string, unknown>
  const choice: unknown = Array.isArray(record.choices) ? record.choices[0] : undefined
  if (typeof choice === 'object' && choice !== null && 'finish_reason' in choice
    && choice.finish_reason === 'stop' && 'message' in choice) {
    const message = choice.message
    if (typeof message === 'object' && message !== null && 'content' in message
      && typeof message.content === 'string') return { text: message.content }
  }
  throw new SpeechTranscriptionError(
    'speech-http Qwen response requires a completed choice with string message.content',
    'INVALID_PROVIDER_RESPONSE',
  )
}

async function readBoundedJson(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (response.body === null) {
    throw new SpeechTranscriptionError(
      'speech-http transcription endpoint returned no JSON body',
      'INVALID_PROVIDER_RESPONSE',
    )
  }
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))) {
      await response.body.cancel()
      throw new SpeechTranscriptionError(
        'speech-http transcription endpoint returned an invalid Content-Length',
        'INVALID_PROVIDER_RESPONSE',
      )
    }
    if (Number(declared) > maxResponseBytes) {
      await response.body.cancel()
      throw new SpeechTranscriptionError(
        'speech-http transcription endpoint response exceeds maxResponseBytes',
        'PROVIDER_RESPONSE_TOO_LARGE',
      )
    }
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of response.body) {
    signal.throwIfAborted()
    bytes += chunk.byteLength
    if (bytes > maxResponseBytes) {
      await response.body.cancel().catch(() => {})
      throw new SpeechTranscriptionError(
        'speech-http transcription endpoint response exceeds maxResponseBytes',
        'PROVIDER_RESPONSE_TOO_LARGE',
      )
    }
    chunks.push(chunk.slice())
  }
  signal.throwIfAborted()
  let text: string
  try {
    const complete = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      complete.set(chunk, offset)
      offset += chunk.byteLength
    }
    text = new TextDecoder('utf-8', { fatal: true }).decode(complete)
  } catch (error) {
    throw new SpeechTranscriptionError(
      'speech-http transcription endpoint returned invalid UTF-8',
      'INVALID_PROVIDER_RESPONSE',
      { cause: error },
    )
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new SpeechTranscriptionError(
      'speech-http transcription endpoint returned invalid JSON',
      'INVALID_PROVIDER_RESPONSE',
      { cause: error },
    )
  }
}

/** HTTP provider whose JSON request receives text and whose response body is encoded audio. */
export class HttpSpeechSynthesisProvider implements SpeechSynthesisProvider {
  readonly profile: string
  readonly mediaType: string
  readonly maxInputChars: number
  readonly maxOutputBytes: number
  private readonly endpoint: ResolvedEndpoint
  private readonly textField: string
  private readonly body: Readonly<Record<string, string | number | boolean>>

  /** @param ctx - credential-resolution context. @param config - validated profile config. */
  constructor(private readonly ctx: Context, config: SpeechHttpSynthesisConfig) {
    this.endpoint = resolveEndpoint(config)
    this.profile = this.endpoint.profile
    this.mediaType = config.mediaType
    this.maxInputChars = config.maxInputChars
    this.maxOutputBytes = config.maxOutputBytes
    this.textField = config.textField ?? 'text'
    validateJsonField('textField', this.textField)
    for (const key of Object.keys(config.body ?? {})) validateJsonField('body field', key)
    if (Object.hasOwn(config.body ?? {}, this.textField)) {
      throw new Error(`speech-http synthesis body must not define reserved textField ${JSON.stringify(this.textField)}`)
    }
    this.body = Object.freeze({ ...config.body })
  }

  async synthesize(input: SpeechSynthesisInput, signal: AbortSignal): Promise<SpeechSynthesisOutput> {
    const timeout = AbortSignal.timeout(this.endpoint.timeoutMs)
    const requestSignal = AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetch(this.endpoint.url, {
        method: 'POST',
        headers: await requestHeaders(this.ctx, this.endpoint, { 'content-type': 'application/json' }),
        body: JSON.stringify({ ...this.body, [this.textField]: input.text }),
        signal: requestSignal,
        redirect: 'error',
      })
    } catch (error) {
      signal.throwIfAborted()
      if (timeout.aborted) {
        throw new SpeechSynthesisError(
          'speech-http synthesis request timed out',
          'PROVIDER_TIMEOUT',
          { cause: error },
        )
      }
      throw new SpeechSynthesisError(
        'speech-http synthesis request failed',
        'PROVIDER_TRANSPORT_ERROR',
        { cause: error },
      )
    }
    if (!response.ok || response.body === null) {
      await response.body?.cancel()
      throw new SpeechSynthesisError(
        `speech-http synthesis endpoint returned HTTP ${response.status} without a usable audio body`,
        'PROVIDER_HTTP_ERROR',
      )
    }
    const responseMediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (responseMediaType === undefined || responseMediaType !== this.mediaType) {
      await response.body.cancel()
      throw new SpeechSynthesisError(
        `speech-http synthesis endpoint returned content type ${JSON.stringify(responseMediaType)} instead of ${JSON.stringify(this.mediaType)}`,
        'INVALID_PROVIDER_RESPONSE',
      )
    }
    const rawLength = response.headers.get('content-length')
    const contentLength = rawLength === null ? undefined : Number(rawLength)
    return {
      metadata: {
        mediaType: this.mediaType,
        ...contentLength === undefined ? {} : { contentLength },
      },
      chunks: synthesisChunks(response.body, signal, timeout),
    }
  }
}

async function* synthesisChunks(
  source: AsyncIterable<Uint8Array>,
  callerSignal: AbortSignal,
  timeout: AbortSignal,
): AsyncIterable<Uint8Array> {
  try {
    for await (const chunk of source) yield chunk
  } catch (error) {
    callerSignal.throwIfAborted()
    if (timeout.aborted) {
      throw new SpeechSynthesisError(
        'speech-http synthesis request timed out',
        'PROVIDER_TIMEOUT',
        { cause: error },
      )
    }
    throw new SpeechSynthesisError(
      'speech-http synthesis response stream failed',
      'PROVIDER_TRANSPORT_ERROR',
      { cause: error },
    )
  }
}

function validateJsonField(subject: string, value: string): void {
  if (value.trim() === '' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`speech-http synthesis ${subject} must be a non-empty JSON field without control characters`)
  }
}

/** Register each configured HTTP profile in its independently optional service. */
export function apply(ctx: Context, config: Config): void {
  if (config.transcription !== undefined) {
    const transcription = config.transcription
    ctx.inject(['speechTranscription'], (speechCtx) => {
      speechCtx.speechTranscription.registerProvider(new HttpSpeechTranscriptionProvider(speechCtx, transcription))
    })
  }
  if (config.synthesis !== undefined) {
    const synthesis = config.synthesis
    ctx.inject(['speechSynthesis'], (speechCtx) => {
      speechCtx.speechSynthesis.registerProvider(new HttpSpeechSynthesisProvider(speechCtx, synthesis))
    })
  }
}
