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
  /** Maximum time an authenticated socket remains idle for reuse. */
  connectionIdleTimeoutMs: number
  /** Maximum idle sockets retained for one language and voice. */
  maxIdleConnectionsPerVoice: number
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
  connectionIdleTimeoutMs: z.number().step(1).min(1).max(2_147_483_647).required(),
  maxIdleConnectionsPerVoice: z.number().step(1).min(1).max(32).required(),
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
    connectionIdleTimeoutMs: config.connectionIdleTimeoutMs,
    maxIdleConnectionsPerVoice: config.maxIdleConnectionsPerVoice,
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
  private readonly connections: MiniStreamConnectionPool

  /**
   * @param ctx - credential-resolution context.
   * @param config - provider endpoint, voice routing, and limits.
   */
  constructor(private readonly ctx: Context, config: Config) {
    this.config = resolveConfig(config)
    this.profile = this.config.profile
    this.maxInputChars = this.config.maxInputChars
    this.maxOutputBytes = this.config.maxOutputBytes
    this.connections = new MiniStreamConnectionPool(this.config)
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
    const url = (): URL => {
      const clientId = crypto.randomUUID()
      const value = new URL(this.config.endpoint.replace('{client_id}', encodeURIComponent(clientId)))
      value.searchParams.set('language', primary)
      value.searchParams.set('generation_mode', this.config.generationMode)
      value.searchParams.set('voice_preset_key', voice)
      value.searchParams.set('max_generate_length', String(this.config.maxGenerateLength))
      value.searchParams.set('normalize', String(this.config.normalize))
      value.searchParams.set('buffer', 'off')
      return value
    }
    const chunks = streamAudio(
      this.connections, `${primary}\u0000${voice}`, url, credential.value,
      input.text, requestId, this.config, signal,
    )
    return { metadata: { mediaType: this.mediaType, sampleRateHz: 48_000, channels: 1 }, chunks }
  }

  /** Close idle and active provider sockets during scope teardown. */
  dispose(): void {
    this.connections.dispose()
  }
}

type ConnectionState = 'busy' | 'idle' | 'closed'

interface MiniStreamConnection {
  readonly key: string
  readonly token: string
  readonly socket: WebSocket
  state: ConnectionState
  idleTimer?: ReturnType<typeof setTimeout>
}

class MiniStreamConnectionPool {
  private readonly connections = new Set<MiniStreamConnection>()

  constructor(private readonly config: ResolvedConfig) {}

  async acquire(
    key: string, url: () => URL, token: string, signal: AbortSignal,
  ): Promise<MiniStreamConnection> {
    signal.throwIfAborted()
    for (const connection of this.connections) {
      if (connection.state !== 'idle' || connection.key !== key) continue
      if (connection.token !== token || connection.socket.readyState !== WebSocket.OPEN) {
        this.discard(connection)
        continue
      }
      if (connection.idleTimer !== undefined) clearTimeout(connection.idleTimer)
      delete connection.idleTimer
      connection.state = 'busy'
      return connection
    }
    const socket = new WebSocket(url(), {
      headers: { authorization: `Bearer ${token}` },
      handshakeTimeout: this.config.timeoutMs,
      maxPayload: this.config.maxEventBytes,
      followRedirects: false,
      rejectUnauthorized: this.config.tlsRejectUnauthorized,
    })
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        socket.removeEventListener('open', opened)
        socket.removeEventListener('error', failed)
        signal.removeEventListener('abort', aborted)
      }
      const opened = (): void => { cleanup(); resolve() }
      const failed = (): void => {
        cleanup()
        reject(new SpeechSynthesisError('MiniStream connection failed', 'PROVIDER_TRANSPORT_ERROR'))
      }
      const aborted = (): void => {
        cleanup()
        socket.terminate()
        reject(signal.reason instanceof Error ? signal.reason : new Error('MiniStream connection aborted'))
      }
      socket.addEventListener('open', opened, { once: true })
      socket.addEventListener('error', failed, { once: true })
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
    })
    signal.throwIfAborted()
    const connection: MiniStreamConnection = { key, token, socket, state: 'busy' }
    this.connections.add(connection)
    socket.on('error', () => { this.discard(connection) })
    socket.on('close', () => { this.discard(connection) })
    return connection
  }

  release(connection: MiniStreamConnection): void {
    if (connection.state === 'closed' || connection.socket.readyState !== WebSocket.OPEN) {
      this.discard(connection)
      return
    }
    const idleCount = [...this.connections].filter(candidate => candidate !== connection
      && candidate.key === connection.key && candidate.state === 'idle').length
    if (idleCount >= this.config.maxIdleConnectionsPerVoice) {
      this.discard(connection)
      return
    }
    connection.state = 'idle'
    connection.idleTimer = setTimeout(() => {
      if (connection.state === 'idle') this.discard(connection)
    }, this.config.connectionIdleTimeoutMs)
    connection.idleTimer.unref()
  }

  discard(connection: MiniStreamConnection): void {
    if (connection.state === 'closed') return
    connection.state = 'closed'
    if (connection.idleTimer !== undefined) clearTimeout(connection.idleTimer)
    this.connections.delete(connection)
    if (connection.socket.readyState === WebSocket.CONNECTING || connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.terminate()
    }
  }

  dispose(): void {
    for (const connection of [...this.connections]) this.discard(connection)
  }
}

async function* streamAudio(
  pool: MiniStreamConnectionPool, key: string, url: () => URL, token: string,
  text: string, requestId: string, config: ResolvedConfig, signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  signal.throwIfAborted()
  const deadlineAbort = new AbortController()
  const deadline = setTimeout(() => { deadlineAbort.abort() }, config.timeoutMs)
  const operationSignal = AbortSignal.any([signal, deadlineAbort.signal])
  let connection: MiniStreamConnection | undefined
  try {
    connection = await pool.acquire(key, url, token, operationSignal)
    yield* operationChunks(connection.socket, text, requestId, config, operationSignal)
    pool.release(connection)
    connection = undefined
  } catch (error) {
    if (connection !== undefined) pool.discard(connection)
    signal.throwIfAborted()
    if (deadlineAbort.signal.aborted) {
      throw new SpeechSynthesisError('MiniStream synthesis timed out', 'PROVIDER_TIMEOUT')
    }
    throw error
  } finally {
    clearTimeout(deadline)
    if (connection !== undefined) pool.discard(connection)
  }
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
    socket.terminate()
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
  ctx.effect(() => {
    const unregister = ctx.speechSynthesis.registerProvider(provider)
    return () => { unregister(); provider.dispose() }
  })
}
