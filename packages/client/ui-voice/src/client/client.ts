/** Same-origin browser client for the Host speech HTTP routes. */

import { listenRealtime } from './realtime.ts'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SpeechProfile, SpeechSynthesisProfile, SpeechTranscriptionProfile, VoiceClient,
} from './contract.ts'

const PROFILE_PATH = '/api/speech/profile'
const TRANSCRIBE_PATH = '/api/speech/transcribe'
const SYNTHESIZE_PATH = '/api/speech/synthesize'

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function query(path: string, params: Readonly<Record<string, string>>): string {
  return `${path}?${new URLSearchParams(params).toString()}`
}

function record(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`)
  }
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`speech profile ${field} must be a positive integer`)
  }
  return value
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`speech profile ${field} must be a non-negative integer`)
  }
  return value
}

function boundedRatio(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 1) {
    throw new Error(`speech profile ${field} must be between 0.5 and 1`)
  }
  return value
}

function pendingAudioMs(value: unknown): number {
  const milliseconds = positiveInteger(value, 'call.maxPendingAudioMs')
  if (milliseconds < 2000 || milliseconds > 60000 || milliseconds % 100 !== 0) {
    throw new Error('speech profile call.maxPendingAudioMs must be a multiple of 100 between 2000 and 60000')
  }
  return milliseconds
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`speech profile ${field} must be a boolean`)
  return value
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`speech response ${field} must be a non-empty string`)
  return value
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`speech response ${field} must be a string`)
  return value
}

function errorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const body = value as Record<string, unknown>
  if (typeof body['code'] === 'string') return body['code']
  const error = body['error']
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return undefined
  const code = (error as Record<string, unknown>)['code']
  return typeof code === 'string' ? code : undefined
}

function transcriptionProfile(value: unknown): SpeechTranscriptionProfile {
  const item = record(value, 'speech transcription profile')
  if (!Array.isArray(item['mediaTypes'])
    || item['mediaTypes'].length === 0
    || item['mediaTypes'].some(mediaType => typeof mediaType !== 'string' || mediaType === '')) {
    throw new Error('speech profile transcription.mediaTypes must contain non-empty strings')
  }
  return {
    profile: nonEmptyString(item['profile'], 'transcription.profile'),
    ...(item['realtime'] === true ? { realtime: true } : {}),
    mediaTypes: item['mediaTypes'] as string[],
    maxBytes: positiveInteger(item['maxBytes'], 'transcription.maxBytes'),
  }
}

function synthesisProfile(value: unknown): SpeechSynthesisProfile {
  const item = record(value, 'speech synthesis profile')
  return {
    profile: nonEmptyString(item['profile'], 'synthesis.profile'),
    mediaType: nonEmptyString(item['mediaType'], 'synthesis.mediaType'),
    maxInputChars: positiveInteger(item['maxInputChars'], 'synthesis.maxInputChars'),
  }
}

/**
 * Validate the Host profile response before it reaches UI state.
 * @param value - decoded Host response.
 * @returns validated operations for the current Session.
 */
export function parseSpeechProfile(value: unknown): SpeechProfile {
  const profile = record(value, 'speech profile')
  for (const key of Object.keys(profile)) {
    if (key !== 'transcription' && key !== 'synthesis' && key !== 'call') throw new Error(`speech profile has unknown field ${JSON.stringify(key)}`)
  }
  return {
    ...(profile['call'] === undefined ? {} : { call: parseCall(profile['call']) }),
    ...(profile['transcription'] === undefined ? {} : { transcription: transcriptionProfile(profile['transcription']) }),
    ...(profile['synthesis'] === undefined ? {} : { synthesis: synthesisProfile(profile['synthesis']) }),
  }
}

function parseCall(value: unknown): NonNullable<SpeechProfile['call']> {
  const call = record(value, 'speech call options')
  const playbackRate = call['playbackRate']
  if (typeof playbackRate !== 'number' || !Number.isFinite(playbackRate) || playbackRate < 0.5 || playbackRate > 2) {
    throw new Error('speech call playbackRate must be between 0.5 and 2')
  }
  const greetings = Object.fromEntries(Object.entries(record(call['greetings'], 'call.greetings')).map(([language, value]) => {
    const greeting = record(value, 'call greeting')
    const url = nonEmptyString(greeting['url'], 'greeting.url')
    if (!url.startsWith('/api/speech/greeting?')) throw new Error('Invalid greeting audio URL')
    return [language, { text: nonEmptyString(greeting['text'], 'greeting.text'), url }]
  }))
  const defaultGreeting = nonEmptyString(call['defaultGreeting'], 'call.defaultGreeting')
  if (greetings[defaultGreeting] === undefined) throw new Error('Default greeting is unavailable')
  const microphone = record(call['microphone'], 'call.microphone')
  const interruption = record(call['interruption'], 'call.interruption')
  const sentenceMaxChars = positiveInteger(call['sentenceMaxChars'], 'call.sentenceMaxChars')
  const sentencePauseMinChars = positiveInteger(call['sentencePauseMinChars'], 'call.sentencePauseMinChars')
  if (sentencePauseMinChars > sentenceMaxChars) {
    throw new Error('speech call sentencePauseMinChars must not exceed sentenceMaxChars')
  }
  return {
    greetings, defaultGreeting,
    playbackRate,
    microphone: {
      echoCancellation: requiredBoolean(microphone['echoCancellation'], 'call.microphone.echoCancellation'),
      noiseSuppression: requiredBoolean(microphone['noiseSuppression'], 'call.microphone.noiseSuppression'),
      autoGainControl: requiredBoolean(microphone['autoGainControl'], 'call.microphone.autoGainControl'),
    },
    maxPendingAudioMs: pendingAudioMs(call['maxPendingAudioMs']),
    utteranceMergeMs: nonNegativeInteger(call['utteranceMergeMs'], 'call.utteranceMergeMs'),
    interruption: {
      confirmationMs: positiveInteger(interruption['confirmationMs'], 'call.interruption.confirmationMs'),
      minimumMeaningfulCharacters: positiveInteger(interruption['minimumMeaningfulCharacters'], 'call.interruption.minimumMeaningfulCharacters'),
      echoMinimumCharacters: positiveInteger(interruption['echoMinimumCharacters'], 'call.interruption.echoMinimumCharacters'),
      echoSimilarityThreshold: boundedRatio(interruption['echoSimilarityThreshold'], 'call.interruption.echoSimilarityThreshold'),
      backchannelMaximumCharacters: positiveInteger(interruption['backchannelMaximumCharacters'], 'call.interruption.backchannelMaximumCharacters'),
    },
    sentenceMaxChars,
    sentencePauseMinChars,
    sentenceQueueLimit: positiveInteger(call['sentenceQueueLimit'], 'call.sentenceQueueLimit'),
    responseTimeoutMs: positiveInteger(call['responseTimeoutMs'], 'call.responseTimeoutMs'),
    ...(call['fallbackSynthesisProfile'] === undefined ? {} : {
      fallbackSynthesisProfile: nonEmptyString(call['fallbackSynthesisProfile'], 'call.fallbackSynthesisProfile'),
    }),
  }
}

/**
 * Create the browser transport; tests inject a fetch implementation directly.
 * @param fetcher - same-origin request implementation.
 * @returns Host-backed voice client.
 */
export function createWebVoiceClient(fetcher: Fetch = globalThis.fetch.bind(globalThis)): VoiceClient {
  return {
    async synthesizeSentence(request, signal) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.prefix))
      signal.throwIfAborted()
      const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
      return { url: query('/api/speech/synthesize-sentence', {
        sessionId: request.sessionId, profile: request.profile, turn: String(request.turn), step: String(request.step),
        block: String(request.block), start: String(request.start), end: String(request.prefix.length), digest,
      }) }
    },
    listen: (sessionId, profile, event, signal) => listenRealtime(fetcher, sessionId, profile, event, signal),
    async profile(sessionId: SessionId, signal: AbortSignal): Promise<SpeechProfile> {
      const response = await fetcher(query(PROFILE_PATH, { sessionId }), { method: 'GET', signal })
      // An assembly without the Host route answers a plain 404. Explicit
      // unavailability and a cold Session are quiet capability misses; the
      // summary's later live transition invalidates either result.
      if (response.status === 404) {
        const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
        if (mediaType !== 'application/json') return {}
        const code = errorCode(await response.json())
        if (code === 'PROFILE_UNAVAILABLE' || code === 'SESSION_NOT_LIVE') return {}
        throw new Error(`speech profile request failed: HTTP 404${code === undefined ? '' : ` (${code})`}`)
      }
      if (!response.ok) throw new Error(`speech profile request failed: HTTP ${String(response.status)}`)
      return parseSpeechProfile(await response.json())
    },

    async transcribe(request, signal) {
      const response = await fetcher(query(TRANSCRIBE_PATH, {
        sessionId: request.sessionId,
        profile: request.profile,
      }), {
        method: 'POST',
        headers: { 'content-type': request.audio.type || 'application/octet-stream' },
        body: request.audio,
        signal,
      })
      if (!response.ok) throw new Error(`speech transcription request failed: HTTP ${String(response.status)}`)
      const body = record(await response.json(), 'speech transcription response')
      if (!Object.hasOwn(body, 'text') || Reflect.ownKeys(body).some(key => key !== 'text' && key !== 'language')) {
        throw new Error('speech transcription response must contain text and optional language fields only')
      }
      const text = string(body['text'], 'text')
      const language = body['language'] === undefined ? undefined : nonEmptyString(body['language'], 'language')
      return { text, ...(language === undefined ? {} : { language }) }
    },

    synthesize(request: { sessionId: SessionId; messageId: MessageId; profile: string }) {
      return Promise.resolve({
        url: query(SYNTHESIZE_PATH, {
          sessionId: request.sessionId,
          messageId: request.messageId,
          profile: request.profile,
        }),
      })
    },
  }
}
