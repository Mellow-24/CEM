/** Live Qwen dialogue regression through the shipped CEM preset with isolated approved knowledge. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-customer-service-knowledge'
import type {} from '@deepseek-ai/dsh-response-language'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as WebApp from '@deepseek-ai/dsh-web-app'
import { describe, expect, it, vi } from 'vitest'
import { bootWebPresetHarness } from './web-agent-presets-harness.ts'

const approvedDirectory = fileURLToPath(new URL('../../../knowledge/macau-customer-service/', import.meta.url))
const defaultIndex = fileURLToPath(new URL('../../../.dsh/macau-customer-service.index.json', import.meta.url))
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
  { prompt: '我叫阿欣，澳門客戶聯繫中心喺邊度？', language: 'yue-Hant-MO', includes: /馬交石/u, excludes: /貴姓|點稱呼|怎[樣么]稱呼|如何稱呼|[咩乜]名|你[嘅個]?名|方便.*稱呼|請問.*姓名/u },
] as const

describe.skipIf(!process.env.DASHSCOPE_API_KEY)('live CEM conversational corrections', () => {
  it('retrieves business facts while retaining corrected address preferences and response language', { timeout: 240_000, retry: 0 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cem-dialogue-e2e-'))
    const previous = new Map(isolatedEnvironment.map(name => [name, process.env[name]]))
    let ctx: Context | undefined
    let surfaceCtx: Context | undefined
    let handle: AgentHandle | undefined
    try {
      const directory = join(root, 'knowledge')
      await mkdir(directory)
      const manifestBytes = await readFile(join(approvedDirectory, 'source-manifest.json'))
      const manifestData = JSON.parse(manifestBytes.toString('utf8')) as { sources: { path: string; sha256: string }[] }
      await Promise.all(manifestData.sources.map(async ({ path, sha256 }) => {
        const source = await readFile(join(approvedDirectory, path))
        expect(createHash('sha256').update(source).digest('hex'), path).toBe(sha256)
        await writeFile(join(directory, path), source)
      }))
      const manifest = join(directory, 'source-manifest.json')
      await writeFile(manifest, manifestBytes)
      const seedPath = process.env.DSH_CEM_DIALOGUE_INDEX_PATH
      const indexBytes = await readFile(seedPath ?? defaultIndex).catch((error: unknown) => {
        if (seedPath === undefined && error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      })
      const expectedIdentity = {
        parserVersion: 1,
        manifestHash: createHash('sha256').update(manifestBytes).digest('hex'),
        approvedSourcesHash: createHash('sha256').update(JSON.stringify(manifestData.sources)).digest('hex'),
        embeddingBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        embeddingModel: 'qwen3.7-text-embedding', chunkChars: 1200, chunkOverlapChars: 160, vectorDimension: 1024,
      }
      expect(manifestData.sources).toHaveLength(52)
      const index = join(root, 'knowledge.index.json')
      if (indexBytes !== undefined) {
        const seed = JSON.parse(indexBytes.toString('utf8')) as { identity: Record<string, unknown>; chunks: unknown[] }
        expect(seed.identity).toEqual(expectedIdentity)
        expect(seed.chunks).toHaveLength(507)
        await writeFile(index, indexBytes)
      }
      const seededMtime = indexBytes === undefined ? undefined : (await stat(index)).mtimeMs
      Object.assign(process.env, {
        DSH_HOME: root,
        DSH_CWD: root,
        DSH_MACAU_KNOWLEDGE_DIR: directory,
        DSH_MACAU_KNOWLEDGE_MANIFEST: manifest,
        DSH_MACAU_KNOWLEDGE_INDEX: index,
      })
      const settings = join(root, 'settings.yaml')
      await writeFile(settings, '{}\n')
      ctx = await bootWebPresetHarness(settings, [
        { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
      ])
      surfaceCtx = new Context()
      // The HTTP adapter is inert; the real Web plugin contributes its exact global prompt sections.
      surfaceCtx.provide('webServer', {
        host: '127.0.0.1', port: 3080,
        registerFallback: () => () => {}, applyIndexTaps: (html: string) => html,
      } as unknown as WebServer)
      await surfaceCtx.plugin(SystemPrompt, { persona: '' })
      const sections = vi.spyOn(surfaceCtx.systemPrompt, 'section')
      try {
        WebApp.apply(surfaceCtx, new WebApp.Config({ printUrl: false, surfaceContext: true, trustedHosts: [] }))
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(sections.mock.calls.map(([section]) => section.name)).toEqual(['harness:source', 'app:web-surface'])
        for (const [section] of sections.mock.calls) ctx.systemPrompt.section(section)
      } finally {
        sections.mockRestore()
      }
      const customerCtx = ctx
      handle = await ctx.agents.create({
        sessionId: SessionId(`cem-dialogue-e2e-${randomUUID()}`),
        meta: { cwd: root, agentPreset: 'macau-customer-service' },
        setup: agentCtx => customerCtx.agentPresets.mount(agentCtx, 'macau-customer-service').then(() => undefined),
      })
      const preparedBytes = await readFile(index)
      const prepared = JSON.parse(preparedBytes.toString('utf8')) as { identity: Record<string, unknown>; chunks: unknown[] }
      expect(prepared.identity).toEqual(expectedIdentity)
      expect(prepared.chunks).toHaveLength(507)
      const indexMtime = (await stat(index)).mtimeMs
      if (indexBytes !== undefined) {
        expect(indexMtime, 'A validated seed must be reused during preparation').toBe(seededMtime)
        expect(createHash('sha256').update(preparedBytes).digest('hex')).toBe(createHash('sha256').update(indexBytes).digest('hex'))
      }
      console.info(JSON.stringify({
        approvedSources: manifestData.sources.length, cachedChunks: prepared.chunks.length,
        seeded: indexBytes !== undefined, indexIdentity: prepared.identity,
      }))
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
        expect(system).toContain('DeepSeek Harness implementation checkout')
        expect(system).toContain('DeepSeek Harness Web GUI at http://127.0.0.1:3080')
        expect(system).toContain('client-plugin HMR receiver is active')
        expect((await stat(index)).mtimeMs, 'The approved corpus cache must not be rebuilt').toBe(indexMtime)
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
          try {
            await surfaceCtx?.fiber.dispose()
          } finally {
            for (const [name, value] of previous) {
              if (value === undefined) Reflect.deleteProperty(process.env, name)
              else process.env[name] = value
            }
            await rm(root, { recursive: true, force: true })
          }
        }
      }
    }
  })
})
