import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import SpeechTranscriptionRuntime, {
  SpeechTranscriptionError,
  type SpeechTranscriptionProvider,
} from '@deepseek-ai/dsh-speech-transcription'
import { describe, expect, it, vi } from 'vitest'

async function harness(): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  const scope = createScope(ctx, {})
  const agent = {
    id: SessionId('speech-agent'),
    ctx: scope.ctx,
  } as Agent
  ctx.provide('agents', { get: (id: string) => agent.id === id ? agent : undefined } as never)
  await ctx.plugin(SpeechTranscriptionRuntime)
  return { ctx, agent }
}

function provider(overrides: Partial<SpeechTranscriptionProvider> = {}): SpeechTranscriptionProvider {
  return {
    profile: 'voice',
    mediaTypes: ['audio/webm'],
    maxBytes: 4,
    maxTranscriptChars: 8,
    transcribe: vi.fn(async () => ({ text: 'hello' })),
    ...overrides,
  }
}

describe('speech transcription runtime', () => {
  it('resolves only profiles visible through the agent scope chain', async () => {
    const { ctx, agent } = await harness()
    const hidden = createScope(ctx, { hidden: true })
    hidden.ctx.get('speechTranscription')?.registerProvider(provider())
    expect(() => ctx.speechTranscription.profile(agent, 'voice'))
      .toThrow(expect.objectContaining({ code: 'PROFILE_UNAVAILABLE' }))

    const own = createScope(ctx, scopeOf(agent.ctx) as object)
    own.ctx.get('speechTranscription')?.registerProvider(provider({ profile: 'own' }))
    expect(ctx.speechTranscription.profile(agent)).toMatchObject({ profile: 'own', maxBytes: 4 })
  })

  it('enforces input, cancellation, and transcript bounds around the provider', async () => {
    const { ctx, agent } = await harness()
    const scripted = provider()
    ctx.speechTranscription.registerProvider(scripted)
    const resolved = ctx.speechTranscription.resolve(agent)
    const signal = new AbortController().signal
    await expect(resolved.transcribe({ data: new Uint8Array([1]), mediaType: 'audio/webm' }, signal))
      .resolves.toEqual({ text: 'hello' })
    await expect(resolved.transcribe({ data: new Uint8Array(5), mediaType: 'audio/webm' }, signal))
      .rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE' })
    await expect(resolved.transcribe({ data: new Uint8Array([1]), mediaType: 'audio/wav' }, signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' })

    const tooLong = provider({ profile: 'long', transcribe: async () => ({ text: '123456789' }) })
    ctx.speechTranscription.registerProvider(tooLong)
    await expect(ctx.speechTranscription.resolve(agent, 'long').transcribe({
      data: new Uint8Array([1]), mediaType: 'audio/webm',
    }, signal)).rejects.toMatchObject({ code: 'TRANSCRIPT_TOO_LARGE' })

    const aborted = new AbortController()
    aborted.abort(new Error('stop'))
    await expect(resolved.transcribe({ data: new Uint8Array([1]), mediaType: 'audio/webm' }, aborted.signal))
      .rejects.toThrow('stop')
  })

  it('rejects malformed and ambiguous registrations', async () => {
    const { ctx, agent } = await harness()
    expect(() => ctx.speechTranscription.registerProvider(provider({ maxTranscriptChars: 0 })))
      .toThrow(expect.objectContaining({ code: 'INVALID_PROFILE' }))
    ctx.speechTranscription.registerProvider(provider({ profile: 'one' }))
    ctx.speechTranscription.registerProvider(provider({ profile: 'two' }))
    expect(() => ctx.speechTranscription.resolve(agent))
      .toThrow(expect.objectContaining({ code: 'PROFILE_AMBIGUOUS' } satisfies Partial<SpeechTranscriptionError>))
  })
})
