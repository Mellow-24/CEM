/** DashScope Qwen-Audio-TTS SSE provider for `ctx.speechSynthesis`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  SpeechSynthesisError,
  type SpeechSynthesisInput,
  type SpeechSynthesisOutput,
  type SpeechSynthesisProvider,
} from '@deepseek-ai/dsh-speech-synthesis'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { qwenLanguage, streamingWaveHeader } from './qwen.ts'
import { DashScopeSseError, parseDashScopeSse } from './sse.ts'

/** Legacy DashScope SpeechSynthesizer endpoint, still supported by the provider. */
export const DEFAULT_DASHSCOPE_TTS_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'
/** Default credential reference. */
export const DEFAULT_DASHSCOPE_API_KEY_ENV = 'DASHSCOPE_API_KEY'
/** Default provider request deadline. */
export const DEFAULT_DASHSCOPE_TIMEOUT_MS = 120_000
/** Default text-character limit. */
export const DEFAULT_DASHSCOPE_MAX_INPUT_CHARS = 4_000
/** Default decoded audio limit. */
export const DEFAULT_DASHSCOPE_MAX_OUTPUT_BYTES = 20 * 1024 * 1024

/** DashScope output formats accepted by Qwen-Audio-TTS. */
export type DashScopeAudioFormat = 'mp3' | 'wav' | 'opus'
/** DashScope sample rates accepted by Qwen-Audio-TTS. */
export type DashScopeSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000
/** DashScope language-hint codes accepted by Qwen-Audio-TTS. */
export type DashScopeLanguageHint =
  | 'zh' | 'en' | 'fr' | 'de' | 'ja' | 'ko' | 'ru' | 'pt'
  | 'th' | 'id' | 'vi' | 'es' | 'it' | 'ms' | 'fil' | 'ar'

const SAMPLE_RATES: ReadonlySet<number> = new Set([8000, 16000, 22050, 24000, 44100, 48000])
const FORMATS: ReadonlySet<string> = new Set(['mp3', 'wav', 'opus'])
const LANGUAGE_HINTS: ReadonlySet<string> = new Set([
  'zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru', 'pt',
  'th', 'id', 'vi', 'es', 'it', 'ms', 'fil', 'ar',
])
const languageHintSchema = z.union([
  'zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru', 'pt',
  'th', 'id', 'vi', 'es', 'it', 'ms', 'fil', 'ar',
])

function mediaTypeFor(format: DashScopeAudioFormat): ResolvedConfig['mediaType'] {
  switch (format) {
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'opus': return 'audio/ogg'
  }
}

/** DashScope synthesis provider configuration. */
export interface Config {
  /** Wire protocol; Qwen-TTS streams mono 24 kHz PCM wrapped as browser WAV. */
  protocol?: 'speech-synthesizer' | 'qwen-tts'
  /** BCP 47 default when the Consumer supplies no language. */
  defaultLanguage?: string
  /** Qwen-TTS voice overrides keyed by primary BCP 47 language, such as yue, zh, en, pt. */
  voiceByLanguage?: Record<string, string>
  /** Scope-local synthesis profile name. */
  profile: string
  /** DashScope Qwen-Audio-TTS model id. */
  model: string
  /** Provider voice id. */
  voice: string
  /** Provider output format sent verbatim. */
  format: DashScopeAudioFormat
  /** HTTPS synthesis endpoint. */
  endpoint?: string
  /** Credential reference resolved for every operation. */
  apiKeyEnv?: string
  /** Positive integer provider deadline in milliseconds. */
  timeoutMs?: number
  /** Maximum accepted text characters. */
  maxInputChars?: number
  /** Maximum decoded audio bytes across one response. */
  maxOutputBytes?: number
  /** Maximum encoded bytes across the complete SSE response. */
  maxResponseBytes: number
  /** Maximum encoded bytes in one SSE event before its blank separator. */
  maxEventBytes: number
  /** Optional provider sample rate. */
  sampleRate?: DashScopeSampleRate
  /** Optional provider volume control. */
  volume?: number
  /** Optional provider speaking-rate control. */
  rate?: number
  /** Optional provider pitch control. */
  pitch?: number
  /** Optional provider language hints. */
  languageHints?: DashScopeLanguageHint[]
  /** Optional voice instruction. */
  instruction?: string
  /** Whether DashScope adds its generated-content tag. */
  enableAigcTag?: boolean
}

