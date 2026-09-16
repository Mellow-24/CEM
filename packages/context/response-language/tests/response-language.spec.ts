import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import {
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ResponseLanguage from '../src/index.ts'

/** Adapter that records each request and returns one complete text response. */
class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private nextResponse = 0

  constructor(private readonly responses: readonly string[] = ['answer']) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.responses[Math.min(this.nextResponse, this.responses.length - 1)] ?? ''
    this.nextResponse += 1
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: response }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: response } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface Bench {
  ctx: Context
  adapter: RecordingAdapter
  handle: Awaited<ReturnType<Context['agents']['create']>>
  languageFiber: { dispose(): Promise<void> | void }
  policyKey: object
}

/** Boot the real AgentLoop and mount response-language during Agent setup. */
async function harness(
  fallbackLanguage: ResponseLanguage.FixedResponseLanguage = 'zh-Hant',
  placement: 'standing' | 'agent' = 'standing',
  responses: readonly string[] = ['answer'],
  verifyOutput = true,
  autoDetectedLanguages?: ResponseLanguage.FixedResponseLanguage[],
): Promise<Bench> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: 'Customer service.' } })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new RecordingAdapter(responses)
  ctx.llm.registerAdapter(['mock'], adapter)
  let languageFiber!: { dispose(): Promise<void> | void }
  const policyKey = { responseLanguagePreset: crypto.randomUUID() }
  if (placement === 'standing') {
    const policyScope = createScope(ctx, policyKey)
    languageFiber = await policyScope.ctx.plugin(ResponseLanguage, {
      fallbackLanguage,
      verifyOutput,
      ...autoDetectedLanguages === undefined ? {} : { autoDetectedLanguages },
    })
  }
  const handle = await ctx.agents.create({
    sessionId: SessionId(`response-language-${crypto.randomUUID()}`),
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => {
      if (placement === 'standing') {
        const agentScope = scopeOf(agentCtx)
        if (agentScope === undefined) throw new Error('test Agent has no scope')
        bindScopeParent(agentScope, policyKey)
      } else {
        languageFiber = await agentCtx.plugin(ResponseLanguage, {
          fallbackLanguage,
          verifyOutput,
          ...autoDetectedLanguages === undefined ? {} : { autoDetectedLanguages },
        })
      }
    },
  })
  return { ctx, adapter, handle, languageFiber, policyKey }
}

/** Send one direct user prompt and wait for the whole agent activity. */
async function send(bench: Bench, text: string): Promise<MessageId> {
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  bench.handle.agent.followup(message)
  await bench.handle.agent.whenIdle()
  return message.id
}

/** Append a merge-extensible log-only event that another package normally owns. */
function appendForeign(session: Session, type: string, data: unknown): SessionEvent {
  const append = session.append.bind(session) as (eventType: string, eventData: unknown) => SessionEvent
  return append(type, data)
}

/** Detached preset-selection event for guarded listener tests. */
function presetSelectionEvent(seq: number): SessionEvent {
  return {
    type: 'agent-preset/selected',
    seq,
    time: seq,
    data: { agentPreset: 'synthetic' },
  }
}

