import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
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

function openStep(ctx: Context, evidencePosition: 'before' | 'after' = 'before') {
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const question = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '如何繳費？' }],
  })
  const evidence = createUserMessage({
    source: {
      kind: 'plugin',
      plugin: 'customer-service-knowledge',
      form: 'notice',
      summary: 'Approved company knowledge: 1 excerpt(s)',
    },
    content: [{ type: 'text', text: '可透過澳電應用程式繳費。' }],
  })
  for (const message of evidencePosition === 'before' ? [evidence, question] : [question, evidence]) {
    session.append('user/message', message, { surfaceOp: 'append' })
  }
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
  it.each(['before', 'after'] as const)('accepts logged evidence %s its matching direct question', async (position) => {
    const ctx = await setup()
    expect(() => openStep(ctx, position).append('customer-service-knowledge/retrieval', retrieval()))
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

  it('accepts evidence retirement between steps and retains the original retrieval audit on reload', async () => {
    const ctx = await setup()
    const session = openStep(ctx, 'after')
    session.append('customer-service-knowledge/retrieval', retrieval())
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const original = session.events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin')!
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Earlier evidence superseded.' }],
      source: { kind: 'plugin', plugin: 'customer-service-knowledge-history', form: 'notice', summary: 'Superseded' },
    }), {
      surfaceOp: { op: 'replace', start: original.seq, end: original.seq }, sourceEventSeqs: [original.seq],
    })
    const restored = Session.fromRestore(session.id, structuredClone(session.events), structuredClone(session.header))
    expect(restored.deriveMessages()).toEqual(session.deriveMessages())
    expect(() => ctx.sessions.create(undefined, { seed: structuredClone(session.events) })).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('rejects history markers that replace customer text or are appended inside a step', async () => {
    const ctx = await setup()
    const session = openStep(ctx)
    const marker = createUserMessage({
      content: [{ type: 'text', text: 'Earlier evidence superseded.' }],
      source: { kind: 'plugin', plugin: 'customer-service-knowledge-history', form: 'notice', summary: 'Superseded' },
    })
    const customer = session.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    const evidence = session.events.find(event => event.type === 'user/message' && event.data.source.kind === 'plugin')!
    expect(() => session.append('user/message', marker, {
      surfaceOp: { op: 'replace', start: customer.seq, end: customer.seq }, sourceEventSeqs: [customer.seq],
    })).toThrow(/only an earlier company-knowledge notice/)
    expect(() => session.append('user/message', marker, {
      surfaceOp: { op: 'replace', start: evidence.seq, end: evidence.seq }, sourceEventSeqs: [evidence.seq],
    })).toThrow(/precede the next step/)
    session.append('step/end', { turn: 1, step: 1 })
    expect(() => session.append('user/message', marker, { surfaceOp: 'append' })).toThrow(/exactly one/)
    expect(() => session.append('user/message', marker, {
      surfaceOp: { op: 'replace', start: evidence.seq, end: customer.seq },
      sourceEventSeqs: [evidence.seq, customer.seq],
    })).toThrow(/exactly one/)
    await ctx.fiber.dispose()
  })
})
