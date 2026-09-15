import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as KnowledgeInvariant from '../src/invariant.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(KnowledgeInvariant)
  return ctx
}

function openStep(ctx: Context) {
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '如何繳費？' }],
  }), { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({
    source: {
      kind: 'plugin',
      plugin: 'customer-service-knowledge',
      form: 'notice',
      summary: 'Approved company knowledge: 1 excerpt(s)',
    },
    content: [{ type: 'text', text: '可透過澳電應用程式繳費。' }],
  }), { surfaceOp: 'append' })
  return session
}

function retrieval(overrides: Record<string, unknown> = {}) {
  return {
    turn: 1,
    step: 1,
    query: '如何繳費？',
    status: 'found' as const,
    reason: null,
    reranked: true,
    sourceCount: 1,
    durationMs: 680,
    evidence: '可透過澳電應用程式繳費。',
    ...overrides,
  }
}

describe('automatic knowledge retrieval invariants', () => {
  it('accepts one retrieval matching the direct question and evidence context', async () => {
    const ctx = await setup()
    expect(() => openStep(ctx).append('customer-service-knowledge/retrieval', retrieval()))
      .not.toThrow()
    await ctx.fiber.dispose()
  })

  it.each([
    ['different query', { query: '其他問題' }, /query must match/],
    ['different evidence', { evidence: '其他內容' }, /model-visible evidence/],
    ['invalid metrics', { durationMs: -1 }, /retrieval metrics/],
    ['invalid count', { sourceCount: 0 }, /sourceCount/],
  ] as const)('rejects %s', async (_label, overrides, expected) => {
    const ctx = await setup()
    expect(() => openStep(ctx).append('customer-service-knowledge/retrieval', retrieval(overrides)))
      .toThrow(expected)
    await ctx.fiber.dispose()
  })

  it('rejects retrieval outside an open step and duplicate retrieval', async () => {
    const ctx = await setup()
    expect(() => ctx.sessions.create().append(
      'customer-service-knowledge/retrieval',
      retrieval(),
    )).toThrow(/open step/)
    const session = openStep(ctx)
    session.append('customer-service-knowledge/retrieval', retrieval())
    expect(() => session.append('customer-service-knowledge/retrieval', retrieval()))
      .toThrow(/at most once/)
    await ctx.fiber.dispose()
  })
})