/** Provider plugin config schema. */
export const Config: z<Config> = z.object({
  protocol: z.union(['speech-synthesizer', 'qwen-tts']).default('speech-synthesizer'),
  defaultLanguage: z.string(),
  voiceByLanguage: z.union([z.dict(z.string())]),
  profile: z.string().required(),
  model: z.string().required(),
  voice: z.string().required(),
  format: z.union(['mp3', 'wav', 'opus']).required(),
  endpoint: z.string().default(DEFAULT_DASHSCOPE_TTS_ENDPOINT),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_DASHSCOPE_API_KEY_ENV),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS)
    .default(DEFAULT_DASHSCOPE_TIMEOUT_MS),
  maxInputChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_DASHSCOPE_MAX_INPUT_CHARS),
  maxOutputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_DASHSCOPE_MAX_OUTPUT_BYTES),
  maxResponseBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxEventBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  sampleRate: z.union([8000, 16000, 22050, 24000, 44100, 48000]),
  volume: z.number().step(1).min(0).max(100),
  rate: z.number().min(0.5).max(2),
  pitch: z.number().min(0.5).max(2),
  // A bare array schema defaults to `[]`; the one-arm union keeps omission
  // absent so resolveConfig can distinguish no hint from an invalid empty hint.
  languageHints: z.union([z.array(languageHintSchema)]),
  instruction: z.string(),
  enableAigcTag: z.boolean(),
})

/** Stable Cordis plugin name. */
export const name = 'speech-dashscope'
/** Speech synthesis registry required for provider registration. */
export const inject = ['speechSynthesis']

interface ResolvedConfig {
  readonly protocol: 'speech-synthesizer' | 'qwen-tts'
  readonly defaultLanguage?: string
  readonly voiceByLanguage?: Readonly<Record<string, string>>
  readonly profile: string
  readonly model: string
  readonly voice: string
  readonly format: DashScopeAudioFormat
  readonly mediaType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg'
  readonly endpoint: URL
  readonly apiKeyEnv: CredentialRef
  readonly timeoutMs: number
  readonly maxInputChars: number
  readonly maxOutputBytes: number
  readonly maxResponseBytes: number
  readonly maxEventBytes: number
  readonly sampleRate?: DashScopeSampleRate
  readonly volume?: number
  readonly rate?: number
  readonly pitch?: number
  readonly languageHints?: readonly DashScopeLanguageHint[]
  readonly instruction?: string
  readonly enableAigcTag?: boolean
}

function requireNonEmpty(name: string, value: string): string {
  if (value.trim() === '') throw new Error(`speech-dashscope ${name} must be non-empty`)
  return value
}

