import { readFileSync } from 'node:fs'
import type {} from '@deepseek-ai/dsh-response-language'
/** Authority-checked Web Consumer for final transcription and committed-message speech synthesis. */

import type { Context } from '@deepseek-ai/cordis'
import { loggedSentence } from './sentence.ts'
import { registerRealtimeRoutes } from './realtime.ts'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SpeechTranscriptionError } from '@deepseek-ai/dsh-speech-transcription'
import { SpeechSynthesisError } from '@deepseek-ai/dsh-speech-synthesis'
import {
  SPEECH_PROFILE_PATH,
  SPEECH_SYNTHESIZE_PATH,
  SPEECH_TRANSCRIBE_PATH,
} from './paths.ts'
import type {
  SpeechWebErrorBody,
  SpeechWebProfile,
  SpeechWebTranscript,
  SpeechCallOptions,
} from './types.ts'

export {
  SPEECH_PROFILE_PATH,
  SPEECH_SYNTHESIZE_PATH,
  SPEECH_TRANSCRIBE_PATH,
} from './paths.ts'
export type {
  SpeechWebErrorBody,
  SpeechWebProfile,
  SpeechWebSynthesisProfile,
  SpeechWebTranscript,
  SpeechWebTranscriptionProfile,
} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'speech-web'
/** Host Connection supplies trusted raw routes; Agents and SystemPrompt supply scoped call context. */
export const inject = ['connection', 'agents', 'systemPrompt']

/** Default carrier cap for one complete recording upload. */
export const DEFAULT_MAX_TRANSCRIPTION_BODY_BYTES = 16 * 1024 * 1024

/** Host speech route limits. */
export interface Config {
  /** Explicitly permit configured trusted authorities; loopback remains the default. */
  authority?: 'loopback' | 'trusted-host'
  /** Enable continuous calls when streaming recognition and synthesis are available. */
  call?: Omit<SpeechCallOptions, 'greetings' | 'fallbackSynthesisProfile'> & {
    /** Model-visible response rules applied only while a realtime call is connected. */
    responseInstructions: string
    /** Preferred synthesis profile when more than one is visible to the Agent. */
    synthesisProfile?: string
    /** Alternate synthesis profile used when the preferred provider fails before audio begins. */
    fallbackSynthesisProfile?: string
    /** Fixed greeting text and packaged audio module specifier for each language. */
    greetings: Record<string, {
      /** Caption matching the prepared recording. */
      text: string
      /** Module specifier resolving to a packaged WAV file. */
      asset: string
    }>
  }
  /** Maximum body bytes the Connection bridge may buffer for one transcription request. */
  maxTranscriptionBodyBytes?: number
}

/** Speech Web Consumer config. */
export const Config: z<Config> = z.object({
  authority: z.union(['loopback', 'trusted-host']).default('loopback'),
  call: z.union([z.object({
    defaultGreeting: z.string().required(),
    responseInstructions: z.string().required(),
    synthesisProfile: z.string(),
    fallbackSynthesisProfile: z.string(),
    greetings: z.dict(z.object({ text: z.string().required(), asset: z.string().required() })).required(),
    playbackRate: z.number().min(0.5).max(2).required(),
    microphone: z.object({
      echoCancellation: z.boolean().required(),
      noiseSuppression: z.boolean().required(),
      autoGainControl: z.boolean().required(),
    }).required(),
    maxPendingAudioMs: z.number().step(100).min(2000).max(60000).required(),
    utteranceMergeMs: z.number().step(1).min(0).max(6000).required(),
    interruption: z.object({
      confirmationMs: z.number().step(1).min(100).max(3000).required(),
      minimumMeaningfulCharacters: z.number().step(1).min(1).max(32).required(),
      echoMinimumCharacters: z.number().step(1).min(2).max(64).required(),
      echoSimilarityThreshold: z.number().min(0.5).max(1).required(),
      backchannelMaximumCharacters: z.number().step(1).min(1).max(32).required(),
    }).required(),
    sentenceMaxChars: z.number().step(1).min(16).max(4000).required(),
    sentenceQueueLimit: z.number().step(1).min(2).max(128).required(),
    responseTimeoutMs: z.number().step(1).min(1).max(600000).required(),
  })]),
  maxTranscriptionBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_MAX_TRANSCRIPTION_BODY_BYTES),
})

class SpeechWebRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SpeechWebRequestError'
  }
}

