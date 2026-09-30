import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { createUserMessage, LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ConnectionFetchHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import * as SpeechWeb from '@deepseek-ai/dsh-speech-web'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface Route {
  handler: (request: Request) => Promise<Response>
  options: ConnectionFetchHandlerOptions
}

type Script = (options: GenerateOptions) => AsyncIterable<StreamChunk>

class Adapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly script: Script) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }] } })
  }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield * this.script(options)
  }
}

async function* output(text = '{"decision":"interrupt"}'): AsyncIterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

const contexts: Context[] = []
const SEMANTIC = { provider: 'intent', model: 'flash', timeoutMs: 100, maxInputChars: 6000, maxOutputTokens: 32, maxConcurrent: 2 }
const CALL = {
  defaultGreeting: 'yue', responseInstructions: 'Answer the caller.',
  greetings: { yue: { text: '你好', asset: '@deepseek-ai/dsh-speech-web/greetings/yue.wav' } },
  playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  maxPendingAudioMs: 8000, utteranceMergeMs: 850,
  interruption: {
    confirmationMs: 420, minimumMeaningfulCharacters: 3, echoMinimumCharacters: 6,
    echoSimilarityThreshold: 0.82, backchannelMaximumCharacters: 6, semantic: SEMANTIC,
  },
  sentenceMaxChars: 72, sentencePauseMinChars: 12, sentenceQueueLimit: 32, responseTimeoutMs: 180000,
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(script: Script = () => output(), config: Partial<typeof SEMANTIC> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const routes = new Map<string, Route>()
  ctx.provide('connection', { fetch: { handle(path: string, handler: Route['handler'], options: ConnectionFetchHandlerOptions) {
    routes.set(path, { handler, options })
    return ctx.effect(() => () => { routes.delete(path) })
  } } } as never)
  const agents = new Map<string, Agent>()
  const session = Session.create(SessionId('voice-session'))
  const agent = { id: session.id, session, ctx } as Agent
  agents.set(agent.id, agent)
  ctx.provide('agents', { get: (id: string) => agents.get(id), roots: () => [...agents.values()] } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(LlmRuntime)
  const adapter = new Adapter(script)
  ctx.llm.registerAdapter(['intent'], adapter)
  await ctx.plugin(SpeechWeb, { authority: 'trusted-host', call: { ...CALL, interruption: { ...CALL.interruption, semantic: { ...SEMANTIC, ...config } } } })
  const route = routes.get('/api/speech/interruption')!
  const send = (text: string, options: { sessionId?: string; signal?: AbortSignal; question?: string; playback?: string } = {}) => route.handler(new Request('http://dsh.internal/api/speech/interruption', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: options.sessionId ?? agent.id, text, question: options.question ?? 'How can I pay my bill?', playback: options.playback ?? 'You can pay online.' }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }))
  return { ctx, agents, agent, adapter, route, routes, send }
}