function resolveConfig(config: Config): ResolvedConfig {
  const protocol = config.protocol ?? 'speech-synthesizer'
  if (!(['speech-synthesizer', 'qwen-tts'] as readonly unknown[]).includes(protocol)) throw new Error('speech-dashscope protocol is unsupported')
  if (protocol === 'qwen-tts') {
    if (config.format !== 'wav' || config.sampleRate !== 24000 || config.endpoint === undefined) {
      throw new Error('Qwen-TTS requires an explicit endpoint, WAV format and sampleRate 24000')
    }
    if ((config.maxOutputBytes ?? DEFAULT_DASHSCOPE_MAX_OUTPUT_BYTES) < 46) throw new Error('Qwen-TTS maxOutputBytes must fit WAV headers and PCM')
    if ((config.maxInputChars ?? DEFAULT_DASHSCOPE_MAX_INPUT_CHARS) > 600) throw new Error('Qwen-TTS maxInputChars must not exceed 600')
    if (config.instruction !== undefined || config.rate !== undefined || config.volume !== undefined
      || config.pitch !== undefined || config.languageHints !== undefined || config.enableAigcTag !== undefined) {
      throw new Error('Qwen-TTS does not accept SpeechSynthesizer-only controls')
    }
  } else if (config.defaultLanguage !== undefined || config.voiceByLanguage !== undefined) {
    throw new Error('Language voice routing requires the qwen-tts protocol')
  }
  if (config.defaultLanguage !== undefined) qwenLanguage(config.defaultLanguage)
  for (const [language, voice] of Object.entries(config.voiceByLanguage ?? {})) {
    if (language !== language.split('-')[0]) throw new Error('Voice language keys must be primary BCP 47 codes')
    qwenLanguage(language)
    requireNonEmpty('voiceByLanguage entry', voice)
  }
  let endpoint: URL
  try {
    endpoint = new URL(config.endpoint ?? DEFAULT_DASHSCOPE_TTS_ENDPOINT)
  } catch (error) {
    throw new Error('speech-dashscope endpoint must be an absolute HTTPS URL', { cause: error })
  }
  const loopback = endpoint.protocol === 'http:'
    && (endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost')
  if ((endpoint.protocol !== 'https:' && !loopback) || endpoint.username !== '' || endpoint.password !== ''
    || endpoint.hash !== '') {
    throw new Error('speech-dashscope endpoint must be HTTPS, or loopback HTTP, without credentials or a fragment')
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_DASHSCOPE_TIMEOUT_MS
  const maxInputChars = config.maxInputChars ?? DEFAULT_DASHSCOPE_MAX_INPUT_CHARS
  const maxOutputBytes = config.maxOutputBytes ?? DEFAULT_DASHSCOPE_MAX_OUTPUT_BYTES
  for (const [field, value] of [
    ['timeoutMs', timeoutMs],
    ['maxInputChars', maxInputChars],
    ['maxOutputBytes', maxOutputBytes],
    ['maxResponseBytes', config.maxResponseBytes],
    ['maxEventBytes', config.maxEventBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`speech-dashscope ${field} must be a positive safe integer`)
    }
  }
  if (timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`speech-dashscope timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  if (config.maxEventBytes > config.maxResponseBytes) {
    throw new Error('speech-dashscope maxEventBytes must not exceed maxResponseBytes')
  }
  if (!FORMATS.has(config.format)) {
    throw new Error('speech-dashscope format is unsupported')
  }
  if (config.sampleRate !== undefined && !SAMPLE_RATES.has(config.sampleRate)) {
    throw new Error('speech-dashscope sampleRate is unsupported')
  }
  if (config.volume !== undefined
    && (!Number.isInteger(config.volume) || config.volume < 0 || config.volume > 100)) {
    throw new Error('speech-dashscope volume must be an integer from 0 through 100')
  }
  for (const [field, value] of [['rate', config.rate], ['pitch', config.pitch]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0.5 || value > 2)) {
      throw new Error(`speech-dashscope ${field} must be within 0.5..2.0`)
    }
  }
  const languageHints = config.languageHints?.map(hint =>
    requireNonEmpty('languageHints entry', hint) as DashScopeLanguageHint)
  const languageHint = languageHints?.[0]
  if (languageHints !== undefined
    && (languageHints.length !== 1 || languageHint === undefined || !LANGUAGE_HINTS.has(languageHint))) {
    throw new Error('speech-dashscope languageHints must contain exactly one supported language code')
  }
  const instruction = config.instruction === undefined
    ? undefined
    : requireNonEmpty('instruction', config.instruction)
  return Object.freeze({
    protocol,
    ...config.defaultLanguage === undefined ? {} : { defaultLanguage: config.defaultLanguage },
    ...config.voiceByLanguage === undefined ? {} : { voiceByLanguage: Object.freeze({ ...config.voiceByLanguage }) },
    profile: requireNonEmpty('profile', config.profile),
    model: requireNonEmpty('model', config.model),
    voice: requireNonEmpty('voice', config.voice),
    format: config.format,
    mediaType: mediaTypeFor(config.format),
    endpoint,
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_DASHSCOPE_API_KEY_ENV),
    timeoutMs,
    maxInputChars,
    maxOutputBytes,
    maxResponseBytes: config.maxResponseBytes,
    maxEventBytes: config.maxEventBytes,
    ...config.sampleRate === undefined ? {} : { sampleRate: config.sampleRate },
    ...config.volume === undefined ? {} : { volume: config.volume },
    ...config.rate === undefined ? {} : { rate: config.rate },
    ...config.pitch === undefined ? {} : { pitch: config.pitch },
    ...languageHints === undefined ? {} : { languageHints: Object.freeze(languageHints) },
    ...instruction === undefined ? {} : { instruction },
    ...config.enableAigcTag === undefined ? {} : { enableAigcTag: config.enableAigcTag },
  })
}

interface DashScopeInput {
  text: string
  voice: string
  format: string
  sample_rate?: number
  volume?: number
  rate?: number
  pitch?: number
  language_hints?: readonly string[]
  instruction?: string
  enable_aigc_tag?: boolean
}

/** DashScope Qwen-Audio-TTS provider implementation. */
export class DashScopeSpeechSynthesisProvider implements SpeechSynthesisProvider {
  readonly profile: string
  readonly mediaType: string
  readonly maxInputChars: number
  readonly maxOutputBytes: number
  private readonly config: ResolvedConfig

  /**
   * @param ctx - credential-resolution context.
   * @param config - provider profile and response limits.
   */
  constructor(private readonly ctx: Context, config: Config) {
    this.config = resolveConfig(config)
    this.profile = this.config.profile
    this.mediaType = this.config.mediaType
    this.maxInputChars = this.config.maxInputChars
    this.maxOutputBytes = this.config.maxOutputBytes
  }

  /**
   * Start one DashScope synthesis request and expose its decoded audio events.
   * @param input - admitted final text.
   * @param signal - caller cancellation propagated through setup and streaming.
   * @returns provider metadata and a single-pass decoded audio stream.
   */
  async synthesize(input: SpeechSynthesisInput, signal: AbortSignal): Promise<SpeechSynthesisOutput> {
    signal.throwIfAborted()
    const credential = await this.ctx.get('credentials')?.resolve(this.config.apiKeyEnv)
    signal.throwIfAborted()
    if (credential === undefined) {
      throw new SpeechSynthesisError(
        `speech-dashscope credential reference ${JSON.stringify(String(this.config.apiKeyEnv))} is not configured`,
        'MISSING_CREDENTIAL',
      )
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const requestSignal = AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${credential.value}`,
          'content-type': 'application/json',
          'x-dashscope-sse': 'enable',
        },
        body: JSON.stringify({
          model: this.config.model,
          input: this.requestInput(input),
        }),
        redirect: 'error',
        signal: requestSignal,
      })
    } catch (error) {
      signal.throwIfAborted()
      if (timeout.aborted) {
        throw new SpeechSynthesisError(
          'speech-dashscope request timed out',
          'PROVIDER_TIMEOUT',
          { cause: error },
        )
      }
      throw new SpeechSynthesisError(
        'speech-dashscope request failed',
        'PROVIDER_TRANSPORT_ERROR',
        { cause: error },
      )
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new SpeechSynthesisError(
        `speech-dashscope endpoint returned HTTP ${response.status}`,
        'PROVIDER_HTTP_ERROR',
      )
    }
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'text/event-stream' || response.body === null) {
      await response.body?.cancel()
      throw new SpeechSynthesisError(
        'speech-dashscope endpoint did not return a text/event-stream body',
        'INVALID_PROVIDER_RESPONSE',
      )
    }
    const declaredLength = response.headers.get('content-length')
    if (declaredLength !== null) {
      if (!/^\d+$/.test(declaredLength) || !Number.isSafeInteger(Number(declaredLength))) {
        await response.body.cancel()
        throw new SpeechSynthesisError(
          'speech-dashscope endpoint returned an invalid Content-Length',
          'INVALID_PROVIDER_RESPONSE',
        )
      }
      if (Number(declaredLength) > this.config.maxResponseBytes) {
        await response.body.cancel()
        throw new SpeechSynthesisError(
          'speech-dashscope SSE response exceeds maxResponseBytes',
          'PROVIDER_RESPONSE_TOO_LARGE',
        )
      }
    }
    return {
      metadata: {
        mediaType: this.mediaType,
        ...this.config.sampleRate === undefined ? {} : { sampleRateHz: this.config.sampleRate },
      },
      chunks: this.audioChunks(response.body, signal, timeout, requestSignal),
    }
  }

  private requestInput(input: SpeechSynthesisInput): DashScopeInput | { text: string; voice: string; language_type: string } {
    const { text } = input
    if (this.config.protocol === 'qwen-tts') {
      const language = input.language ?? this.config.defaultLanguage
      const primary = language?.split('-')[0]
      return { text, voice: (primary === undefined ? undefined : this.config.voiceByLanguage?.[primary]) ?? this.config.voice,
        language_type: language === undefined ? 'Auto' : qwenLanguage(language) }
    }
    return {
      text,
      voice: this.config.voice,
      format: this.config.format,
      ...this.config.sampleRate === undefined ? {} : { sample_rate: this.config.sampleRate },
      ...this.config.volume === undefined ? {} : { volume: this.config.volume },
      ...this.config.rate === undefined ? {} : { rate: this.config.rate },
      ...this.config.pitch === undefined ? {} : { pitch: this.config.pitch },
      ...this.config.languageHints === undefined ? {} : { language_hints: this.config.languageHints },
      ...this.config.instruction === undefined ? {} : { instruction: this.config.instruction },
      ...this.config.enableAigcTag === undefined ? {} : { enable_aigc_tag: this.config.enableAigcTag },
    }
  }

  private async *audioChunks(
    source: AsyncIterable<Uint8Array>,
    callerSignal: AbortSignal,
    timeout: AbortSignal,
    requestSignal: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    let audioBytes = this.config.protocol === 'qwen-tts' ? 44 : 0
    let audioSeen = false
    try {
      for await (const data of parseDashScopeSse(source, {
        maxResponseBytes: this.config.maxResponseBytes,
        maxEventBytes: this.config.maxEventBytes,
      }, requestSignal)) {
        const event = parseEvent(data)
        if (event.providerError) {
          throw new SpeechSynthesisError(
            'speech-dashscope endpoint reported a provider error',
            'PROVIDER_ERROR',
          )
        }
        const output = event.output
        if (output === undefined) {
          throw new SpeechSynthesisError(
            'speech-dashscope SSE event has no output object',
            'INVALID_PROVIDER_RESPONSE',
          )
        }
        if (output.type !== undefined && typeof output.type !== 'string') {
          invalidEvent()
        }
        if (output.type === 'sentence-synthesis' || this.config.protocol === 'qwen-tts') {
          const audio = asRecord(output.audio)
          if (audio === undefined || typeof audio.data !== 'string') invalidEvent()
          if (audio.data !== '' || this.config.protocol !== 'qwen-tts') {
            const chunk = decodeBase64(audio.data, this.maxOutputBytes - audioBytes)
            if (this.config.protocol === 'qwen-tts') {
              if (chunk.byteLength % 2 !== 0) invalidEvent()
              if (!audioSeen) yield streamingWaveHeader()
            }
            audioBytes += chunk.byteLength
            audioSeen = true
            yield chunk
          }
        }
        const finishReason = output.finish_reason
        if (finishReason !== undefined && finishReason !== null && finishReason !== 'null') {
          if (typeof finishReason !== 'string') invalidEvent()
          if (finishReason !== 'stop') {
            throw new SpeechSynthesisError(
              'speech-dashscope endpoint ended synthesis with a provider error',
              'PROVIDER_ERROR',
            )
          }
          if (!audioSeen) invalidEvent()
          return
        }
      }
      throw new SpeechSynthesisError(
        'speech-dashscope SSE ended without finish_reason stop',
        'INVALID_PROVIDER_RESPONSE',
      )
    } catch (error) {
      if (error instanceof SpeechSynthesisError) throw error
      if (error instanceof DashScopeSseError) {
        const [message, code] = sseFailure(error)
        throw new SpeechSynthesisError(
          message,
          code,
          { cause: error },
        )
      }
      callerSignal.throwIfAborted()
      if (timeout.aborted) {
        throw new SpeechSynthesisError(
          'speech-dashscope request timed out',
          'PROVIDER_TIMEOUT',
          { cause: error },
        )
      }
      throw new SpeechSynthesisError(
        'speech-dashscope response stream failed',
        'PROVIDER_TRANSPORT_ERROR',
        { cause: error },
      )
    }
  }
}