/** Register the exact speech routes with the configured Connection authority. */
export function apply(ctx: Context, config: Config = {}): void {
  const authority = config.authority ?? 'loopback'
  if (config.call?.synthesisProfile !== undefined && config.call.synthesisProfile.trim() === '') {
    throw new Error('Call synthesisProfile must be non-empty')
  }
  if (config.call?.fallbackSynthesisProfile !== undefined && config.call.fallbackSynthesisProfile.trim() === '') {
    throw new Error('Call fallbackSynthesisProfile must be non-empty')
  }
  const greetings = new Map(Object.entries(config.call?.greetings ?? {}).map(([language, greeting]) =>
    [language, { text: greeting.text, audio: readFileSync(new URL(import.meta.resolve(greeting.asset))) }]))
  if (config.call !== undefined && !greetings.has(config.call.defaultGreeting)) throw new Error('Default call greeting is unavailable')
  const call = config.call === undefined ? undefined : {
    defaultGreeting: config.call.defaultGreeting,
    playbackRate: config.call.playbackRate,
    microphone: config.call.microphone,
    maxPendingAudioMs: config.call.maxPendingAudioMs,
    utteranceMergeMs: config.call.utteranceMergeMs,
    interruption: config.call.interruption,
    sentenceMaxChars: config.call.sentenceMaxChars,
    sentenceQueueLimit: config.call.sentenceQueueLimit,
    responseTimeoutMs: config.call.responseTimeoutMs,
    ...(config.call.fallbackSynthesisProfile === undefined ? {} : {
      fallbackSynthesisProfile: config.call.fallbackSynthesisProfile,
    }),
    greetings: Object.fromEntries([...greetings].map(([language, greeting]) =>
      [language, { text: greeting.text, url: `/api/speech/greeting?language=${encodeURIComponent(language)}` }])),
  }
  if (call !== undefined) {
    ctx.connection.fetch.handle('/api/speech/greeting', request => handle(ctx, request, (_ctx, req) => {
      requireMethod(req, 'GET')
      const query = parseQuery(req, ['sessionId', 'language'], ['sessionId', 'language'])
      const agent = liveRootAgent(ctx, query.sessionId as string)
      const preferred = optionalSynthesisProfile(ctx, agent, config.call?.synthesisProfile)
      const fallback = config.call?.fallbackSynthesisProfile === undefined
        ? undefined
        : optionalSynthesisProfile(ctx, agent, config.call.fallbackSynthesisProfile)
      if (!optionalTranscriptionProfile(ctx, agent, undefined)?.realtime || (!preferred && !fallback)) {
        throw new SpeechWebRequestError('Call greeting is unavailable', 'PROFILE_UNAVAILABLE', 404)
      }
      const greeting = greetings.get(query.language as string)
      if (greeting === undefined) throw new SpeechWebRequestError('Greeting language is unavailable', 'INVALID_QUERY', 400)
      return new Response(new Uint8Array(greeting.audio), { headers: {
        'content-type': 'audio/wav', 'content-length': String(greeting.audio.byteLength),
        'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff',
      } })
    }), { authority })
  }
  if (config.call !== undefined) {
    registerRealtimeRoutes(
      ctx,
      authority,
      sessionId => liveRootAgent(ctx, sessionId),
      config.call.responseInstructions,
    )
  }
  const maxTranscriptionBodyBytes = config.maxTranscriptionBodyBytes
    ?? DEFAULT_MAX_TRANSCRIPTION_BODY_BYTES
  ctx.connection.fetch.handle(
    SPEECH_PROFILE_PATH,
    request => handle(ctx, request, (routeCtx, routeRequest) =>
      profileResponse(routeCtx, routeRequest, maxTranscriptionBodyBytes, call, config.call?.synthesisProfile)),
    { authority },
  )
  ctx.connection.fetch.handle(
    SPEECH_TRANSCRIBE_PATH,
    request => handle(ctx, request, (routeCtx, routeRequest) =>
      transcriptionResponse(routeCtx, routeRequest, maxTranscriptionBodyBytes)),
    { authority, maxRequestBodyBytes: maxTranscriptionBodyBytes },
  )
  if (config.call !== undefined) {
    ctx.connection.fetch.handle('/api/speech/synthesize-sentence',
      request => handle(ctx, request, sentenceResponse), { authority })
  }
  ctx.connection.fetch.handle(
    SPEECH_SYNTHESIZE_PATH,
    request => handle(ctx, request, synthesisResponse),
    { authority },
  )
}

type RouteHandler = (ctx: Context, request: Request) => Response | Promise<Response>

