import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-customer-service-knowledge'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QualityEngine, parseQualityResult } from '../src/quality-engine.ts'
import { inspectQualityEvents, redactQualityText, summarizeQualityRun } from '../src/quality-records.ts'
import type { QualityConfig } from '../src/quality-types.ts'
import { QualityAdapter, seedQualityConversation, qualityAnswer } from './quality-fixture.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.reverse().splice(0)) await close() })
const weights = { intent: 20, retrieval: 20, grounding: 25, completion: 15, expression: 10, execution: 10 }

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'quality-test-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SessionStore).await(); await ctx.plugin(LlmRuntime).await()
  cleanup.push(() => ctx.fiber.dispose())
  const adapter = new QualityAdapter()
  ctx.llm.registerAdapter(['quality-test'], adapter)
  const config: QualityConfig = { directory, provider: 'quality-test', model: 'quality-test', timeoutMs: 2000,
    maxInputBytes: 100000, maxEvents: 10000, maxOutputTokens: 2000, maxRuns: 100, maxRecordBytes: 300000,
    maxTurns: 5, slowResponseMs: 10000 }
  const engine = new QualityEngine(ctx, config, async () => {})
  cleanup.push(() => engine.dispose())
  const session = ctx.sessions.create(SessionId('quality-customer'))
  seedQualityConversation(session)
  const inspection = await engine.inspect(session.id)
  const request = { sessionId: session.id, expectedFingerprint: inspection.fingerprint, weights }
  return { ctx, config, directory, engine, adapter, session, inspection, request }
}

