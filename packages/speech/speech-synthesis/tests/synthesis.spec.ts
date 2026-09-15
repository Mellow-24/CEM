import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import SpeechSynthesisRuntime, {
  type SpeechSynthesisProvider,
} from '@deepseek-ai/dsh-speech-synthesis'
import { describe, expect, it } from 'vitest'

async function harness(): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  const scope = createScope(ctx, {})
  const agent = { id: SessionId('speech-agent'), ctx: scope.ctx } as Agent
  ctx.provide('agents', { get: (id: string) => agent.id === id ? agent : undefined } as never)
  await ctx.plugin(SpeechSynthesisRuntime)
  return { ctx, agent }
}

function provider(overrides: Partial<SpeechSynthesisProvider> = {}): SpeechSynthesisProvider {
  return {
    profile: 'voice',
    mediaType: 'audio/mpeg',
    maxInputChars: 8,
    maxOutputBytes: 4,
    async synthesize() {
      return {
        metadata: { mediaType: 'audio/mpeg' },
        chunks: (async function* () { yield new Uint8Array([1, 2]) })(),
      }
    },
    ...overrides,
  }
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<number[]> {
  const bytes: number[] = []
  for await (const chunk of source) bytes.push(...chunk)
  return bytes
}

describe('speech synthesis runtime', () => {
  it('validates text and returns bounded media chunks', async () => {
    const { ctx, agent } = await harness()
    ctx.speechSynthesis.registerProvider(provider())
    const resolved = ctx.speechSynthesis.resolve(agent)
    const output = await resolved.synthesize({ text: 'hello' }, new AbortController().signal)
    expect(output.metadata).toEqual({ mediaType: 'audio/mpeg' })
    await expect(collect(output.chunks)).resolves.toEqual([1, 2])
    await expect(resolved.synthesize({ text: '' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'INVALID_TEXT' })
    await expect(resolved.synthesize({ text: '123456789' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'TEXT_TOO_LARGE' })
  })

  it('rejects mismatched metadata and oversized streamed output', async () => {
    const { ctx, agent } = await harness()
    ctx.speechSynthesis.registerProvider(provider({
      profile: 'wrong-type',
      async synthesize() {
        return { metadata: { mediaType: 'audio/ogg' }, chunks: (async function* () {})() }
      },
    }))
    await expect(ctx.speechSynthesis.resolve(agent, 'wrong-type').synthesize({ text: 'x' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })

    ctx.speechSynthesis.registerProvider(provider({
      profile: 'large',
      async synthesize() {
        return {
          metadata: { mediaType: 'audio/mpeg' },
          chunks: (async function* () { yield new Uint8Array(3); yield new Uint8Array(2) })(),
        }
      },
    }))
    const output = await ctx.speechSynthesis.resolve(agent, 'large').synthesize({ text: 'x' }, new AbortController().signal)
    await expect(collect(output.chunks)).rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE' })

    ctx.speechSynthesis.registerProvider(provider({
      profile: 'length-mismatch',
      async synthesize() {
        return {
          metadata: { mediaType: 'audio/mpeg', contentLength: 1 },
          chunks: (async function* () { yield new Uint8Array([1, 2]) })(),
        }
      },
    }))
    const mismatched = await ctx.speechSynthesis.resolve(agent, 'length-mismatch')
      .synthesize({ text: 'x' }, new AbortController().signal)
    await expect(collect(mismatched.chunks)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
  })

  it('requires exact live agents and explicit selection when profiles are ambiguous', async () => {
    const { ctx, agent } = await harness()
    ctx.speechSynthesis.registerProvider(provider({ profile: 'one' }))
    ctx.speechSynthesis.registerProvider(provider({ profile: 'two' }))
    expect(() => ctx.speechSynthesis.resolve(agent)).toThrow(expect.objectContaining({ code: 'PROFILE_AMBIGUOUS' }))
    expect(() => ctx.speechSynthesis.resolve({ ...agent, id: SessionId('stale') }, 'one'))
      .toThrow(expect.objectContaining({ code: 'AGENT_NOT_LIVE' }))
  })
})