async function handle(ctx: Context, request: Request, route: RouteHandler): Promise<Response> {
  try {
    return await route(ctx, request)
  } catch (error: unknown) {
    if (request.signal.aborted) {
      return jsonError('REQUEST_ABORTED', 'speech request was aborted', 499)
    }
    if (error instanceof SpeechWebRequestError) {
      return jsonError(error.code, error.message, error.status)
    }
    if (error instanceof SpeechTranscriptionError) {
      return jsonError(error.code, error.message, transcriptionStatus(error.code))
    }
    if (error instanceof SpeechSynthesisError) {
      return jsonError(error.code, error.message, synthesisStatus(error.code))
    }
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    return jsonError('INTERNAL', 'speech operation failed', 500)
  }
}

function profileResponse(
  ctx: Context,
  request: Request,
  maxTranscriptionBodyBytes: number,
  call?: SpeechCallOptions,
  configuredSynthesisProfile?: string,
): Response {
  requireMethod(request, 'GET')
  const query = parseQuery(request, ['sessionId', 'profile'], ['sessionId'])
  const agent = liveRootAgent(ctx, query.sessionId as string)
  const selected = query.profile
  const transcription = optionalTranscriptionProfile(ctx, agent, selected)
  const primary = callSynthesisProfile(ctx, agent, selected, configuredSynthesisProfile)
  const fallback = selected !== undefined || call?.fallbackSynthesisProfile === undefined
    ? undefined
    : optionalSynthesisProfile(ctx, agent, call.fallbackSynthesisProfile)
  const synthesis = primary ?? fallback
  const configuredFallback = call?.fallbackSynthesisProfile
  const callWithoutFallback = call === undefined ? undefined : { ...call }
  if (callWithoutFallback !== undefined) delete callWithoutFallback.fallbackSynthesisProfile
  const advertisedCall = callWithoutFallback === undefined || synthesis === undefined ? undefined : {
    ...callWithoutFallback,
    ...(configuredFallback === undefined || fallback === undefined || fallback.profile === synthesis.profile
      ? {}
      : { fallbackSynthesisProfile: fallback.profile }),
  }
  const profile: SpeechWebProfile = {
    ...advertisedCall === undefined || !transcription?.realtime ? {} : { call: {
      ...advertisedCall, greetings: Object.fromEntries(Object.entries(advertisedCall.greetings).map(([language, greeting]) =>
        [language, { ...greeting, url: `${greeting.url}&sessionId=${encodeURIComponent(query.sessionId as string)}` }])) } },
    ...transcription === undefined ? {} : {
      transcription: {
        profile: transcription.profile,
        ...transcription.realtime ? { realtime: true } : {},
        mediaTypes: [...transcription.mediaTypes],
        maxBytes: Math.min(transcription.maxBytes, maxTranscriptionBodyBytes),
      },
    },
    ...synthesis === undefined ? {} : {
      synthesis: {
        profile: synthesis.profile,
        mediaType: synthesis.mediaType,
        maxInputChars: synthesis.maxInputChars,
        maxOutputBytes: synthesis.maxOutputBytes,
      },
    },
  }
  return json(profile)
}

function optionalTranscriptionProfile(ctx: Context, agent: Agent, profile: string | undefined) {
  try {
    return ctx.get('speechTranscription')?.profile(agent, profile)
  } catch (error: unknown) {
    if (error instanceof SpeechTranscriptionError && error.code === 'PROFILE_UNAVAILABLE') return undefined
    throw error
  }
}

function optionalSynthesisProfile(ctx: Context, agent: Agent, profile: string | undefined) {
  try {
    return ctx.get('speechSynthesis')?.profile(agent, profile)
  } catch (error: unknown) {
    if (error instanceof SpeechSynthesisError && error.code === 'PROFILE_UNAVAILABLE') return undefined
    throw error
  }
}

function callSynthesisProfile(
  ctx: Context, agent: Agent, selected: string | undefined, configured: string | undefined,
) {
  try {
    return ctx.get('speechSynthesis')?.profile(agent, selected)
  } catch (error: unknown) {
    if (error instanceof SpeechSynthesisError && error.code === 'PROFILE_UNAVAILABLE') return undefined
    if (error instanceof SpeechSynthesisError && error.code === 'PROFILE_AMBIGUOUS' && configured !== undefined) {
      return optionalSynthesisProfile(ctx, agent, configured)
    }
    throw error
  }
}

