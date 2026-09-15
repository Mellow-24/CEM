/** Scope-aware Service Definition for streaming speech synthesis. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { NamedEntries, ScopedLayers, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer } from '@deepseek-ai/dsh-scope'
import type {
  ResolvedSpeechSynthesis,
  SpeechSynthesisInput,
  SpeechAudioMetadata,
  SpeechSynthesisOutput,
  SpeechSynthesisProfile,
  SpeechSynthesisProvider,
} from './types.ts'

export type {
  ResolvedSpeechSynthesis,
  SpeechAudioMetadata,
  SpeechSynthesisInput,
  SpeechSynthesisOutput,
  SpeechSynthesisProfile,
  SpeechSynthesisProvider,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    speechSynthesis: SpeechSynthesisRuntime
  }
}

/** Stable synthesis failure with a machine-routable code. */
export class SpeechSynthesisError extends Error {
  /**
   * @param message - correction-oriented failure message.
   * @param code - stable failure category.
   * @param options - optional chained cause.
   */
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SpeechSynthesisError'
  }
}

class SynthesisLayer implements ScopeLayer {
  readonly providers: NamedEntries<SpeechSynthesisProvider>

  constructor(scope: ScopeKey | undefined) {
    this.providers = new NamedEntries(profile => new SpeechSynthesisError(
      scope === undefined
        ? `speech synthesis profile ${JSON.stringify(profile)} is already registered globally`
        : `speech synthesis profile ${JSON.stringify(profile)} is already registered in this scope`,
      'DUPLICATE_PROFILE',
    ))
  }

  isEmpty(): boolean {
    return this.providers.isEmpty()
  }
}

/** Scoped synthesis provider registry and streaming runtime. */
export class SpeechSynthesisRuntime extends Service {
  static inject = ['agents']

  private readonly layers = new ScopedLayers<SynthesisLayer>(
    scope => new SynthesisLayer(scope),
    () => {},
  )

  constructor(ctx: Context) {
    super(ctx, 'speechSynthesis')
  }

  /**
   * Register a provider in the calling context's scope layer.
   * @param provider - borrowed provider and its public profile metadata.
   * @returns exact effect disposer removing this registration.
   */
  registerProvider(provider: SpeechSynthesisProvider): () => void {
    validateProvider(provider)
    return this.layers.effect(
      this.ctx,
      layer => layer.providers.insert(provider.profile, provider),
      { label: 'speechSynthesis.registerProvider()', notify: false },
    )
  }

  /**
   * Resolve one profile visible to an exact live agent.
   * @param agent - exact live agent whose scope chain supplies permission.
   * @param profile - explicit profile, or omission when exactly one is visible.
   * @returns registration-bound operation and detached profile metadata.
   */
  resolve(agent: Agent, profile?: string): ResolvedSpeechSynthesis {
    this.assertLive(agent)
    const providers = this.layers.merge(scopeOf(agent.ctx), layer => layer.providers)
    const provider = selectProvider(providers, profile)
    return Object.freeze({
      profile: freezeProfile(provider),
      synthesize: (input: SpeechSynthesisInput, signal: AbortSignal) => synthesize(provider, input, signal),
    })
  }

  /**
   * Read public metadata for one profile visible to an exact live agent.
   * @param agent - exact live agent whose scope chain supplies permission.
   * @param profile - explicit profile, or omission when exactly one is visible.
   * @returns detached immutable profile metadata.
   */
  profile(agent: Agent, profile?: string): SpeechSynthesisProfile {
    return this.resolve(agent, profile).profile
  }

  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new SpeechSynthesisError(
        `speech synthesis requires the exact live agent ${JSON.stringify(String(agent.id))}`,
        'AGENT_NOT_LIVE',
      )
    }
  }
}

function validateProvider(provider: SpeechSynthesisProvider): void {
  if (provider.profile.trim() === '') {
    throw new SpeechSynthesisError('speech synthesis profile must be non-empty', 'INVALID_PROFILE')
  }
  if (!isAudioMediaType(provider.mediaType)) {
    throw new SpeechSynthesisError(
      `speech synthesis profile ${JSON.stringify(provider.profile)} has an invalid mediaType`,
      'INVALID_PROFILE',
    )
  }
  if (!Number.isSafeInteger(provider.maxInputChars) || provider.maxInputChars < 1
    || !Number.isSafeInteger(provider.maxOutputBytes) || provider.maxOutputBytes < 1) {
    throw new SpeechSynthesisError(
      `speech synthesis profile ${JSON.stringify(provider.profile)} limits must be positive safe integers`,
      'INVALID_PROFILE',
    )
  }
}

function freezeProfile(provider: SpeechSynthesisProvider): SpeechSynthesisProfile {
  return Object.freeze({
    profile: provider.profile,
    mediaType: provider.mediaType,
    maxInputChars: provider.maxInputChars,
    maxOutputBytes: provider.maxOutputBytes,
  })
}

