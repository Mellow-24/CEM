/** Scope-aware Service Definition for complete-recording speech transcription. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { NamedEntries, ScopedLayers, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer } from '@deepseek-ai/dsh-scope'
import type {
  ResolvedSpeechTranscription,
  SpeechTranscript,
  SpeechTranscriptionInput,
  SpeechTranscriptionProfile,
  SpeechTranscriptionProvider,
} from './types.ts'

export type {
  SpeechRealtimeEvent,
  SpeechRealtimeInput,
  ResolvedSpeechTranscription,
  SpeechTranscript,
  SpeechTranscriptionInput,
  SpeechTranscriptionProfile,
  SpeechTranscriptionProvider,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    speechTranscription: SpeechTranscriptionRuntime
  }
}

/** Stable transcription failure with a machine-routable code. */
export class SpeechTranscriptionError extends Error {
  /**
   * @param message - correction-oriented failure message.
   * @param code - stable failure category.
   * @param options - optional chained cause.
   */
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SpeechTranscriptionError'
  }
}

class TranscriptionLayer implements ScopeLayer {
  readonly providers: NamedEntries<SpeechTranscriptionProvider>

  constructor(scope: ScopeKey | undefined) {
    this.providers = new NamedEntries(profile => new SpeechTranscriptionError(
      scope === undefined
        ? `speech transcription profile ${JSON.stringify(profile)} is already registered globally`
        : `speech transcription profile ${JSON.stringify(profile)} is already registered in this scope`,
      'DUPLICATE_PROFILE',
    ))
  }

  isEmpty(): boolean {
    return this.providers.isEmpty()
  }
}

/** Scoped transcription provider registry and execution runtime. */
export class SpeechTranscriptionRuntime extends Service {
  static inject = ['agents']

  private readonly layers = new ScopedLayers<TranscriptionLayer>(
    scope => new TranscriptionLayer(scope),
    () => {},
  )

  constructor(ctx: Context) {
    super(ctx, 'speechTranscription')
  }

  /**
   * Register a provider in the calling context's scope layer.
   * @param provider - borrowed provider and its public profile metadata.
   * @returns exact effect disposer removing this registration.
   */
  registerProvider(provider: SpeechTranscriptionProvider): () => void {
    validateProvider(provider)
    return this.layers.effect(
      this.ctx,
      layer => layer.providers.insert(provider.profile, provider),
      { label: 'speechTranscription.registerProvider()', notify: false },
    )
  }

  /**
   * Resolve one profile visible to an exact live agent.
   * @param agent - exact live agent whose scope chain supplies permission.
   * @param profile - explicit profile, or omission when exactly one is visible.
   * @returns registration-bound operation and detached profile metadata.
   */
  resolve(agent: Agent, profile?: string): ResolvedSpeechTranscription {
    this.assertLive(agent)
    const providers = this.layers.merge(scopeOf(agent.ctx), layer => layer.providers)
    const provider = selectProvider(providers, profile)
    const publicProfile = freezeProfile(provider)
    return Object.freeze({
      profile: publicProfile,
      ...provider.openRealtime === undefined ? {} : { openRealtime: provider.openRealtime.bind(provider) },
      transcribe: (input: SpeechTranscriptionInput, signal: AbortSignal) =>
        transcribe(provider, input, signal),
    })
  }

  /**
   * Read public metadata for one profile visible to an exact live agent.
   * @param agent - exact live agent whose scope chain supplies permission.
   * @param profile - explicit profile, or omission when exactly one is visible.
   * @returns detached immutable profile metadata.
   */
  profile(agent: Agent, profile?: string): SpeechTranscriptionProfile {
    return this.resolve(agent, profile).profile
  }

  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new SpeechTranscriptionError(
        `speech transcription requires the exact live agent ${JSON.stringify(String(agent.id))}`,
        'AGENT_NOT_LIVE',
      )
    }
  }
}

