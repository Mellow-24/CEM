/** MiniStream preset-voice WebSocket provider for progressive MP3 synthesis. */

import WebSocket from 'ws'
import type { RawData } from 'ws'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  SpeechSynthesisError,
  type SpeechSynthesisInput,
  type SpeechSynthesisOutput,
  type SpeechSynthesisProvider,
} from '@deepseek-ai/dsh-speech-synthesis'

/** Stable Cordis plugin name. */
export const name = 'speech-ministream'
/** Credentials and the synthesis registry are required. */
export const inject = ['credentials', 'speechSynthesis']

/** Default server-side credential reference. */
export const DEFAULT_MINISTREAM_TOKEN_ENV = 'MINISTREAM_TTS_TOKEN'

/** One preset-voice MiniStream profile. */
export interface Config {
  /** Scope-local synthesis profile name. */
  profile: string
  /** WebSocket URL containing one `{client_id}` placeholder. */
  endpoint: string
  /** Credential reference resolved before each connection. */
  apiKeyEnv?: string
  /** Default BCP 47 language when the Consumer provides none. */
  defaultLanguage: string
  /** Default preset voice key. */
  voicePresetKey: string
  /** Preset voice overrides keyed by primary BCP 47 language. */
  voicePresetByLanguage?: Record<string, string>
  /** Provider generation mode. */
  generationMode: 'preset_voice'
  /** Provider-side maximum generation length. */
  maxGenerateLength: number
  /** Whether the provider normalizes input text. */
  normalize: boolean
  /** WebSocket connection and response deadline. */
  timeoutMs: number
  /** Maximum wait from request start to the first non-empty MP3 frame. */
  firstAudioTimeoutMs: number
  /** Maximum wait for the peer to acknowledge a normal WebSocket close. */
  closeHandshakeTimeoutMs: number
  /** Maximum accepted text characters. */
  maxInputChars: number
  /** Maximum queued and emitted MP3 bytes. */
  maxOutputBytes: number
  /** Maximum bytes in one WebSocket frame. */
  maxEventBytes: number
  /** Whether TLS certificate verification remains enabled. */
  tlsRejectUnauthorized?: boolean
}

/** MiniStream provider config schema. */
export const Config: z<Config> = z.object({
  profile: z.string().required(),
  endpoint: z.string().required(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_MINISTREAM_TOKEN_ENV),
  defaultLanguage: z.string().required(),
  voicePresetKey: z.string().required(),
  voicePresetByLanguage: z.union([z.dict(z.string())]),
  generationMode: z.const('preset_voice').required(),
  maxGenerateLength: z.number().step(1).min(1).max(500).required(),
  normalize: z.boolean().required(),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).required(),
  firstAudioTimeoutMs: z.number().step(1).min(1).max(2_147_483_647).required(),
  closeHandshakeTimeoutMs: z.number().step(1).min(1).max(2_147_483_647).required(),
  maxInputChars: z.number().step(1).min(1).max(1000).required(),
  maxOutputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxEventBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  tlsRejectUnauthorized: z.boolean().default(true),
})

interface ResolvedConfig extends Omit<Config, 'apiKeyEnv' | 'voicePresetByLanguage' | 'tlsRejectUnauthorized'> {
  readonly apiKeyEnv: CredentialRef
  readonly voicePresetByLanguage: Readonly<Record<string, string>>
  readonly tlsRejectUnauthorized: boolean
}

function nonEmpty(field: string, value: string): string {
  if (value.trim() === '') throw new Error(`speech-ministream ${field} must be non-empty`)
  return value
}

function resolveConfig(config: Config): ResolvedConfig {
  if (config.firstAudioTimeoutMs > config.timeoutMs) {
    throw new Error('speech-ministream firstAudioTimeoutMs must not exceed timeoutMs')
  }
  if (config.endpoint.split('{client_id}').length !== 2) {
    throw new Error('speech-ministream endpoint must contain exactly one {client_id} placeholder')
  }
  const endpoint = new URL(config.endpoint.replace('{client_id}', 'client-id'))
  const loopback = endpoint.protocol === 'ws:' && (endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost')
  if ((endpoint.protocol !== 'wss:' && !loopback) || endpoint.username !== '' || endpoint.password !== ''
    || endpoint.hash !== '' || !endpoint.pathname.includes('client-id')) {
    throw new Error('speech-ministream endpoint must be WSS, or loopback WS, with one {client_id} placeholder')
  }
  const voicePresetByLanguage = Object.freeze({ ...config.voicePresetByLanguage })
  for (const [language, voice] of Object.entries(voicePresetByLanguage)) {
    if (language !== language.split('-')[0]) throw new Error('MiniStream voice language keys must be primary BCP 47 codes')
    nonEmpty('voicePresetByLanguage entry', voice)
  }
  return Object.freeze({
    profile: nonEmpty('profile', config.profile),
    endpoint: config.endpoint,
    generationMode: config.generationMode,
    maxGenerateLength: config.maxGenerateLength,
    normalize: config.normalize,
    timeoutMs: config.timeoutMs,
    firstAudioTimeoutMs: config.firstAudioTimeoutMs,
    closeHandshakeTimeoutMs: config.closeHandshakeTimeoutMs,
    maxInputChars: config.maxInputChars,
    maxOutputBytes: config.maxOutputBytes,
    maxEventBytes: config.maxEventBytes,
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_MINISTREAM_TOKEN_ENV),
    defaultLanguage: nonEmpty('defaultLanguage', config.defaultLanguage),
    voicePresetKey: nonEmpty('voicePresetKey', config.voicePresetKey),
    voicePresetByLanguage,
    tlsRejectUnauthorized: config.tlsRejectUnauthorized ?? true,
  })
}

