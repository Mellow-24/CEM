/** Live Qwen dialogue regression through the shipped CEM preset with isolated approved knowledge. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-customer-service-knowledge'
import type {} from '@deepseek-ai/dsh-response-language'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { bootWebPresetHarness } from './web-agent-presets-harness.ts'

const approvedDirectory = fileURLToPath(new URL('../../../knowledge/macau-customer-service/', import.meta.url))
const sourceFiles = ['02-賬單問題-04-其他-01.md', '02-賬單問題-05-合約號碼-01.md']
const isolatedEnvironment = ['DSH_HOME', 'DSH_CWD', 'DSH_MACAU_KNOWLEDGE_DIR', 'DSH_MACAU_KNOWLEDGE_MANIFEST', 'DSH_MACAU_KNOWLEDGE_INDEX'] as const
const namingInability = /(?:未能夠?|無法|不能|唔能夠).{0,16}(?:記錄|記住|識別).{0,12}(?:稱呼|姓名|名字)/u
const scenarios = [
  { prompt: '我冇合約號碼，可唔可以用地址查詢賬單？', language: 'yue-Hant-MO', includes: /合約號碼/u, excludes: /貴姓|點稱呼|怎[樣么]稱呼|如何稱呼|[咩乜]名|你[嘅個]?名|方便.*稱呼|請問.*姓名/u },
  { prompt: '唔係，我問你公司嘅地址啊。', language: 'yue-Hant-MO', includes: /馬交石/u, excludes: /只可以用合約號碼|只可.*合約號碼/u },
  { prompt: '你仲未稱呼我。', language: 'yue-Hant-MO', includes: /稱呼|貴姓/u, excludes: /合約|賬單|帳單|馬交石|氹仔|服務中心|9點|辦公|地址/u },
  { prompt: '我姓陳，叫我陳小姐就得。', language: 'yue-Hant-MO', includes: /陳小姐/u, excludes: /合約|賬單|帳單|馬交石|氹仔|服務中心|9點|辦公|地址/u },
  { prompt: '唔係陳小姐，請叫我陳生。', language: 'yue-Hant-MO', includes: /陳生/u, excludes: /陳小姐|合約|賬單|帳單|馬交石|氹仔|服務中心|9點|辦公|地址/u },
  { prompt: 'Thank you.', language: 'yue-Hant-MO', includes: /\p{Script=Han}/u, excludes: /陳小姐|合約|賬單|帳單|馬交石|氹仔|服務中心|9點|辦公|地址/u },
  { prompt: 'Please answer in English. What should you call me?', language: 'en', includes: /Mr\.?\s+(?:Chan|Chen)/iu, excludes: /\p{Script=Han}|\bMiss\b|\bMs\b/iu },
  { prompt: '我叫阿明。', language: 'yue-Hant-MO', includes: /阿明/u, excludes: /陳生|陳小姐|\b(?:Chan|Chen)\b|合約|賬單|帳單|馬交石|氹仔|服務中心|9點|辦公|地址/iu },
] as const

describe.skipIf(!process.env.DASHSCOPE_API_KEY)('live CEM conversational corrections', () => {
  it('retrieves business facts while retaining corrected address preferences and response language', { timeout: 240_000, retry: 0 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cem-dialogue-e2e-'))
    const previous = new Map(isolatedEnvironment.map(name => [name, process.env[name]]))
    let ctx: Context | undefined
    let handle: AgentHandle | undefined
    try {
      const directory = join(root, 'knowledge')
      await mkdir(directory)
      const sources = await Promise.all(sourceFiles.map(async (path) => {
        const source = await readFile(join(approvedDirectory, path))
        await writeFile(join(directory, path), source)
        return { path, sha256: createHash('sha256').update(source).digest('hex') }
      }))
      const manifest = join(directory, 'source-manifest.json')
      await writeFile(manifest, `${JSON.stringify({ version: 1, sources })}\n`)
      Object.assign(process.env, {
        DSH_HOME: root,
        DSH_CWD: root,
        DSH_MACAU_KNOWLEDGE_DIR: directory,
        DSH_MACAU_KNOWLEDGE_MANIFEST: manifest,
        DSH_MACAU_KNOWLEDGE_INDEX: join(root, 'knowledge.index.json'),
      })
      const settings = join(root, 'settings.yaml')
      await writeFile(settings, '{}\n')
      ctx = await bootWebPresetHarness(settings, [
        { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
      ])
      const customerCtx = ctx
      handle = await ctx.agents.create({
        sessionId: SessionId(`cem-dialogue-e2e-${randomUUID()}`),
        meta: { cwd: root, agentPreset: 'macau-customer-service' },
        setup: agentCtx => customerCtx.agentPresets.mount(agentCtx, 'macau-customer-service').then(() => undefined),
      })
      const agent = handle.agent
      for (const scenario of scenarios) {
        const before = agent.session.events.length
        const startedAt = Date.now()
        agent.followup(createUserMessage({ content: [{ type: 'text', text: scenario.prompt }], source: { kind: 'user' } }))
        await agent.whenIdle()
        const events = agent.session.events.slice(before)
        const replies = events.filter(event => event.type === 'assistant/message')
        const answer = replies.flatMap(event => event.data.message.content
          .flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
        const retrievals = events.filter(event => event.type === 'customer-service-knowledge/retrieval')
        const language = events.find(event => event.type === 'response-language/resolved')
        const firstText = events.find(event => event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta' && event.data.chunk.text.length > 0)
        const header = agent.session.events.findLast(event => event.type === 'request/header')
        const system = header?.data.header.system ?? ''
        console.info(JSON.stringify({
          scenario: scenario.prompt,
          answer,
          language: language?.data.language,
          requestHeaderSha256: createHash('sha256').update(system).digest('hex'),
          firstTextMs: firstText === undefined ? null : firstText.time - startedAt,
          totalMs: Date.now() - startedAt,
          retrievals: retrievals.map(event => ({
            status: event.data.status, sourceCount: event.data.sourceCount,
            reranked: event.data.reranked, durationMs: event.data.durationMs,
          })),
        }))
        expect(system).toContain('如果客户本轮只有问候、感谢、道歉、自我介绍、称呼要求或更正称谓')
        expect(system).toContain('This brevity rule does not apply to business questions')
        expect(replies, scenario.prompt).toHaveLength(1)
        expect(replies[0]?.data.message.source).toMatchObject({ provider: 'qwen-dashscope', model: 'qwen3.7-flash' })
        expect(retrievals, scenario.prompt).toHaveLength(1)
        expect(retrievals[0]?.data).toMatchObject({ query: scenario.prompt, reranked: true })
        expect(language?.data.language, scenario.prompt).toBe(scenario.language)
        expect(firstText, scenario.prompt).toBeDefined()
        expect(answer, scenario.prompt).toMatch(scenario.includes)
        expect(answer, scenario.prompt).not.toMatch(scenario.excludes)
        if (scenario.prompt === '你仲未稱呼我。') expect(answer).not.toMatch(namingInability)
      }
    } finally {
      try {
        await handle?.dispose()
      } finally {
        try {
          await ctx?.fiber.dispose()
        } finally {
          for (const [name, value] of previous) {
            if (value === undefined) Reflect.deleteProperty(process.env, name)
            else process.env[name] = value
          }
          await rm(root, { recursive: true, force: true })
        }
      }
    }
  })
})
