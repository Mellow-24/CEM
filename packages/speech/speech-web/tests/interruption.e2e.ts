import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { registerInterruptionRoute } from '../src/interruption.ts'
import { describe, expect, it } from 'vitest'

const cases = [
  { name: 'cantonese-correction', text: '我已經試過網上繳費，都係交唔到。', decision: 'interrupt' },
  { name: 'cantonese-followup', text: '咁如果我冇銀行戶口，仲有咩方法可以交？', decision: 'interrupt' },
  { name: 'english-correction', text: 'I already tried paying online, but the payment failed.', decision: 'interrupt' },
  { name: 'english-followup', text: 'What if I do not have a bank account?', decision: 'interrupt' },
  { name: 'cantonese-acknowledgement', text: '係呀，明白啦。', decision: 'continue' },
  { name: 'english-acknowledgement', text: 'Okay, thank you.', decision: 'continue' },
  { name: 'cantonese-background', text: '阿明，幫我閂下門先。', decision: 'continue' },
  { name: 'english-background', text: 'John, could you turn off the television?', decision: 'continue' },
] as const

describe.skipIf(!process.env.DASHSCOPE_API_KEY)('speech interruption with the configured Qwen provider', () => {
  it('classifies bilingual overlap without generating an answer and reports request latency', async () => {
    const ctx = new Context()
    const routes = new Map<string, (request: Request) => Promise<Response>>()
    ctx.provide('connection', { fetch: { handle(path: string, handler: (request: Request) => Promise<Response>) {
      routes.set(path, handler)
      return ctx.effect(() => () => { routes.delete(path) })
    } } } as never)
    await ctx.plugin(LlmRuntime)
    const model = process.env.DSH_INTERRUPTION_TEST_MODEL ?? 'qwen3.7-flash'
    await ctx.plugin(LlmPiAi, { providers: { 'qwen-dashscope': {
      apiKeyEnv: 'DASHSCOPE_API_KEY',
      api: 'openai-completions', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      compat: { thinkingFormat: 'qwen', supportsDeveloperRole: false },
      reasoning: 'off',
      models: [{ id: model, contextWindow: 1048576, reasoningEfforts: { off: null, high: 'high' } }],
    } } })
    const session = Session.create(SessionId('interruption-live-e2e'))
    const agent = { session, id: session.id, ctx } as Agent
    registerInterruptionRoute(ctx, 'loopback', {
      provider: 'qwen-dashscope', model, timeoutMs: 5000, maxInputChars: 6000, maxOutputTokens: 32, maxConcurrent: 1,
    }, (id) => {
      if (id !== session.id) throw new Error('Unknown test session')
      return agent
    }, (_request, route) => route())
    try {
      const route = routes.get('/api/speech/interruption')!
      const timings: number[] = []
      for (const scenario of cases) {
        const started = performance.now()
        const response = await route(new Request('http://dsh.internal/api/speech/interruption', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, text: scenario.text,
            question: 'Where can I pay my electricity bill?',
            playback: 'You can pay your electricity bill through online banking, MPay or at our customer service centres.' }),
        }))
        const result: unknown = await response.json()
        const elapsedMs = Math.round(performance.now() - started)
        timings.push(elapsedMs)
        console.info(JSON.stringify({ scenario: scenario.name, model, result, elapsedMs }))
        expect.soft(response.status).toBe(200)
        expect.soft(result).toMatchObject({ decision: scenario.decision,
          reason: scenario.decision === 'interrupt' ? 'directed-intent' : 'not-directed' })
      }
      timings.sort((left, right) => left - right)
      const medianMs = (timings[3]! + timings[4]!) / 2
      console.info(JSON.stringify({ model, samples: timings.length, medianMs, maximumMs: timings.at(-1) }))
      expect(session.events.filter(event => event.type === 'speech/interruption-request')).toHaveLength(cases.length)
      expect(session.events.some(event => event.type === 'user/message' || event.type === 'assistant/message')).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 60_000)
})