interface ParsedEvent {
  readonly output?: Record<string, unknown>
  readonly providerError: boolean
}

function parseEvent(data: string): ParsedEvent {
  let value: unknown
  try {
    value = JSON.parse(data) as unknown
  } catch (error) {
    throw new SpeechSynthesisError(
      'speech-dashscope SSE data is not valid JSON',
      'INVALID_PROVIDER_RESPONSE',
      { cause: error },
    )
  }
  const record = asRecord(value)
  if (record === undefined) invalidEvent()
  const output = asRecord(record.output)
  return {
    providerError: (record.code !== undefined && record.code !== '') || record.error !== undefined
      || (record.status_code !== undefined && record.status_code !== 200),
    ...output === undefined ? {} : { output },
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function invalidEvent(): never {
  throw new SpeechSynthesisError(
    'speech-dashscope SSE event has invalid response fields',
    'INVALID_PROVIDER_RESPONSE',
  )
}

function decodeBase64(value: string, remainingBytes: number): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new SpeechSynthesisError(
      'speech-dashscope SSE audio is not canonical Base64',
      'INVALID_PROVIDER_RESPONSE',
    )
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const decodedLength = value.length / 4 * 3 - padding
  if (decodedLength > remainingBytes) {
    throw new SpeechSynthesisError(
      'speech-dashscope decoded audio exceeds maxOutputBytes',
      'AUDIO_TOO_LARGE',
    )
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new SpeechSynthesisError(
      'speech-dashscope SSE audio is not canonical Base64',
      'INVALID_PROVIDER_RESPONSE',
    )
  }
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength)
}

function sseFailure(error: DashScopeSseError): readonly [string, string] {
  switch (error.code) {
    case 'SSE_EVENT_TOO_LARGE':
      return ['speech-dashscope SSE event exceeds maxEventBytes', 'PROVIDER_EVENT_TOO_LARGE']
    case 'SSE_RESPONSE_TOO_LARGE':
      return ['speech-dashscope SSE response exceeds maxResponseBytes', 'PROVIDER_RESPONSE_TOO_LARGE']
    case 'SSE_INVALID_UTF8':
      return ['speech-dashscope SSE contains invalid UTF-8', 'INVALID_PROVIDER_RESPONSE']
    case 'SSE_TRUNCATED':
      return ['speech-dashscope SSE ended before an event separator', 'INVALID_PROVIDER_RESPONSE']
  }
}

/**
 * Register one DashScope provider in the calling Context's synthesis scope.
 * @param ctx - mounting preset context.
 * @param config - validated DashScope profile and response limits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.speechSynthesis.registerProvider(new DashScopeSpeechSynthesisProvider(ctx, config))
}