async function transcriptionResponse(
  ctx: Context,
  request: Request,
  maxTranscriptionBodyBytes: number,
): Promise<Response> {
  requireMethod(request, 'POST')
  const query = parseQuery(request, ['sessionId', 'profile'], ['sessionId'])
  const agent = liveRootAgent(ctx, query.sessionId as string)
  const runtime = ctx.get('speechTranscription')
  if (runtime === undefined) {
    throw new SpeechWebRequestError('speech transcription is not configured', 'PROFILE_UNAVAILABLE', 404)
  }
  const resolved = runtime.resolve(agent, query.profile)
  const effectiveMaxBytes = Math.min(resolved.profile.maxBytes, maxTranscriptionBodyBytes)
  const mediaType = baseMediaType(request.headers.get('content-type'))
  if (mediaType === undefined) {
    throw new SpeechWebRequestError('speech transcription requires an audio Content-Type', 'UNSUPPORTED_MEDIA_TYPE', 415)
  }
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > effectiveMaxBytes) {
    throw new SpeechWebRequestError('speech transcription audio exceeds the selected profile limit', 'AUDIO_TOO_LARGE', 413)
  }
  const data = new Uint8Array(await request.arrayBuffer())
  if (data.byteLength > effectiveMaxBytes) {
    throw new SpeechWebRequestError('speech transcription audio exceeds the effective transport limit', 'AUDIO_TOO_LARGE', 413)
  }
  const transcript = await resolved.transcribe({ data, mediaType }, request.signal)
  const value: SpeechWebTranscript = {
    text: transcript.text,
    ...transcript.language === undefined ? {} : { language: transcript.language },
  }
  return json(value)
}

async function synthesisResponse(ctx: Context, request: Request): Promise<Response> {
  requireMethod(request, 'GET')
  const query = parseQuery(
    request,
    ['sessionId', 'messageId', 'profile'],
    ['sessionId', 'messageId'],
  )
  const agent = liveRootAgent(ctx, query.sessionId as string)
  const event = assistantMessage(agent, query.messageId as string)
  const text = event.data.message.content
    .filter(block => block.type === 'text' && block.text !== '')
    .map(block => block.type === 'text' ? block.text : '')
    .join('\n\n')
  if (text.trim() === '') {
    throw new SpeechWebRequestError('assistant message contains no speakable text', 'MESSAGE_HAS_NO_TEXT', 422)
  }
  return await streamSynthesis(ctx, request, agent, text, query.profile, event.data.turn, event.data.step)
}

async function sentenceResponse(ctx: Context, request: Request): Promise<Response> {
  requireMethod(request, 'GET')
  const query = parseQuery(request, ['sessionId', 'profile', 'turn', 'step', 'block', 'start', 'end', 'digest'],
    ['sessionId', 'turn', 'step', 'block', 'start', 'end', 'digest'])
  const number = (key: string, minimum: number): number => {
    const value = Number(query[key])
    if (!Number.isSafeInteger(value) || value < minimum) throw new SpeechWebRequestError('Invalid sentence coordinates', 'INVALID_QUERY', 400)
    return value
  }
  const selector = { turn: number('turn', 1), step: number('step', 1), block: number('block', 0),
    start: number('start', 0), end: number('end', 1), digest: query.digest as string }
  if (selector.end <= selector.start || !/^[a-f0-9]{64}$/.test(selector.digest)) {
    throw new SpeechWebRequestError('Invalid sentence coordinates', 'INVALID_QUERY', 400)
  }
  const agent = liveRootAgent(ctx, query.sessionId as string)
  const text = loggedSentence(agent, selector)
  if (text === undefined) throw new SpeechWebRequestError('Sentence is unavailable or has been revised', 'STALE_SENTENCE', 409)
  return await streamSynthesis(ctx, request, agent, text.replace(/\s+/gu, ' ').trim(), query.profile, selector.turn, selector.step)
}

async function streamSynthesis(
  ctx: Context, request: Request, agent: Agent, text: string,
  profile: string | undefined, turn: number, step: number,
): Promise<Response> {
  const runtime = ctx.get('speechSynthesis')
  if (runtime === undefined) {
    throw new SpeechWebRequestError('speech synthesis is not configured', 'PROFILE_UNAVAILABLE', 404)
  }
  const operationAbort = new AbortController()
  const signal = AbortSignal.any([request.signal, operationAbort.signal])
  const resolution = agent.session.events.findLast(event => event.type === 'response-language/resolved'
    && event.data.turn === turn && event.data.step === step)
  const language = resolution?.type === 'response-language/resolved' ? resolution.data.language : undefined
  const output = await runtime.resolve(agent, profile).synthesize({ text, ...language === undefined ? {} : { language } }, signal)
  const iterator = output.chunks[Symbol.asyncIterator]()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await iterator.next()
        if (item.done) controller.close()
        else controller.enqueue(item.value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      operationAbort.abort(reason)
      await iterator.return?.()
    },
  })
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': output.metadata.mediaType,
    'x-content-type-options': 'nosniff',
  })
  return new Response(body, { headers })
}