/** Let contained session observers and one nested deferred activation complete. */
async function settleDeferredActivation(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('response-language request integration', () => {
  it('pins Auto during the real setup/publication order and exposes available projection state', async () => {
    const bench = await harness()
    agentEvents(bench.ctx, bench.handle.agent).emit('agent/session-start', { source: 'clear' })
    const preferences = bench.handle.agent.session.events.filter(
      event => event.type === 'response-language/preference',
    )
    expect(preferences).toHaveLength(1)
    expect(preferences[0]?.data).toEqual({ value: 'auto' })
    expect(bench.ctx.sessionProjections.snapshot(bench.handle.agent.session).values.responseLanguage)
      .toMatchObject({ available: true, currentValue: 'auto' })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('detects direct user language before assembly and commits the exact resolution before step/start', async () => {
    const bench = await harness()
    const messageId = await send(bench, 'How can I cancel automatic payment?')
    expect(bench.adapter.requests).toHaveLength(1)
    expect(bench.adapter.requests[0]?.system).toContain('Reply in English.')

    const events = bench.handle.agent.session.events
    const resolutionIndex = events.findIndex(event => event.type === 'response-language/resolved')
    const stepIndex = events.findIndex(event => event.type === 'step/start')
    expect(resolutionIndex).toBeGreaterThan(-1)
    expect(resolutionIndex).toBeLessThan(stepIndex)
    expect(events[resolutionIndex]).toMatchObject({
      type: 'response-language/resolved',
      data: {
        turn: 1,
        step: 1,
        preference: 'auto',
        language: 'en',
        basis: 'detected',
        messageId,
      },
    })
    expect(events.find(event => event.type === 'request/header')?.data.header.system)
      .toContain('Reply in English.')
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('makes a fixed selection override the input language and logs one authoritative command payload', async () => {
    const bench = await harness()
    const execution = await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language pt',
      new AbortController().signal,
    )
    expect(execution?.result.kind).toBe('success')
    const session = bench.handle.agent.session
    const preference = session.events.findLast(event => event.type === 'response-language/preference')
    expect(preference?.data).toEqual({ value: 'pt' })
    const run = session.events.findLast(event => event.type === 'command/run')
    const done = session.events.findLast(event => event.type === 'command/done')
    expect(run?.data).not.toHaveProperty('args')
    expect(done?.data.sourceEventSeq).toBe(preference?.seq)

    await send(bench, '这个电费账单怎么支付？')
    expect(bench.adapter.requests.at(-1)?.system).toContain('Reply in Portuguese.')
    const fixed = session.events.findLast(event => event.type === 'response-language/resolved')
    expect(fixed).toMatchObject({
      data: { preference: 'pt', language: 'pt', basis: 'fixed' },
    })
    expect(fixed?.data).not.toHaveProperty('messageId')
    expect(fixed?.data).not.toHaveProperty('confidence')
    expect(JSON.stringify(bench.adapter.requests.at(-1)?.messages)).toContain('这个电费账单')
    expect(bench.ctx.sessionProjections.snapshot(session).values.responseLanguage).toMatchObject({
      available: true,
      currentValue: 'pt',
      resolved: { language: 'pt', basis: 'fixed' },
    })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('keeps the language instruction without withholding or retrying streaming replies', async () => {
    const bench = await harness('yue-Hant-MO', 'standing', ['自動轉賬過唔到數。'], false)
    await send(bench, '我现在的自动转账失败了怎么办？')
    expect(bench.adapter.requests).toHaveLength(1)
    expect(bench.adapter.requests[0]?.system)
      .toContain('Reply in Simplified Chinese characters with standard Mandarin wording and no Cantonese expressions.')
    expect(JSON.stringify(bench.adapter.requests[0]?.messages))
      .toContain('remains authoritative after every tool result')
    expect(bench.handle.agent.session.events.findLast(event => event.type === 'response-language/resolved'))
      .toMatchObject({ data: { preference: 'auto', language: 'zh-Hans', basis: 'detected' } })
    expect(bench.handle.agent.session.events.some(event => event.type === 'response-language/retry')).toBe(false)
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('limits automatic replies to English and the configured fallback', async () => {
    const bench = await harness('yue-Hant-MO', 'standing', ['answer', 'answer', 'answer'], false, ['en'])
    await send(bench, '我现在想查询电费。')
    expect(bench.adapter.requests.at(-1)?.system)
      .toContain('Reply in natural Macau Cantonese written with Traditional Chinese characters.')
    expect(bench.handle.agent.session.events.findLast(event => event.type === 'response-language/resolved'))
      .toMatchObject({ data: { language: 'yue-Hant-MO', basis: 'fallback' } })

    await send(bench, 'How can I check my electricity bill?')
    expect(bench.adapter.requests.at(-1)?.system).toContain('Reply in English.')
    expect(bench.handle.agent.session.events.findLast(event => event.type === 'response-language/resolved'))
      .toMatchObject({ data: { language: 'en', basis: 'detected' } })

    await send(bench, 'Como posso consultar a fatura?')
    expect(bench.adapter.requests.at(-1)?.system)
      .toContain('Reply in natural Macau Cantonese written with Traditional Chinese characters.')
    expect(bench.handle.agent.session.events.findLast(event => event.type === 'response-language/resolved'))
      .toMatchObject({ data: { language: 'yue-Hant-MO', basis: 'fallback' } })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('retries one detectable wrong-language reply before committing the corrected reply', async () => {
    const bench = await harness('zh-Hant', 'standing', ['這是錯誤的中文回覆。', 'This is the corrected English reply.'])
    await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language en',
      new AbortController().signal,
    )

    await send(bench, '如何繳交電費?')

    expect(bench.adapter.requests).toHaveLength(2)
    expect(bench.adapter.requests[1]?.system).toContain('The previous response used the wrong language.')
    const messages = bench.handle.agent.session.events.filter(event => event.type === 'assistant/message')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      data: { message: { content: [{ type: 'text', text: 'This is the corrected English reply.' }] } },
    })
    expect(bench.handle.agent.session.events).toContainEqual(expect.objectContaining({
      type: 'response-language/retry',
      data: { turn: 1, step: 1, expected: 'en', observed: 'zh-Hant' },
    }))
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('turns a wrong-language Auto reply into a source-preserving translation request', async () => {
    const candidate = '根據知識庫，你可以透過網上服務繳交電費。[payment:123]'
    const bench = await harness('zh-Hant', 'standing', [
      candidate,
      'According to the knowledge base, you can pay the electricity bill through the online service. [payment:123]',
    ])

    await send(bench, 'How can I pay the electricity bill?')

    expect(bench.adapter.requests).toHaveLength(2)
    expect(bench.adapter.requests[0]?.system).toContain('Reply in English.')
    expect(bench.adapter.requests[1]?.system).toContain('Translate it into English')
    expect(bench.adapter.requests[1]?.system).toContain(JSON.stringify(candidate))
    expect(bench.handle.agent.session.events.findLast(event => event.type === 'response-language/resolved'))
      .toMatchObject({ data: { preference: 'auto', language: 'en', basis: 'detected' } })
    expect(bench.handle.agent.session.events.findLast(event => event.type === 'assistant/message'))
      .toMatchObject({
        data: {
          message: {
            content: [{
              type: 'text',
              text: 'According to the knowledge base, you can pay the electricity bill through the online service. [payment:123]',
            }],
          },
        },
      })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('applies the same one-retry correction for a Portuguese fixed selection', async () => {
    const bench = await harness('zh-Hant', 'standing', [
      '這是錯誤的中文回覆。',
      'Sim, você pode pagar a fatura de eletricidade online.',
    ])
    await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language pt',
      new AbortController().signal,
    )

    await send(bench, '如何繳交電費?')

    expect(bench.adapter.requests).toHaveLength(2)
    expect(bench.adapter.requests[1]?.system).toContain('Reply in Portuguese.')
    expect(bench.handle.agent.session.events).toContainEqual(expect.objectContaining({
      type: 'response-language/retry',
      data: { turn: 1, step: 1, expected: 'pt', observed: 'zh-Hant' },
    }))
    expect(bench.handle.agent.session.events.findLast(event => event.type === 'assistant/message'))
      .toMatchObject({ data: { message: { content: [{ type: 'text', text: 'Sim, você pode pagar a fatura de eletricidade online.' }] } } })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('accepts standard Traditional Chinese wording for a Cantonese target', async () => {
    const bench = await harness('zh-Hant', 'standing', ['可以透過銀行應用程式繳交電費。'])
    await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language yue-Hant-MO',
      new AbortController().signal,
    )

    await send(bench, '點樣繳交電費？')

    expect(bench.adapter.requests).toHaveLength(1)
    expect(bench.handle.agent.session.events.some(event => event.type === 'response-language/retry')).toBe(false)
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('supports an explicit Hong Kong Cantonese fallback without changing Auto detection', async () => {
    const bench = await harness('yue-Hant-HK')
    await send(bench, 'OK')
    expect(bench.adapter.requests.at(-1)?.system)
      .toContain('Reply in natural Hong Kong Cantonese written with Traditional Chinese characters.')
    expect(bench.handle.agent.session.events.findLast(
      event => event.type === 'response-language/resolved',
    )).toMatchObject({ data: { preference: 'auto', language: 'yue-Hant-HK', basis: 'fallback' } })

    await send(bench, '點樣看間屋企風水？')
    expect(bench.handle.agent.session.events.findLast(
      event => event.type === 'response-language/resolved',
    )).toMatchObject({ data: { preference: 'auto', language: 'yue-Hant-MO', basis: 'detected' } })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('carries the prior response language for an ambiguous Auto follow-up', async () => {
    const bench = await harness()
    await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language en',
      new AbortController().signal,
    )
    await send(bench, '这是中文问题')
    await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language auto',
      new AbortController().signal,
    )
    await send(bench, 'OK')
    expect(bench.adapter.requests.at(-1)?.system).toContain('Reply in English.')
    expect(bench.handle.agent.session.events.findLast(
      event => event.type === 'response-language/resolved',
    )).toMatchObject({ data: { preference: 'auto', language: 'en', basis: 'carried' } })

    const pluginOnly = createUserMessage({
      content: [{ type: 'text', text: '這是工具證據，不是客戶語言。' }],
      source: { kind: 'plugin', plugin: 'evidence-test', form: 'notice', summary: 'Evidence.' },
    })
    bench.handle.agent.send(pluginOnly, 'next-turn', true)
    await bench.handle.agent.whenIdle()
    const toolContinuation = bench.handle.agent.session.events.findLast(
      event => event.type === 'response-language/resolved',
    )
    expect(toolContinuation).toMatchObject({
      data: { preference: 'auto', language: 'en', basis: 'carried' },
    })
    expect(toolContinuation?.data).not.toHaveProperty('messageId')
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('ignores plugin evidence during Auto detection and uses the configured fallback', async () => {
    const bench = await harness('zh-Hant')
    bench.handle.agent.inject(createUserMessage({
      content: [{ type: 'text', text: 'Please answer this English evidence.' }],
      source: {
        kind: 'plugin',
        plugin: 'evidence-test',
        form: 'notice',
        summary: 'English evidence.',
      },
    }))
    await send(bench, 'OK')
    expect(bench.adapter.requests[0]?.system).toContain('Reply in Traditional Chinese')
    expect(bench.handle.agent.session.events.findLast(
      event => event.type === 'response-language/resolved',
    )).toMatchObject({ data: { language: 'zh-Hant', basis: 'fallback' } })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('uses fallback for a plugin-only waking message and a direct image-only prompt', async () => {
    const bench = await harness('zh-Hans')
    const pluginOnly = createUserMessage({
      content: [{ type: 'text', text: 'English plugin material.' }],
      source: { kind: 'plugin', plugin: 'context-test', form: 'notice', summary: 'Context.' },
    })
    bench.handle.agent.send(pluginOnly, 'next-turn', true)
    await bench.handle.agent.whenIdle()
    expect(bench.handle.agent.session.events.findLast(
      event => event.type === 'response-language/resolved',
    )).toMatchObject({ data: { language: 'zh-Hans', basis: 'fallback' } })

    const imageOnly = createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: 'attachment-test',
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        },
      } as never],
      source: { kind: 'user' },
    })
    bench.handle.agent.followup(imageOnly)
    await bench.handle.agent.whenIdle()
    expect(bench.handle.agent.session.events.findLast(
      event => event.type === 'response-language/resolved',
    )).toMatchObject({ data: { language: 'zh-Hans', basis: 'carried' } })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('does not commit a resolution when final pre-step policy rejects the request', async () => {
    const bench = await harness()
    bench.ctx.on('agent/pre-step', () => Promise.resolve({ kind: 'reject' }))
    await send(bench, 'Please answer in English')
    expect(bench.adapter.requests).toHaveLength(0)
    expect(bench.handle.agent.session.events.some(
      event => event.type === 'response-language/resolved',
    )).toBe(false)
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('keeps diagnostic assembly log-free and fails loud when a loop skips assembly', async () => {
    const bench = await harness()
    expect((await bench.ctx.systemPrompt.assemble({ scope: bench.handle.agent })).sections)
      .toContainEqual({ name: 'response-language:policy', text: '' })
    const diagnostic = await bench.ctx.systemPrompt.assemble({
      agent: bench.handle.agent,
      scope: bench.handle.agent,
    })
    expect(diagnostic.sections.find(section => section.name === 'response-language:policy')?.text)
      .toContain('Reply in Traditional Chinese')

    const message = createUserMessage({ content: [{ type: 'text', text: 'probe' }], source: { kind: 'user' } })
    await expect(agentEvents(bench.ctx, bench.handle.agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter', messages: [message] }),
    )).rejects.toThrow(/no assembled request resolution/)
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('also supports an exact Agent-scoped mount', async () => {
    const bench = await harness('zh-Hant', 'agent')
    expect(bench.ctx.sessionProjections.snapshot(bench.handle.agent.session).values.responseLanguage)
      .toMatchObject({ available: true, currentValue: 'auto' })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })
})

describe('response-language preset activation', () => {
  it('defers preset-switch activation past Session.append publication and restores availability once', async () => {
    const bench = await harness()
    const session = bench.handle.agent.session
    const before = session.events.filter(event => event.type === 'response-language/preference').length
    appendForeign(session, 'agent-preset/selected', { agentPreset: 'customer-one' })
    appendForeign(session, 'agent-preset/selected', { agentPreset: 'customer-two' })
    await settleDeferredActivation()
    const preferences = session.events.filter(event => event.type === 'response-language/preference')
    expect(preferences).toHaveLength(before + 1)
    expect(bench.ctx.sessionProjections.snapshot(session).values.responseLanguage)
      .toMatchObject({ available: true, currentValue: 'auto' })
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('cancels deferred activation when the scoped plugin is disposed', async () => {
    const bench = await harness()
    const session = bench.handle.agent.session
    const before = session.events.filter(event => event.type === 'response-language/preference').length
    appendForeign(session, 'agent-preset/selected', { agentPreset: 'customer' })
    await bench.languageFiber.dispose()
    await settleDeferredActivation()
    expect(session.events.filter(event => event.type === 'response-language/preference')).toHaveLength(before)
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('ignores foreign sessions and stale synthetic selection notices', async () => {
    const bench = await harness()
    const session = bench.handle.agent.session
    const before = session.events.filter(event => event.type === 'response-language/preference').length
    const unrelated = bench.ctx.sessions.create()
    bench.ctx.emit('session/event', unrelated, presetSelectionEvent(0))
    bench.ctx.emit('session/event', session, presetSelectionEvent(session.seq + 5))

    const orphan = bench.ctx.sessions.prepare(SessionId(`orphan-${crypto.randomUUID()}`))
    const orphanScope = createScope(bench.ctx, { orphan: true }, { parent: bench.policyKey })
    const orphanAgent = {
      id: orphan.id,
      session: orphan,
      status: 'idle',
      options: {},
      ctx: orphanScope.ctx,
    } as unknown as Agent
    const detachOrphan = bench.ctx.agents.enter(orphanAgent, undefined)
    bench.ctx.emit('session/event', orphan, presetSelectionEvent(0))
    await settleDeferredActivation()
    expect(session.events.filter(event => event.type === 'response-language/preference')).toHaveLength(before)
    detachOrphan()
    await orphanScope.dispose()
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('contains a deferred preference append failure', async () => {
    const bench = await harness()
    const session = bench.handle.agent.session
    const original = session.append.bind(session) as (type: string, data: unknown) => SessionEvent
    Object.defineProperty(session, 'append', {
      configurable: true,
      value: (type: string, data: unknown): SessionEvent => {
        if (type === 'response-language/preference') throw new Error('preference backend failed')
        return original(type, data)
      },
    })
    appendForeign(session, 'agent-preset/selected', { agentPreset: 'customer' })
    await settleDeferredActivation()
    Reflect.deleteProperty(session, 'append')
    expect(session.events.findLast(event => event.type === 'agent-preset/selected')).toBeDefined()
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })
})

describe('response-language configuration and command errors', () => {
  it('rejects root-scope mounting and invalid direct configuration', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(ResponseLanguage, {})).rejects.toThrow(/agent preset scope/)
    expect(ResponseLanguage.resolveConfig({})).toEqual({
      fallbackLanguage: 'zh-Hant',
      autoDetectedLanguages: [...ResponseLanguage.FIXED_RESPONSE_LANGUAGES],
      verifyOutput: true,
    })
    expect(() => ResponseLanguage.resolveConfig({ verifyOutput: 'false' } as never)).toThrow(/boolean/)
    expect(ResponseLanguage.isResponseLanguagePreference(42)).toBe(false)
    expect(ResponseLanguage.isResponseLanguagePreference('en')).toBe(true)
    expect(ResponseLanguage.isResponseLanguagePreference('yue-Hant-HK')).toBe(true)
    expect(ResponseLanguage.resolveConfig({ fallbackLanguage: 'yue-Hant-HK' }))
      .toEqual({
        fallbackLanguage: 'yue-Hant-HK',
        autoDetectedLanguages: [...ResponseLanguage.FIXED_RESPONSE_LANGUAGES],
        verifyOutput: true,
      })
    expect(ResponseLanguage.resolveConfig({ autoDetectedLanguages: ['en'] }))
      .toMatchObject({ autoDetectedLanguages: ['en'] })
    expect(() => ResponseLanguage.resolveConfig({ autoDetectedLanguages: ['de' as never] }))
      .toThrow(/autoDetectedLanguages contains an unknown language/)
    expect(() => ResponseLanguage.resolveConfig({ autoDetectedLanguages: ['en', 'en'] }))
      .toThrow(/must not contain duplicates/)
    expect(() => ResponseLanguage.resolveConfig({ fallbackLanguage: 'de' as never }))
      .toThrow(/fallbackLanguage is unknown/)
    expect(() => ResponseLanguage.resolveConfig({ extra: true } as never))
      .toThrow(/unknown key/)
    await ctx.fiber.dispose()
  })

  it('reports the current value without appending and rejects unknown selections', async () => {
    const bench = await harness()
    const session = bench.handle.agent.session
    const before = session.events.filter(event => event.type === 'response-language/preference').length
    const current = await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language',
      new AbortController().signal,
    )
    const invalid = await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language de',
      new AbortController().signal,
    )
    const same = await bench.ctx.commands.execute(
      bench.handle.agent,
      '/response-language auto',
      new AbortController().signal,
    )
    expect(current?.result).toEqual({ kind: 'success', text: 'response language auto' })
    expect(invalid?.result.kind).toBe('error')
    if (invalid?.result.kind === 'error') {
      expect(invalid.result.text).toContain('unknown response language')
    }
    expect(same?.result).toEqual({ kind: 'success', text: 'response language auto' })
    expect(session.events.filter(event => event.type === 'response-language/preference')).toHaveLength(before)
    await bench.handle.dispose()
    await bench.ctx.fiber.dispose()
  })
})