describe('session quality evaluation', () => {
  it('projects automatic knowledge retrieval as an inspectable operator trace', async () => {
    const b = await setup()
    const session = b.ctx.sessions.create(SessionId('automatic-quality-trace'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('customer-service-knowledge/retrieval', {
      turn: 1,
      step: 1,
      query: '如何繳費？',
      status: 'found',
      reason: null,
      reranked: true,
      sourceCount: 1,
      durationMs: 680,
      evidence: '可透過澳電應用程式繳費。',
    })
    const inspection = inspectQualityEvents(session.header, session.events, b.config)
    expect(inspection.records).toEqual([
      expect.objectContaining({
        kind: 'tool',
        name: '自動知識檢索',
        input: '如何繳費？',
        output: '可透過澳電應用程式繳費。',
        durationMs: 680,
      }),
    ])
  })

  it('uses recorded tools, excludes reasoning, and permits read-only inspection of unfinished turns', async () => {
    const b = await setup()
    expect(b.inspection.records.find(record => record.kind === 'tool')).toMatchObject({ seq: 3, endSeq: 4, error: false })
    expect(JSON.stringify(b.inspection)).not.toContain('PRIVATE_REASONING')
    expect(b.inspection.turns).toEqual([1])
    expect(() => inspectQualityEvents(b.session.header, b.session.events, { ...b.config, maxEvents: 1 })).toThrow('評估限制')
    expect(() => inspectQualityEvents(b.session.header, b.session.events, { ...b.config, maxInputBytes: 1 })).toThrow('完整評估限制')
    b.session.append('turn/start', { turn: 2 })
    const active = await b.engine.inspect(b.session.id)
    expect(active.unfinishedTurns).toEqual([2])
    expect(active.records).toEqual(b.inspection.records)
    const selected = await b.engine.start({ ...b.request, expectedFingerprint: active.fingerprint })
    await vi.waitFor(async () => { expect((await b.engine.get(selected.id)).status).toBe('completed') })
    expect(b.adapter.requests).toHaveLength(1)
    await expect(b.engine.start({ ...b.request, expectedFingerprint: active.fingerprint, turn: 2 })).rejects.toThrow('未完成回合')
  })

  it('persists the exact auxiliary request before dispatch without writing the customer log', async () => {
    const b = await setup()
    const events = b.session.events
    const run = await b.engine.start(b.request)
    await vi.waitFor(async () => { expect((await b.engine.get(run.id)).status).toBe('completed') })
    const finished = await b.engine.get(run.id)
    expect(b.session.events).toBe(events)
    expect(b.adapter.requests).toHaveLength(1)
    expect(b.adapter.requests[0]?.tools).toBeUndefined()
    expect(b.adapter.requests[0]?.reasoningEffort).toBe('off')
    const audit = JSON.parse(await readFile(join(b.directory, `${run.id}.request.json`), 'utf8')) as {
      events: { data: { messages: unknown; system: string } }[]
    }
    expect(audit.events[0]!.data.messages).toEqual(b.adapter.requests[0]?.messages)
    expect(audit.events[0]!.data.system).toEqual(b.adapter.requests[0]?.system)
    expect(summarizeQualityRun(finished)).toMatchObject({ score: 88, coverage: 100, reviewed: false, issue: 'none' })
    const restarted = new QualityEngine(b.ctx, b.config, async () => {})
    expect((await restarted.list())[0]?.id).toBe(run.id)
    await restarted.dispose()
  })

  it('enforces snapshot identity, turn membership, and valid weights before model dispatch', async () => {
    const b = await setup()
    await expect(b.engine.start({ ...b.request, expectedFingerprint: 'stale' })).rejects.toThrow('會話記錄已變更')
    await expect(b.engine.start({ ...b.request, turn: 99 })).rejects.toThrow('有效回合')
    await expect(b.engine.start({ ...b.request, weights: { ...weights, intent: -1 } })).rejects.toThrow()
    await expect(b.engine.start({ ...b.request, weights: { ...weights, intent: 10 } })).rejects.toThrow()
    expect(b.adapter.requests).toHaveLength(0)
  })

  it('records failed output and permits a fresh retry without fabricating a score', async () => {
    const b = await setup()
    b.adapter.answer = 'not json'
    const first = await b.engine.start(b.request)
    await vi.waitFor(async () => { expect((await b.engine.get(first.id)).status).toBe('failed') })
    expect((await b.engine.list())[0]?.score).toBeNull()
    b.adapter.answer = JSON.stringify(qualityAnswer())
    const second = await b.engine.start(b.request)
    expect(second.id).not.toBe(first.id)
    await vi.waitFor(async () => { expect((await b.engine.get(second.id)).status).toBe('completed') })
  })

  it('rejects invented evidence, duplicate dimensions and omitted turns', async () => {
    const b = await setup()
    const run = await b.engine.start(b.request)
    const response = qualityAnswer()
    response.turns[0]!.scores[0]!.evidenceSeqs = [999]
    expect(() => parseQualityResult(JSON.stringify(response), run, 10000)).toThrow('不存在的證據')
    response.turns[0]!.scores[0] = response.turns[0]!.scores[1]!
    expect(() => parseQualityResult(JSON.stringify(response), run, 10000)).toThrow('不得重複')
    expect(() => parseQualityResult('{"turns":[]}', run, 10000)).toThrow()
  })

  it('accepts one JSON code fence while retaining strict result validation', async () => {
    const b = await setup()
    const run = await b.engine.start(b.request)
    const answer = `\`\`\`json\n${JSON.stringify(qualityAnswer())}\n\`\`\``
    expect(parseQualityResult(answer, run, 10000)).toHaveLength(1)
    expect(() => parseQualityResult('', run, 10000)).toThrow('完整 JSON')
  })

  it('preserves automatic scores and requires reasoned compare-and-set review and issue transitions', async () => {
    const b = await setup()
    const admitted = await b.engine.start(b.request)
    await vi.waitFor(async () => { expect((await b.engine.get(admitted.id)).status).toBe('completed') })
    let run = await b.engine.get(admitted.id)
    const request = { id: run.id, expectedRevision: run.revision, action: 'review' as const, reason: '人工核對知識片段', score: 85 }
    await expect(b.engine.review({ ...request, reason: ' ' })).rejects.toThrow()
    await expect(b.engine.review({ ...request, score: 101 })).rejects.toThrow()
    run = await b.engine.review(request)
    expect(summarizeQualityRun(run)).toMatchObject({ reviewedScore: 85, score: 88, reviewed: true })
    await expect(b.engine.review(request)).rejects.toThrow('其他操作變更')
    await expect(b.engine.review({ id: run.id, expectedRevision: run.revision, action: 'resolve-issue', reason: 'test' })).rejects.toThrow('整改狀態')
    for (const action of ['open-issue', 'resolve-issue', 'reopen-issue'] as const) {
      run = await b.engine.review({ id: run.id, expectedRevision: run.revision, action, reason: '核驗記錄與處理結果' })
    }
    expect(run.reviews).toHaveLength(4)
    expect(summarizeQualityRun(run).issue).toBe('open')
  })

  it('rejects linked records and out-of-range identifiers, and recovers interrupted jobs', async () => {
    const b = await setup()
    const first = await b.engine.start(b.request)
    await vi.waitFor(async () => { expect((await b.engine.get(first.id)).status).toBe('completed') })
    const run = await b.engine.get(first.id)
    run.status = 'running'
    await writeFile(join(b.directory, `${run.id}.run.json`), JSON.stringify(run))
    expect((await b.engine.get(run.id)).error).toContain('服務重啟')
    await expect(b.engine.get('../escape' as typeof run.id)).rejects.toThrow()
    await rm(join(b.directory, `${run.id}.run.json`))
    await symlink(join(b.directory, `${run.id}.request.json`), join(b.directory, `${run.id}.run.json`))
    await expect(b.engine.get(run.id)).rejects.toThrow()
    expect((await readdir(b.directory)).some(name => name.endsWith('.tmp'))).toBe(false)
  })

  it('redacts credentials and personal identifiers before model and operator projection', () => {
    const result = redactQualityText('Authorization: Bearer token-value api_key="SECRET" email=test@example.com phone=66123456')
    for (const secret of ['token-value', 'SECRET', 'test@example.com', '66123456']) expect(result).not.toContain(secret)
  })
})