function selectProvider(
  providers: ReadonlyMap<string, SpeechSynthesisProvider>,
  profile: string | undefined,
): SpeechSynthesisProvider {
  if (profile !== undefined) {
    const provider = providers.get(profile)
    if (provider === undefined) {
      throw new SpeechSynthesisError(
        `speech synthesis profile ${JSON.stringify(profile)} is unavailable to this agent`,
        'PROFILE_UNAVAILABLE',
      )
    }
    return provider
  }
  const visible = [...providers.values()]
  if (visible.length === 0) {
    throw new SpeechSynthesisError('no speech synthesis profile is available to this agent', 'PROFILE_UNAVAILABLE')
  }
  if (visible.length !== 1) {
    throw new SpeechSynthesisError(
      `multiple speech synthesis profiles are available (${visible.map(item => item.profile).join(', ')}); select one explicitly`,
      'PROFILE_AMBIGUOUS',
    )
  }
  return visible[0] as SpeechSynthesisProvider
}

async function synthesize(
  provider: SpeechSynthesisProvider,
  input: SpeechSynthesisInput,
  signal: AbortSignal,
): Promise<SpeechSynthesisOutput> {
  signal.throwIfAborted()
  const { text } = input
  if (text.trim() === '') {
    throw new SpeechSynthesisError('speech synthesis text must be non-empty', 'INVALID_TEXT')
  }
  if (text.length > provider.maxInputChars) {
    throw new SpeechSynthesisError(
      `speech synthesis text exceeds profile ${JSON.stringify(provider.profile)} maxInputChars`,
      'TEXT_TOO_LARGE',
    )
  }
  const output = await provider.synthesize(input, signal)
  signal.throwIfAborted()
  const metadata = validateMetadata(provider, output.metadata)
  return Object.freeze({
    metadata,
    chunks: boundedChunks(provider, output.chunks, metadata.contentLength, signal),
  })
}

function validateMetadata(
  provider: SpeechSynthesisProvider,
  metadata: SpeechAudioMetadata,
): SpeechAudioMetadata {
  if (metadata.mediaType !== provider.mediaType) {
    throw new SpeechSynthesisError(
      `speech synthesis profile ${JSON.stringify(provider.profile)} returned media type ${JSON.stringify(metadata.mediaType)} instead of ${JSON.stringify(provider.mediaType)}`,
      'INVALID_PROVIDER_RESPONSE',
    )
  }
  if (metadata.contentLength !== undefined
    && (!Number.isSafeInteger(metadata.contentLength) || metadata.contentLength < 1
      || metadata.contentLength > provider.maxOutputBytes)) {
    throw new SpeechSynthesisError(
      `speech synthesis profile ${JSON.stringify(provider.profile)} returned an invalid contentLength`,
      'INVALID_PROVIDER_RESPONSE',
    )
  }
  for (const [name, value] of [
    ['sampleRateHz', metadata.sampleRateHz],
    ['channels', metadata.channels],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new SpeechSynthesisError(
        `speech synthesis profile ${JSON.stringify(provider.profile)} returned invalid ${name}`,
        'INVALID_PROVIDER_RESPONSE',
      )
    }
  }
  return Object.freeze({ ...metadata })
}

async function* boundedChunks(
  provider: SpeechSynthesisProvider,
  source: AsyncIterable<Uint8Array>,
  declaredLength: number | undefined,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  let bytes = 0
  for await (const chunk of source) {
    signal.throwIfAborted()
    if (!(chunk instanceof Uint8Array)) {
      throw new SpeechSynthesisError(
        `speech synthesis profile ${JSON.stringify(provider.profile)} emitted a non-byte chunk`,
        'INVALID_PROVIDER_RESPONSE',
      )
    }
    if (chunk.byteLength === 0) continue
    bytes += chunk.byteLength
    if (bytes > provider.maxOutputBytes) {
      throw new SpeechSynthesisError(
        `speech synthesis profile ${JSON.stringify(provider.profile)} exceeded maxOutputBytes`,
        'AUDIO_TOO_LARGE',
      )
    }
    yield chunk
  }
  signal.throwIfAborted()
  if (bytes === 0) {
    throw new SpeechSynthesisError(
      `speech synthesis profile ${JSON.stringify(provider.profile)} emitted no audio bytes`,
      'INVALID_PROVIDER_RESPONSE',
    )
  }
  if (declaredLength !== undefined && bytes !== declaredLength) {
    throw new SpeechSynthesisError(
      `speech synthesis profile ${JSON.stringify(provider.profile)} emitted ${bytes} bytes instead of its declared ${declaredLength}`,
      'INVALID_PROVIDER_RESPONSE',
    )
  }
}

function isAudioMediaType(value: string): boolean {
  return /^audio\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value)
}

export default SpeechSynthesisRuntime