/** MiniStream progressive MP3 synthesis provider. */
export class MiniStreamSpeechSynthesisProvider implements SpeechSynthesisProvider {
  readonly profile: string
  readonly mediaType = 'audio/mpeg'
  readonly maxInputChars: number
  readonly maxOutputBytes: number
  private readonly config: ResolvedConfig

  /**
   * @param ctx - credential-resolution context.
   * @param config - provider endpoint, voice routing, and limits.
   */
  constructor(private readonly ctx: Context, config: Config) {
    this.config = resolveConfig(config)
    this.profile = this.config.profile
    this.maxInputChars = this.config.maxInputChars
    this.maxOutputBytes = this.config.maxOutputBytes
  }

  /**
   * Open one authenticated WebSocket and expose its binary MP3 frames.
   * @param input - Consumer-admitted text and optional response language.
   * @param signal - caller cancellation.
   * @returns progressive mono 48 kHz MP3 output.
   */
  async synthesize(input: SpeechSynthesisInput, signal: AbortSignal): Promise<SpeechSynthesisOutput> {
    signal.throwIfAborted()
    const credential = await this.ctx.get('credentials')?.resolve(this.config.apiKeyEnv)
    signal.throwIfAborted()
    if (credential === undefined) {
      throw new SpeechSynthesisError(
        `speech-ministream credential reference ${JSON.stringify(String(this.config.apiKeyEnv))} is not configured`,
        'MISSING_CREDENTIAL',
      )
    }
    const language = input.language ?? this.config.defaultLanguage
    const primary = language.split('-')[0] as string
    const defaultPrimary = this.config.defaultLanguage.split('-')[0]
    const voice = primary === defaultPrimary
      ? this.config.voicePresetKey
      : this.config.voicePresetByLanguage[primary]
    if (voice === undefined) {
      throw new SpeechSynthesisError(`MiniStream language ${JSON.stringify(language)} is unavailable`, 'PROFILE_UNAVAILABLE')
    }
    const requestId = crypto.randomUUID()
    const clientId = crypto.randomUUID()
    const url = new URL(this.config.endpoint.replace('{client_id}', encodeURIComponent(clientId)))
    url.searchParams.set('language', primary)
    url.searchParams.set('generation_mode', this.config.generationMode)
    url.searchParams.set('voice_preset_key', voice)
    url.searchParams.set('max_generate_length', String(this.config.maxGenerateLength))
    url.searchParams.set('normalize', String(this.config.normalize))
    url.searchParams.set('buffer', 'off')
    const chunks = streamAudio(url, credential.value, input.text, requestId, this.config, signal)
    return { metadata: { mediaType: this.mediaType, sampleRateHz: 48_000, channels: 1 }, chunks }
  }
}

async function* streamAudio(
  url: URL, token: string, text: string, requestId: string, config: ResolvedConfig, signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  signal.throwIfAborted()
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
    handshakeTimeout: config.timeoutMs,
    maxPayload: config.maxEventBytes,
    followRedirects: false,
    rejectUnauthorized: config.tlsRejectUnauthorized,
  })
  // Cancellation can terminate CONNECTING before the one-shot open listeners settle.
  // Retain an error owner until close completes so the terminal `ws` event stays local.
  const containTerminalError = (): void => {}
  socket.on('error', containTerminalError)
  const deadlineAbort = new AbortController()
  const deadline = setTimeout(() => { deadlineAbort.abort() }, config.timeoutMs)
  const operationSignal = AbortSignal.any([signal, deadlineAbort.signal])
  try {
    await openSocket(socket, operationSignal)
    yield* operationChunks(socket, text, requestId, config, operationSignal)
  } catch (error) {
    signal.throwIfAborted()
    if (deadlineAbort.signal.aborted) {
      throw new SpeechSynthesisError('MiniStream synthesis timed out', 'PROVIDER_TIMEOUT')
    }
    throw error
  } finally {
    clearTimeout(deadline)
    await closeSocket(socket, config.closeHandshakeTimeoutMs)
    socket.off('error', containTerminalError)
  }
}