function validateProvider(provider: SpeechTranscriptionProvider): void {
  if (provider.profile.trim() === '') {
    throw new SpeechTranscriptionError('speech transcription profile must be non-empty', 'INVALID_PROFILE')
  }
  if (!Number.isSafeInteger(provider.maxBytes) || provider.maxBytes < 1) {
    throw new SpeechTranscriptionError(
      `speech transcription profile ${JSON.stringify(provider.profile)} maxBytes must be a positive safe integer`,
      'INVALID_PROFILE',
    )
  }
  if (!Number.isSafeInteger(provider.maxTranscriptChars) || provider.maxTranscriptChars < 1) {
    throw new SpeechTranscriptionError(
      `speech transcription profile ${JSON.stringify(provider.profile)} maxTranscriptChars must be a positive safe integer`,
      'INVALID_PROFILE',
    )
  }
  if (provider.mediaTypes.length === 0) {
    throw new SpeechTranscriptionError(
      `speech transcription profile ${JSON.stringify(provider.profile)} must accept at least one media type`,
      'INVALID_PROFILE',
    )
  }
  const mediaTypes = new Set<string>()
  for (const mediaType of provider.mediaTypes) {
    if (!isAudioMediaType(mediaType) || mediaTypes.has(mediaType)) {
      throw new SpeechTranscriptionError(
        `speech transcription profile ${JSON.stringify(provider.profile)} has an invalid or duplicate media type`,
        'INVALID_PROFILE',
      )
    }
    mediaTypes.add(mediaType)
  }
}

function freezeProfile(provider: SpeechTranscriptionProvider): SpeechTranscriptionProfile {
  return Object.freeze({
    profile: provider.profile,
    ...provider.openRealtime === undefined ? {} : { realtime: true },
    mediaTypes: Object.freeze([...provider.mediaTypes]),
    maxBytes: provider.maxBytes,
    maxTranscriptChars: provider.maxTranscriptChars,
  })
}

function selectProvider(
  providers: ReadonlyMap<string, SpeechTranscriptionProvider>,
  profile: string | undefined,
): SpeechTranscriptionProvider {
  if (profile !== undefined) {
    const provider = providers.get(profile)
    if (provider === undefined) {
      throw new SpeechTranscriptionError(
        `speech transcription profile ${JSON.stringify(profile)} is unavailable to this agent`,
        'PROFILE_UNAVAILABLE',
      )
    }
    return provider
  }
  const visible = [...providers.values()]
  if (visible.length === 0) {
    throw new SpeechTranscriptionError('no speech transcription profile is available to this agent', 'PROFILE_UNAVAILABLE')
  }
  if (visible.length !== 1) {
    throw new SpeechTranscriptionError(
      `multiple speech transcription profiles are available (${visible.map(item => item.profile).join(', ')}); select one explicitly`,
      'PROFILE_AMBIGUOUS',
    )
  }
  return visible[0] as SpeechTranscriptionProvider
}

async function transcribe(
  provider: SpeechTranscriptionProvider,
  input: SpeechTranscriptionInput,
  signal: AbortSignal,
): Promise<SpeechTranscript> {
  signal.throwIfAborted()
  if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0) {
    throw new SpeechTranscriptionError('speech transcription audio must be non-empty bytes', 'INVALID_AUDIO')
  }
  if (input.data.byteLength > provider.maxBytes) {
    throw new SpeechTranscriptionError(
      `speech transcription audio exceeds profile ${JSON.stringify(provider.profile)} maxBytes`,
      'AUDIO_TOO_LARGE',
    )
  }
  if (!provider.mediaTypes.includes(input.mediaType)) {
    throw new SpeechTranscriptionError(
      `speech transcription profile ${JSON.stringify(provider.profile)} does not accept ${JSON.stringify(input.mediaType)}`,
      'UNSUPPORTED_MEDIA_TYPE',
    )
  }
  const result = await provider.transcribe(input, signal)
  signal.throwIfAborted()
  if (typeof result.text !== 'string'
    || (result.language !== undefined && (typeof result.language !== 'string' || result.language.trim() === ''))) {
    throw new SpeechTranscriptionError(
      `speech transcription profile ${JSON.stringify(provider.profile)} returned an invalid transcript`,
      'INVALID_PROVIDER_RESPONSE',
    )
  }
  if (result.text.length > provider.maxTranscriptChars) {
    throw new SpeechTranscriptionError(
      `speech transcription profile ${JSON.stringify(provider.profile)} returned text exceeding maxTranscriptChars`,
      'TRANSCRIPT_TOO_LARGE',
    )
  }
  return Object.freeze({
    text: result.text,
    ...result.language === undefined ? {} : { language: result.language },
  })
}

function isAudioMediaType(value: string): boolean {
  return /^audio\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value)
}

export default SpeechTranscriptionRuntime
