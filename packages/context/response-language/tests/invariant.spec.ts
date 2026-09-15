import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, {
  Session,
  SessionId,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import * as ResponseLanguageInvariant from '../src/invariant.ts'
import type { ResponseLanguageResolvedEvent, ResponseLanguageRetryEvent } from '../src/index.ts'

/** Mount the invariant registry over a live Session store. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ResponseLanguageInvariant)
  return ctx
}

/** Create an untyped package event for invalid boundary cases. */
function event(type: string, data: unknown, seq = 0): SessionEvent {
  return { type, data, seq, time: seq } as SessionEvent
}

/** Emit one candidate through the invariant registry without committing it. */
function emit(ctx: Context, session: Session, candidate: SessionEvent): void {
  ctx.emit('session/event', session, candidate)
}

type ResolutionOverrides = {
  [K in keyof ResponseLanguageResolvedEvent]?: ResponseLanguageResolvedEvent[K] | undefined
}

/** One valid first-step resolution with absent optional fields removed. */
function resolution(overrides: ResolutionOverrides = {}): ResponseLanguageResolvedEvent {
  const value = {
    turn: 1,
    step: 1,
    preference: 'auto',
    language: 'en',
    basis: 'detected',
    messageId: 'message-1' as NonNullable<ResponseLanguageResolvedEvent['messageId']>,
    confidence: 0.9,
    ...overrides,
  }
  if (value.messageId === undefined) Reflect.deleteProperty(value, 'messageId')
  if (value.confidence === undefined) Reflect.deleteProperty(value, 'confidence')
  return value as ResponseLanguageResolvedEvent
}

describe('response-language invariants', () => {
  it('accepts every supported preference and valid resolution basis', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    for (const value of ['auto', 'zh-Hans', 'zh-Hant', 'yue-Hant-MO', 'yue-Hant-HK', 'en', 'pt'] as const) {
      expect(() => session.append('response-language/preference', { value })).not.toThrow()
    }
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('response-language/resolved', resolution())).not.toThrow()
    session.append('step/start', { turn: 1, step: 1 })
    session.append('step/end', { turn: 1, step: 1 })
    expect(() => session.append('response-language/resolved', resolution({
      step: 2,
      language: 'en',
      basis: 'carried',
      messageId: undefined,
      confidence: undefined,
    }))).not.toThrow()
    await ctx.fiber.dispose()
  })

  it.each([
    [{}, /carry only value/],
    [{ value: 'de' }, /unknown value/],
    [{ value: 'en', extra: true }, /carry only value/],
  ])('rejects invalid preference payload %j', async (data, expected) => {
    const ctx = await setup()
    const session = Session.create(SessionId(`bad-preference-${crypto.randomUUID()}`))
    expect(() => { emit(ctx, session, event('response-language/preference', data)) }).toThrow(expected)
    await ctx.fiber.dispose()
  })

  it('requires a resolution inside an open turn before step/start', async () => {
    const ctx = await setup()
    const outside = Session.create(SessionId('outside-turn'))
    expect(() => { emit(ctx, outside, event('response-language/resolved', resolution())) })
      .toThrow(/inside an open turn/)

    const afterStart = Session.create(SessionId('after-step-start'))
    afterStart.append('turn/start', { turn: 1 })
    afterStart.append('step/start', { turn: 1, step: 1 })
    expect(() => { emit(ctx, afterStart, event('response-language/resolved', resolution(), 2)) })
      .toThrow(/precede step\/start/)
    await ctx.fiber.dispose()
  })

  it('requires the next turn and step position', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('wrong-position'))
    session.append('turn/start', { turn: 4 })
    expect(() => { emit(ctx, session, event('response-language/resolved', resolution({
      turn: 3,
      step: 2,
    }), 1)) }).toThrow(/expected 4\/1/)
    await ctx.fiber.dispose()
  })

  it.each([
    [resolution({ preference: 'pt', language: 'en', basis: 'fixed', messageId: undefined, confidence: undefined }), /resolve to itself/],
    [resolution({ preference: 'pt', language: 'pt', basis: 'detected' }), /resolve to itself/],
    [resolution({ preference: 'pt', language: 'pt', basis: 'fixed', messageId: 'm' as never, confidence: undefined }), /cannot carry detection fields/],
    [resolution({ basis: 'fixed' }), /automatic.*cannot use basis/],
    [resolution({ messageId: undefined }), /requires messageId/],
    [resolution({ basis: 'carried', messageId: '' as never, confidence: undefined }), /messageId must be a non-empty string/],
    [resolution({ confidence: 0 }), /confidence in/],
    [resolution({ confidence: 2 }), /confidence in/],
    [resolution({ basis: 'carried', confidence: 0.5 }), /cannot carry confidence/],
    [resolution({ language: 'de' as never }), /unknown language/],
    [resolution({ preference: 'de' as never }), /unknown preference/],
    [resolution({ basis: 'guessed' as never }), /unknown basis/],
  ])('rejects inconsistent resolution %#', async (data, expected) => {
    const ctx = await setup()
    const session = Session.create(SessionId(`bad-resolution-${crypto.randomUUID()}`))
    session.append('turn/start', { turn: 1 })
    expect(() => { emit(ctx, session, event('response-language/resolved', data, 1)) }).toThrow(expected)
    await ctx.fiber.dispose()
  })

  it('rejects extra resolution fields and malformed positions', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('bad-fields'))
    session.append('turn/start', { turn: 1 })
    expect(() => { emit(ctx, session, event('response-language/resolved', {
      ...resolution(),
      extra: true,
    }, 1)) }).toThrow(/invalid fields/)
    expect(() => { emit(ctx, session, event('response-language/resolved', {
      ...resolution(),
      turn: 0,
    }, 1)) }).toThrow(/positive safe integers/)
    await ctx.fiber.dispose()
  })

  it('requires one mismatched retry inside its resolved open step', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('response-language/resolved', resolution())
    session.append('step/start', { turn: 1, step: 1 })
    const retry: ResponseLanguageRetryEvent = {
      turn: 1,
      step: 1,
      expected: 'en',
      observed: 'zh-Hant',
    }
    expect(() => session.append('response-language/retry', retry)).not.toThrow()
    expect(() => { emit(ctx, session, event('response-language/retry', {
      ...retry,
      observed: 'en',
    }, session.events.length)) }).toThrow(/must differ/)
    await ctx.fiber.dispose()
  })

  it('rejects corrupt seeded state when the companion registers late', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    const append = session.append.bind(session) as (type: string, data: unknown) => SessionEvent
    append('response-language/preference', { value: 'de' })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ResponseLanguageInvariant).then(() => undefined)).rejects.toThrow(/unknown value/)
    await ctx.fiber.dispose()
  })

  it('ignores unrelated events and dispatches', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('unrelated'))
    expect(() => {
      emit(ctx, session, event('turn/start', { turn: 1 }))
    }).not.toThrow()
    await ctx.fiber.dispose()
  })
})