describe('semantic interruption Host route', () => {
  it('uses the trusted speech authority and logs the exact auxiliary request without customer messages', async () => {
    const host = await harness((options) => {
      const logged = host.agent.session.events.find(event => event.type === 'speech/interruption-request')!
      expect(logged).toMatchObject({ ignorable: true, data: { provider: options.provider, model: options.model, system: options.system, messages: options.messages, reasoningEffort: 'off', temperature: 0, maxTokens: 32 } })
      return output()
    })
    host.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'My bank transfer failed.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const response = await host.send('I already tried online, but it did not work.')
    expect(await response.json()).toEqual({ decision: 'interrupt', reason: 'directed-intent' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(host.route.options).toEqual({ authority: 'trusted-host', maxRequestBodyBytes: 24000 })
    expect(host.adapter.requests).toHaveLength(1)
    const options = host.adapter.requests[0]!
    expect(options).toMatchObject({ provider: 'intent', model: 'flash', sessionId: host.agent.id, reasoningEffort: 'off', temperature: 0, maxTokens: 32 })
    expect(options.tools).toBeUndefined()
    expect(options.messages[0]?.content).toEqual([{ type: 'text', text: JSON.stringify({ recentQuestions: ['My bank transfer failed.'], question: 'How can I pay my bill?', playback: 'You can pay online.', utterance: 'I already tried online, but it did not work.' }) }])
    expect(host.agent.session.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(host.agent.session.events.some(event => event.type === 'response-language/resolved' || event.type === 'assistant/message')).toBe(false)
  })

  it.each(['好', '停！', '嗯', 'Ａ', '1', '𠮷', '🛑', ''])('rejects a single normalized character without a model request: %s', async (text) => {
    const host = await harness()
    expect(await (await host.send(text)).json()).toEqual({ decision: 'continue', reason: 'single-character' })
    expect(host.adapter.requests).toHaveLength(0)
    expect(host.agent.session.events).toHaveLength(0)
  })

  it('still allows the English word stop through the server guard', async () => {
    const host = await harness()
    expect(await (await host.send('stop')).json()).toMatchObject({ decision: 'interrupt' })
    expect(host.adapter.requests).toHaveLength(1)
  })

  it.each(['{"decision":"continue"}', '{"decision":"interrupt","extra":true}', 'interrupt', '{"decision":true}', 'null', '[]'])('strictly validates model output %s', async (text) => {
    const host = await harness(() => output(text))
    expect(await (await host.send('What if I do not have an account?')).json()).toMatchObject({ decision: 'continue' })
  })

  it('bounds the full framed input including system and history', async () => {
    const host = await harness(undefined, { maxInputChars: 2000 })
    expect(await (await host.send('What if I have no account?', { playback: 'a'.repeat(1800) })).json()).toMatchObject({ decision: 'continue', reason: 'input-limit' })
    expect(host.adapter.requests).toHaveLength(0)
    expect((await host.send('a'.repeat(2200))).status).toBe(413)
  })

  it('omits old questions when retaining them would exceed the full prompt limit', async () => {
    const host = await harness(undefined, { maxInputChars: 2000 })
    host.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'a'.repeat(4000) }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(await (await host.send('What if I do not have an account?')).json()).toMatchObject({ decision: 'interrupt' })
    const options = host.adapter.requests[0]!
    const text = options.messages[0]!.content[0]!
    expect(text.type).toBe('text')
    if (text.type !== 'text') throw new Error('Expected classifier input')
    expect(JSON.parse(text.text)).toMatchObject({ recentQuestions: [] })
    expect(options.system!.length + text.text.length).toBeLessThanOrEqual(2000)
  })

  it('refuses invalid methods, JSON fields, non-live and delegated sessions before a model request', async () => {
    const host = await harness()
    expect((await host.route.handler(new Request('http://dsh.internal/api/speech/interruption'))).status).toBe(405)
    expect((await host.route.handler(new Request('http://dsh.internal/api/speech/interruption', { method: 'POST', body: '{}' }))).status).toBe(415)
    for (const body of ['{', '{}', '{"text":"hi","sessionId":"voice-session","question":"","playback":"","extra":1}']) {
      expect((await host.route.handler(new Request('http://dsh.internal/api/speech/interruption', { method: 'POST', headers: { 'content-type': 'application/json' }, body }))).status).toBe(400)
    }
    expect((await host.send('Please explain again.', { sessionId: 'missing' })).status).toBe(404)
    vi.spyOn(host.ctx.agents, 'roots').mockReturnValue([])
    expect((await host.send('Please explain again.')).status).toBe(403)
    expect(host.adapter.requests).toHaveLength(0)
  })

  it('keeps playback on timeout, aborts provider work and admits a later request after cleanup', async () => {
    const host = await harness(async function* (options) {
      await new Promise<void>((resolve) => {
        options.signal!.addEventListener('abort', () => { resolve() }, { once: true })
      })
      yield * output()
    })
    expect(await (await host.send('What if I have no account?')).json()).toEqual({ decision: 'continue', reason: 'timeout' })
    expect(host.adapter.requests[0]!.signal!.aborted).toBe(true)
    await vi.waitFor(() => { expect(host.agent.session.events).toHaveLength(1) })
    await Promise.resolve()
    const next = await host.send('Could you explain another way?')
    expect(await next.json()).toMatchObject({ decision: 'continue', reason: 'timeout' })
    expect(host.adapter.requests).toHaveLength(2)
  })

  it('limits one request per session and total active calls without queueing', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const host = await harness(async function* () { await gate; yield * output() }, { timeoutMs: 1000, maxConcurrent: 1 })
    const first = host.send('What if I have no account?')
    await vi.waitFor(() => { expect(host.adapter.requests).toHaveLength(1) })
    expect(await (await host.send('Could you clarify that?')).json()).toMatchObject({ decision: 'continue', reason: 'busy' })
    const other = Session.create(SessionId('other'))
    host.agents.set(other.id, { ...host.agent, id: other.id, session: other })
    expect(await (await host.send('I have another question.', { sessionId: other.id })).json()).toMatchObject({ decision: 'continue', reason: 'busy' })
    release()
    expect(await (await first).json()).toMatchObject({ decision: 'interrupt' })
    expect(await (await host.send('I have another question.', { sessionId: other.id })).json()).toMatchObject({ decision: 'interrupt' })
  })

  it('returns at the deadline while retaining the slot until a late provider settles', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const host = await harness(async function* () { await gate; yield * output() })
    expect(await (await host.send('What if I do not have an account?')).json()).toMatchObject({ decision: 'continue', reason: 'timeout' })
    const next = host.send('Can you hear me?')
    await Promise.resolve()
    expect(host.adapter.requests).toHaveLength(1)
    release()
    expect(await (await next).json()).toMatchObject({ decision: 'interrupt' })
    expect(host.adapter.requests).toHaveLength(2)
  })

  it('waits for cancelled work before classifying a revised utterance without a parallel model call', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered = 0
    let concurrent = 0
    let peak = 0
    const host = await harness(async function* () {
      entered++
      concurrent++
      peak = Math.max(peak, concurrent)
      try {
        if (entered === 1) await gate
        yield * output()
      } finally { concurrent-- }
    }, { timeoutMs: 1000, maxConcurrent: 1 })
    const old = new AbortController()
    const first = host.send('I already tried paying online.', { signal: old.signal })
    await vi.waitFor(() => { expect(host.adapter.requests).toHaveLength(1) })
    old.abort()
    expect(await (await first).json()).toMatchObject({ decision: 'continue', reason: 'cancelled' })
    const revised = host.send('I already tried paying online, but it still failed.')
    await Promise.resolve()
    expect(host.adapter.requests).toHaveLength(1)
    expect(await (await host.send('Another overlapping candidate.')).json()).toMatchObject({ decision: 'continue', reason: 'busy' })
    release()
    expect(await (await revised).json()).toMatchObject({ decision: 'interrupt' })
    expect(host.adapter.requests).toHaveLength(2)
    expect(peak).toBe(1)
  })

  it('expires a waiting revision without starting a model request or releasing the old active slot', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const host = await harness(async function* () { await gate; yield * output() }, { maxConcurrent: 1 })
    const old = new AbortController()
    const first = host.send('What if I have no account?', { signal: old.signal })
    await vi.waitFor(() => { expect(host.adapter.requests).toHaveLength(1) })
    old.abort()
    await first
    expect(await (await host.send('What if I have no account and no smartphone?')).json())
      .toMatchObject({ decision: 'continue', reason: 'timeout' })
    expect(host.adapter.requests).toHaveLength(1)
    const other = Session.create(SessionId('other-waiter'))
    host.agents.set(other.id, { ...host.agent, id: other.id, session: other })
    expect(await (await host.send('I have another question.', { sessionId: other.id })).json()).toMatchObject({ decision: 'continue', reason: 'busy' })
    release()
  })

  it('discards a waiting revision on disposal and drains the old provider before finishing teardown', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const host = await harness(async function* () { await gate; yield * output() }, { timeoutMs: 1000 })
    const old = new AbortController()
    const first = host.send('What if I have no account?', { signal: old.signal })
    await vi.waitFor(() => { expect(host.adapter.requests).toHaveLength(1) })
    old.abort()
    await first
    const revised = host.send('What if I have no account and no smartphone?')
    await Promise.resolve()
    let disposed = false
    const disposing = host.ctx.fiber.dispose().then(() => { disposed = true })
    expect(await (await revised).json()).toMatchObject({ decision: 'continue', reason: 'cancelled' })
    expect(disposed).toBe(false)
    release()
    await disposing
    expect(disposed).toBe(true)
    expect(host.adapter.requests).toHaveLength(1)
    expect(host.routes.size).toBe(0)
  })

  it('aborts and drains in-flight classification on caller cancellation and plugin disposal', async () => {
    let stopped = 0
    const host = await harness(async function* (options) {
      await new Promise<void>((resolve) => {
        options.signal!.addEventListener('abort', () => { stopped++; resolve() }, { once: true })
      })
      yield * output()
    }, { timeoutMs: 1000 })
    const controller = new AbortController()
    const cancelled = host.send('Please explain this.', { signal: controller.signal })
    await vi.waitFor(() => { expect(host.adapter.requests).toHaveLength(1) })
    controller.abort()
    expect(await (await cancelled).json()).toMatchObject({ decision: 'continue', reason: 'cancelled' })
    await vi.waitFor(() => { expect(stopped).toBe(1) })
    await Promise.resolve()
    const pending = host.send('I need a different method.')
    await vi.waitFor(() => { expect(host.adapter.requests).toHaveLength(2) })
    await host.ctx.fiber.dispose()
    expect(await (await pending).json()).toMatchObject({ decision: 'continue', reason: 'cancelled' })
    expect(stopped).toBe(2)
    expect(host.routes.size).toBe(0)
  })

  it('contains provider errors and excessive output without retries', async () => {
    const host = await harness(() => { throw new Error('provider failed') })
    expect(await (await host.send('Could you explain another way?')).json()).toMatchObject({ decision: 'continue', reason: 'provider-error' })
    expect(host.adapter.requests).toHaveLength(1)
    const oversized = await harness(() => output('x'.repeat(1000)))
    expect(await (await oversized.send('Could you explain another way?')).json()).toMatchObject({ decision: 'continue', reason: 'invalid-output' })
  })

  it('validates deployment limits at the configuration boundary', () => {
    const interruption: NonNullable<SpeechWeb.Config['call']>['interruption'] = { ...CALL.interruption }
    delete interruption.semantic
    const localOnly = new SpeechWeb.Config({ call: { ...CALL, interruption } })
    expect(localOnly.call?.interruption.semantic).toBeUndefined()
    for (const semantic of [
      { ...SEMANTIC, timeoutMs: 0 }, { ...SEMANTIC, maxConcurrent: 0 },
      { ...SEMANTIC, maxOutputTokens: 0 }, { ...SEMANTIC, maxInputChars: 100 },
    ]) {
      expect(() => new SpeechWeb.Config({ call: { ...CALL, interruption: { ...CALL.interruption, semantic } } })).toThrow()
    }
  })
})