async function openSocket(socket: WebSocket, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      socket.removeEventListener('open', opened)
      socket.removeEventListener('error', failed)
      socket.removeEventListener('close', closed)
      signal.removeEventListener('abort', aborted)
    }
    const opened = (): void => { cleanup(); resolve() }
    const failed = (): void => {
      cleanup()
      reject(new SpeechSynthesisError('MiniStream connection failed', 'PROVIDER_TRANSPORT_ERROR'))
    }
    const closed = (): void => {
      cleanup()
      reject(new SpeechSynthesisError('MiniStream connection closed during handshake', 'PROVIDER_TRANSPORT_ERROR'))
    }
    const aborted = (): void => {
      cleanup()
      socket.terminate()
      reject(signal.reason instanceof Error ? signal.reason : new Error('MiniStream connection aborted'))
    }
    socket.addEventListener('open', opened, { once: true })
    socket.addEventListener('error', failed, { once: true })
    socket.addEventListener('close', closed, { once: true })
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
  signal.throwIfAborted()
}

async function closeSocket(socket: WebSocket, timeoutMs: number): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return
  await new Promise<void>((resolve) => {
    const closed = (): void => {
      clearTimeout(timer)
      socket.removeEventListener('close', closed)
      resolve()
    }
    socket.addEventListener('close', closed, { once: true })
    const timer = setTimeout(() => {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
    }, timeoutMs)
    timer.unref()
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
    else if (socket.readyState === WebSocket.OPEN) socket.close(1000)
    else if (socket.readyState === WebSocket.CLOSED) { closed(); return }
  })
}

async function* operationChunks(
  socket: WebSocket, text: string, requestId: string, config: ResolvedConfig, signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  let started = false
  let done = false
  let error: SpeechSynthesisError | undefined
  let bytes = 0
  let firstAudioSeen = false
  const pending: Uint8Array[] = []
  let wake = (): void => {}
  const notify = (): void => { wake(); wake = () => {} }
  const fail = (message: string, code: string): void => {
    if (done) return
    done = true
    error = new SpeechSynthesisError(message, code)
    notify()
  }
  const abort = (): void => { fail('MiniStream synthesis was cancelled', 'PROVIDER_TRANSPORT_ERROR') }
  const firstAudioDeadline = setTimeout(() => {
    fail('MiniStream did not produce audio in time', 'PROVIDER_TIMEOUT')
  }, config.firstAudioTimeoutMs)
  signal.addEventListener('abort', abort, { once: true })
  socket.send(JSON.stringify({ type: 'synthesize', text, request_id: requestId }), (sendError) => {
    if (sendError) fail('MiniStream synthesis request failed', 'PROVIDER_TRANSPORT_ERROR')
  })
  const message = (data: RawData, binary: boolean): void => {
    if (done) return
    if (binary) {
      if (!started) { fail('MiniStream sent audio before its start event', 'INVALID_PROVIDER_RESPONSE'); return }
      const chunk = new Uint8Array(rawData(data))
      if (chunk.byteLength === 0) return
      if (!firstAudioSeen) { firstAudioSeen = true; clearTimeout(firstAudioDeadline) }
      bytes += chunk.byteLength
      if (bytes > config.maxOutputBytes) { fail('MiniStream audio exceeds maxOutputBytes', 'AUDIO_TOO_LARGE'); return }
      pending.push(chunk)
      notify()
      return
    }
    try {
      const event: unknown = JSON.parse(rawData(data).toString('utf8'))
      if (typeof event !== 'object' || event === null) throw new Error('invalid event')
      const record = event as Record<string, unknown>
      if (record['code'] === 429 || record['code'] === '429') {
        fail('MiniStream realtime capacity is unavailable', 'PROVIDER_BUSY')
        return
      }
      if (!('type' in record)) throw new Error('missing event type')
      if (record['request_id'] !== requestId) throw new Error('wrong request')
      if (record['type'] === 'start' && !started && record['format'] === 'mp3'
        && record['sample_rate'] === 48_000 && record['channels'] === 1) { started = true; return }
      if (record['type'] === 'end' && started && bytes > 0) { done = true; notify(); return }
      if (record['type'] === 'error') { fail('MiniStream synthesis failed', 'PROVIDER_ERROR'); return }
      throw new Error('unexpected event')
    } catch { fail('MiniStream returned an invalid event', 'INVALID_PROVIDER_RESPONSE') }
  }
  const socketError = (): void => { fail('MiniStream connection failed', 'PROVIDER_TRANSPORT_ERROR') }
  const socketClosed = (): void => {
    if (!done) fail('MiniStream connection closed before completion', 'PROVIDER_TRANSPORT_ERROR')
  }
  socket.on('message', message)
  socket.on('error', socketError)
  socket.on('close', socketClosed)
  try {
    const active = (): boolean => !done || pending.length > 0
    while (active()) {
      const chunk = pending.shift()
      if (chunk !== undefined) { yield chunk; continue }
      await new Promise<void>((resolve) => { wake = resolve })
    }
    signal.throwIfAborted()
    if (error !== undefined) throw error
  } finally {
    clearTimeout(firstAudioDeadline)
    signal.removeEventListener('abort', abort)
    socket.off('message', message)
    socket.off('error', socketError)
    socket.off('close', socketClosed)
  }
}

function rawData(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

/** Register one scoped MiniStream synthesis profile. */
export function apply(ctx: Context, config: Config): void {
  const provider = new MiniStreamSpeechSynthesisProvider(ctx, config)
  ctx.effect(() => ctx.speechSynthesis.registerProvider(provider))
}