function liveRootAgent(ctx: Context, rawSessionId: string): Agent {
  const agent = ctx.agents.get(SessionId(rawSessionId))
  if (agent === undefined) {
    throw new SpeechWebRequestError(
      `live session ${JSON.stringify(rawSessionId)} was not found`,
      'SESSION_NOT_LIVE',
      404,
    )
  }
  if (!ctx.agents.roots().includes(agent)) {
    throw new SpeechWebRequestError('speech interaction is unavailable to delegated agents', 'DELEGATED_AGENT', 403)
  }
  return agent
}

function assistantMessage(agent: Agent, messageId: string): SessionEvent<'assistant/message'> {
  const event = agent.session.events.find(candidate =>
    candidate.type === 'assistant/message'
    && candidate.surfaceOp === 'append'
    && candidate.data.message.id === messageId)
  if (event === undefined || event.type !== 'assistant/message') {
    throw new SpeechWebRequestError(
      `committed assistant message ${JSON.stringify(messageId)} was not found in this session`,
      'MESSAGE_NOT_FOUND',
      404,
    )
  }
  return event
}

function requireMethod(request: Request, method: 'GET' | 'POST'): void {
  if (request.method !== method) {
    throw new SpeechWebRequestError(`speech route requires ${method}`, 'METHOD_NOT_ALLOWED', 405)
  }
}

function parseQuery(
  request: Request,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}
  const params = new URL(request.url).searchParams
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) {
      throw new SpeechWebRequestError('speech route has invalid query parameters', 'INVALID_QUERY', 400)
    }
    const value = params.get(key)
    if (value === null || value.trim() === '') {
      throw new SpeechWebRequestError('speech route query values must be non-empty', 'INVALID_QUERY', 400)
    }
    values[key] = value
  }
  for (const key of required) {
    if (values[key] === undefined) {
      throw new SpeechWebRequestError(`speech route requires query parameter ${key}`, 'INVALID_QUERY', 400)
    }
  }
  return values
}

function baseMediaType(value: string | null): string | undefined {
  if (value === null) return undefined
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType?.startsWith('audio/') === true ? mediaType : undefined
}

function json(value: unknown): Response {
  return Response.json(value, { headers: { 'cache-control': 'no-store' } })
}

function jsonError(code: string, message: string, status: number): Response {
  const body: SpeechWebErrorBody = { error: { code, message } }
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function transcriptionStatus(code: string): number {
  if (code === 'AUDIO_TOO_LARGE') return 413
  if (code === 'UNSUPPORTED_MEDIA_TYPE') return 415
  if (code === 'PROFILE_UNAVAILABLE') return 404
  if (code === 'PROFILE_AMBIGUOUS') return 409
  if (code === 'PROVIDER_HTTP_ERROR' || code === 'PROVIDER_TRANSPORT_ERROR' || code === 'INVALID_PROVIDER_RESPONSE'
    || code === 'TRANSCRIPT_TOO_LARGE' || code === 'PROVIDER_RESPONSE_TOO_LARGE') return 502
  if (code === 'PROVIDER_TIMEOUT') return 504
  return 400
}

function synthesisStatus(code: string): number {
  if (code === 'TEXT_TOO_LARGE') return 413
  if (code === 'PROFILE_UNAVAILABLE') return 404
  if (code === 'PROFILE_AMBIGUOUS') return 409
  if (code === 'MISSING_CREDENTIAL') return 503
  if (code === 'PROVIDER_BUSY') return 503
  if (code === 'PROVIDER_HTTP_ERROR' || code === 'PROVIDER_TRANSPORT_ERROR'
    || code === 'PROVIDER_ERROR' || code === 'PROVIDER_RESPONSE_TOO_LARGE'
    || code === 'AUDIO_TOO_LARGE' || code === 'INVALID_PROVIDER_RESPONSE') return 502
  if (code === 'PROVIDER_TIMEOUT') return 504
  return 400
}
