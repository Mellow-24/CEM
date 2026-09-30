import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as Companion from '@deepseek-ai/dsh-speech-web/invariant'
import { describe, expect, it } from 'vitest'

describe('speech interruption audit invariant', () => {
  it('requires rollback-safe exact pre-dispatch logs and releases checks on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(Companion)
    await fiber
    const session = ctx.sessions.create(SessionId('intent-invariant'))
    const recorded = {
      provider: 'intent', model: 'flash', system: 'Classify the candidate.',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Could you explain this?' }], source: { kind: 'plugin', plugin: 'speech-web-interruption' } })],
      maxTokens: 32, reasoningEffort: 'off', temperature: 0,
    }
    const options: GenerateOptions = { ...recorded, reasoningEffort: ReasoningEffortId('off'), sessionId: session.id }
    expect(() => ctx.llm.stream(options)).toThrow('preceding session audit event')
    expect(() => session.append('speech/interruption-request', recorded)).toThrow('must be ignorable')
    expect(session.events).toHaveLength(0)
    session.append('speech/interruption-request', recorded, { ignorable: true })
    expect(() => ctx.llm.stream(options)).not.toThrow()
    expect(() => ctx.llm.stream({ ...options, model: 'different' })).toThrow('preceding session audit event')
    expect(() => ctx.llm.stream({ ...options, messages: [createUserMessage({ content: [{ type: 'text', text: 'Normal question' }], source: { kind: 'user' } })] })).not.toThrow()
    await fiber.dispose()
    expect(() => session.append('speech/interruption-request', recorded)).not.toThrow()
    expect(() => ctx.llm.stream({ ...options, model: 'different' })).not.toThrow()
    await ctx.fiber.dispose()
  })
})
