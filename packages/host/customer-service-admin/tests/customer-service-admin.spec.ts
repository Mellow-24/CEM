import { createHash } from 'node:crypto'
import {
  mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { WikiCompiler } from '@deepseek-ai/dsh-customer-service-wiki'
import type { WikiCompilerConfig } from '@deepseek-ai/dsh-customer-service-wiki'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CustomerServiceAdminGateway from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { CustomerServiceWikiPageId } from '../src/types.ts'

interface HarnessPaths {
  readonly root: string
  readonly ragSources: string
  readonly ragManifest: string
  readonly ragIndex: string
  readonly wikiSources: string
  readonly wikiDrafts: string
  readonly wikiReleases: string
  readonly badCases: string
  readonly staging: string
  readonly wikiSchema: string
  readonly wikiBaseline: string
  readonly wikiRules: string
  readonly wikiManifest: string
  readonly wikiMap: string
}

interface BadCaseFixture {
  id: string
  status: 'open' | 'closed'
  preset: string
  retrieval: 'rag' | 'llm-wiki'
  capturedAt: string
  queryLanguage: string
  query: string
  verdict: 'pass' | 'fail'
  diagnosis: { summary: string; failureTypes: unknown }
  acceptanceCriteria: unknown
}

const temporaryDirectories: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function badCase(overrides: Partial<BadCaseFixture> = {}): BadCaseFixture {
  return {
    id: 'case-1',
    status: 'open',
    preset: 'macau-customer-service',
    retrieval: 'rag',
    capturedAt: '2026-09-04',
    queryLanguage: 'en',
    query: 'How do I inspect a bill?',
    verdict: 'fail',
    diagnosis: { summary: 'The expected source was not selected.', failureTypes: ['retrieval-ranking'] },
    acceptanceCriteria: ['The exact source is returned.'],
    ...overrides,
  }
}

async function updateFrontmatter(path: string): Promise<void> {
  const text = await readFile(path, 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(text)
  if (match === null) throw new Error('test Wiki draft has no frontmatter')
  const value = JSON.parse(match[1] ?? '') as Record<string, unknown>
  value['status'] = 'approved'
  await writeFile(path, `---\n${JSON.stringify(value, null, 2)}\n---\n${match[2] ?? ''}`)
}

async function createPaths(): Promise<HarnessPaths> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-customer-service-admin-'))
  temporaryDirectories.push(root)
  const paths: HarnessPaths = {
    root,
    ragSources: join(root, 'rag-sources'),
    ragManifest: join(root, 'rag-sources', 'source-manifest.json'),
    ragIndex: join(root, 'cache', 'rag-index.json'),
    wikiSources: join(root, 'wiki-sources'),
    wikiDrafts: join(root, 'wiki-drafts'),
    wikiReleases: join(root, 'wiki-releases'),
    badCases: join(root, 'bad-cases.jsonl'),
    staging: join(root, 'staging'),
    wikiSchema: join(root, 'schema.md'),
    wikiBaseline: join(root, 'baseline.md'),
    wikiRules: join(root, 'rules.md'),
    wikiManifest: join(root, 'wiki-source-manifest.json'),
    wikiMap: join(root, 'wiki-map.md'),
  }
  await Promise.all([
    mkdir(paths.ragSources),
    mkdir(paths.wikiSources),
    mkdir(paths.wikiDrafts),
  ])
  await Promise.all([
    writeFile(paths.wikiSchema, '# Schema\n'),
    writeFile(paths.wikiBaseline, '# Baseline\n'),
    writeFile(paths.wikiRules, '# Rules\n'),
  ])
  return paths
}

function wikiCompilerConfig(paths: HarnessPaths): WikiCompilerConfig {
  return {
    sourceDirectory: paths.wikiSources,
    draftDirectory: paths.wikiDrafts,
    releaseDirectory: paths.wikiReleases,
    baselinePath: paths.wikiBaseline,
    rulesPath: paths.wikiRules,
    sourceManifestPath: paths.wikiManifest,
    knowledgeMapPath: paths.wikiMap,
    schemaPath: paths.wikiSchema,
    compilerBaseURL: 'http://wiki.test/v1',
    compilerModel: 'compiler',
    compilerMaxSourceChars: 1_000,
    compilerMaxOutputTokens: 1_024,
    compilerMaxResponseChars: 4_096,
    compilerMaxRequestChars: 8_000,
    operatorContextMaxChars: 2_000,
    crossSourceMaxPageChars: 2_000,
    crossSourcePageId: 'company-overview',
    requestTimeoutMs: 1_000,
  }
}

function config(paths: HarnessPaths, overrides: Partial<Config> = {}): Config {
  return {
    rag: {
      sourceDirectory: paths.ragSources,
      sourceManifestPath: paths.ragManifest,
      indexPath: paths.ragIndex,
      embeddingBaseURL: 'http://knowledge.test/v1',
      embeddingModel: 'embedding-model',
      rerankerURL: '',
      rerankerModel: '',
      rerank: false,
      embeddingBatchSize: 4,
      chunkChars: 120,
      chunkOverlapChars: 12,
      candidateCount: 4,
      resultCount: 2,
      minimumVectorScore: -1,
      minimumRerankScore: 0,
      maxQueryBytes: 256,
      maxExcerptBytes: 256,
      maxResultBytes: 4_096,
      requestTimeoutMs: 1_000,
    },
    wiki: {
      sourceDirectory: paths.wikiSources,
      releaseDirectory: paths.wikiReleases,
      navigationMaxChars: 2_000,
      evidenceChunkChars: 120,
      evidenceChunkOverlapChars: 12,
      resultCount: 4,
      maxResultChars: 1_000,
      queryMaxChars: 100,
    },
    badCasesPath: paths.badCases,
    stagingDirectory: paths.staging,
    limits: {
      maxDocuments: 20,
      maxWikiPages: 20,
      maxBadCases: 20,
      maxBadCasesBytes: 20_000,
      maxIndexBytes: 200_000,
      maxStagedDocumentBytes: 64,
    },
    ...overrides,
  }
}

async function writeFixtures(
  paths: HarnessPaths,
  options: { readonly extraWikiSource?: boolean } = {},
): Promise<void> {
  const ragText = '# Billing\n\nCustomers may inspect their electricity bill online.\n'
  await writeFile(join(paths.ragSources, 'billing.md'), ragText)
  await writeFile(paths.ragManifest, `${JSON.stringify({
    version: 1,
    sources: [{ path: 'billing.md', sha256: digest(ragText) }],
  }, null, 2)}\n`)

  await writeFile(join(paths.wikiSources, 'service.md'), 'alpha service evidence for Macau customers')
  if (options.extraWikiSource === true) {
    await writeFile(join(paths.wikiSources, 'outage.md'), 'beta outage evidence for Macau customers')
  }
  const compiler = new WikiCompiler(wikiCompilerConfig(paths), () => {})
  await compiler.compile(undefined, false, true)
  const drafts = (await readdir(paths.wikiDrafts)).filter(name => name.endsWith('.md'))
  await Promise.all(drafts.map(name => updateFrontmatter(join(paths.wikiDrafts, name))))
  await compiler.publish()

  await writeFile(paths.badCases, `${JSON.stringify(badCase())}\n`)
}

function installEmbeddingFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body !== 'string') throw new Error('missing embedding body')
    const body = JSON.parse(init.body) as { input: string[] }
    return Response.json({ data: body.input.map(() => ({ embedding: [1, 0] })) })
  }))
}

async function harness(): Promise<{
  readonly paths: HarnessPaths
  readonly gateway: CustomerServiceAdminGateway
}> {
  const paths = await createPaths()
  await writeFixtures(paths)
  const gateway = await installGateway(paths)
  return { paths, gateway }
}

async function installGateway(paths: HarnessPaths, overrides: Partial<Config> = {}): Promise<CustomerServiceAdminGateway> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(CustomerServiceAdminGateway, config(paths, overrides))
  return ctx.get('customerServiceAdmin') as CustomerServiceAdminGateway
}

describe('CustomerServiceAdminGateway projections', () => {
  it('publishes the customerServiceAdmin inspection, quality and knowledge methods', async () => {
    const { gateway } = await harness()
    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'customerServiceAdmin',
      namespace: 'customerServiceAdmin',
    })
    expect(remoteMethods(gateway)).toEqual([
      { method: 'inspectConversation', invocation: { kind: 'direct' } },
      { method: 'startQuality', invocation: { kind: 'direct' } },
      { method: 'listQuality', invocation: { kind: 'direct' } },
      { method: 'getQuality', invocation: { kind: 'direct' } },
      { method: 'reviewQuality', invocation: { kind: 'direct' } },
      { method: 'overview', invocation: { kind: 'direct' } },
      { method: 'listDocuments', invocation: { kind: 'direct' } },
      { method: 'listBadCases', invocation: { kind: 'direct' } },
      { method: 'searchTest', invocation: { kind: 'direct' } },
      { method: 'listStagedDocuments', invocation: { kind: 'direct' } },
      { method: 'stageTextDocument', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current overview, documents, release metadata, and bounded bad cases', async () => {
    const { gateway, paths } = await harness()
    const overview = await gateway.overview()
    expect(overview).toMatchObject({
      rag: {
        documents: 1,
        config: { embeddingModel: 'embedding-model', rerank: false },
        index: { state: 'missing' },
      },
      wiki: { release: { sourceArtifacts: 1 } },
      badCases: { total: 1, open: 1, closed: 0 },
    })
    expect(overview.rag.chunks).toBeGreaterThan(0)
    expect(overview.wiki.release.pages).toHaveLength(1)

    expect((await gateway.listBadCases()).items[0]).toMatchObject({
      badCaseId: 'case-1',
      retrieval: 'rag',
      summary: 'The expected source was not selected.',
      failureTypes: ['retrieval-ranking'],
    })
    let documents = await gateway.listDocuments()
    expect(documents.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ retrieval: 'rag', relativePath: 'billing.md', state: 'approved' }),
      expect.objectContaining({ retrieval: 'llm-wiki', relativePath: 'service.md', state: 'published' }),
    ]))

    await writeFile(join(paths.wikiSources, 'service.md'), 'changed alpha service evidence')
    await writeFile(join(paths.wikiSources, 'draft.txt'), 'not published')
    documents = await gateway.listDocuments()
    expect(documents.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'service.md', state: 'changed' }),
      expect.objectContaining({ relativePath: 'draft.txt', state: 'unpublished' }),
    ]))
  })

  it('runs RAG and current-release Wiki retrieval without generating an answer', async () => {
    installEmbeddingFetch()
    const { gateway } = await harness()
    const rag = await gateway.searchTest({ retrieval: 'rag', query: 'electricity bill' })
    expect(rag).toMatchObject({ retrieval: 'rag', status: 'found', reranked: false })
    if (rag.retrieval !== 'rag') throw new Error('expected RAG result')
    expect(rag.sources[0]).toMatchObject({ relativePath: 'billing.md', title: 'Billing' })
    expect(rag.durationMs).toBeGreaterThanOrEqual(0)
    expect((await gateway.overview()).rag.index).toMatchObject({
      state: 'present',
      indexedChunks: 1,
      vectorDimension: 2,
      matchesConfiguredIdentity: true,
    })

    const pageId = (await gateway.overview()).wiki.release.pages[0]?.pageId
    if (pageId === undefined) throw new Error('expected Wiki page')
    const wiki = await gateway.searchTest({ retrieval: 'llm-wiki', pageId, query: 'alpha service' })
    expect(wiki).toMatchObject({ retrieval: 'llm-wiki', status: 'found', pageId })
    if (wiki.retrieval !== 'llm-wiki') throw new Error('expected Wiki result')
    expect(wiki.sources[0]).toMatchObject({ relativePath: 'service.md' })
    expect(await gateway.searchTest({ retrieval: 'llm-wiki', pageId, query: 'unmatched-zebra-token' }))
      .toMatchObject({ retrieval: 'llm-wiki', status: 'not-found', sources: [] })
    await expect(gateway.searchTest({
      retrieval: 'llm-wiki',
      pageId: 'missing' as CustomerServiceWikiPageId,
      query: 'alpha',
    })).rejects.toThrow('is not in the current release')
  })

  it('reports empty RAG state, preserves plain-text sources, and logs reranker fallback', async () => {
    const paths = await createPaths()
    await writeFixtures(paths)
    await rm(join(paths.ragSources, 'billing.md'))
    await writeFile(paths.ragManifest, JSON.stringify({ version: 1, sources: [] }))
    const gateway = await installGateway(paths)
    expect(await gateway.searchTest({ retrieval: 'rag', query: 'anything' })).toMatchObject({
      retrieval: 'rag',
      status: 'not-found',
      reason: 'empty-corpus',
      sources: [],
    })

    const plainText = 'plain evidence without a heading'
    await writeFile(join(paths.ragSources, 'plain.txt'), plainText)
    await writeFile(paths.ragManifest, JSON.stringify({
      version: 1,
      sources: [{ path: 'plain.txt', sha256: digest(plainText) }],
    }))
    installEmbeddingFetch()
    const plain = await gateway.searchTest({ retrieval: 'rag', query: 'plain evidence' })
    expect(plain).toMatchObject({ retrieval: 'rag', status: 'found' })
    if (plain.retrieval !== 'rag') throw new Error('expected RAG result')
    expect(plain.sources[0]).not.toHaveProperty('section')

    const rerankPaths = await createPaths()
    await writeFixtures(rerankPaths)
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).includes('rerank.test')) return new Response('unavailable', { status: 503 })
      if (typeof init?.body !== 'string') throw new Error('missing embedding body')
      const body = JSON.parse(init.body) as { input: string[] }
      return Response.json({ data: body.input.map(() => ({ embedding: [1, 0] })) })
    })
    vi.stubGlobal('fetch', fetch)
    const rerankGateway = await installGateway(rerankPaths, {
      rag: {
        ...config(rerankPaths).rag,
        rerank: true,
        rerankerURL: 'http://rerank.test/v1',
        rerankerModel: 'reranker',
      },
    })
    expect(await rerankGateway.searchTest({ retrieval: 'rag', query: 'bill' }))
      .toMatchObject({ retrieval: 'rag', status: 'found', reranked: false })
    expect(fetch).toHaveBeenCalledWith('http://rerank.test/v1', expect.anything())
  })

  it('reports malformed, stale, and oversized cache files without rebuilding them', async () => {
    const { gateway, paths } = await harness()
    await mkdir(dirname(paths.ragIndex), { recursive: true })
    await writeFile(paths.ragIndex, '{')
    expect((await gateway.overview()).rag.index.state).toBe('invalid')
    await writeFile(paths.ragIndex, 'x'.repeat(200_001))
    expect((await gateway.overview()).rag.index).toMatchObject({ state: 'invalid', sizeBytes: 200_001 })

    installEmbeddingFetch()
    await gateway.searchTest({ retrieval: 'rag', query: 'bill' })
    interface CacheFixture {
      [key: string]: unknown
      version: unknown
      identity: Record<string, unknown>
      chunks: Array<Record<string, unknown>>
    }
    const valid = JSON.parse(await readFile(paths.ragIndex, 'utf8')) as CacheFixture
    const changed = (mutate: (cache: CacheFixture) => void): CacheFixture => {
      const cache = structuredClone(valid)
      mutate(cache)
      return cache
    }
    const invalid: unknown[] = [
      null,
      {},
      changed((cache) => { cache['extra'] = true }),
      changed((cache) => { delete (cache as Record<string, unknown>)['chunks']; cache['extra'] = true }),
      { version: 2, identity: null, chunks: [] },
      { version: 2, identity: valid.identity, chunks: {} },
      changed((cache) => { cache.identity['extra'] = true }),
      changed((cache) => { delete cache.identity['parserVersion']; cache.identity['extra'] = true }),
      changed((cache) => { cache.identity['parserVersion'] = 2 }),
      changed((cache) => { cache.identity['manifestHash'] = 1 }),
      changed((cache) => { cache.identity['manifestHash'] = 'bad' }),
      changed((cache) => { cache.identity['approvedSourcesHash'] = 1 }),
      changed((cache) => { cache.identity['approvedSourcesHash'] = 'bad' }),
      changed((cache) => { cache.identity['embeddingBaseURL'] = 1 }),
      changed((cache) => { cache.identity['embeddingModel'] = 1 }),
      changed((cache) => { cache.identity['chunkChars'] = 1.5 }),
      changed((cache) => { cache.identity['chunkChars'] = 0 }),
      changed((cache) => { cache.identity['chunkOverlapChars'] = 1.5 }),
      changed((cache) => { cache.identity['chunkOverlapChars'] = -1 }),
      changed((cache) => { cache.identity['vectorDimension'] = 1.5 }),
      changed((cache) => { cache.identity['vectorDimension'] = -1 }),
      changed((cache) => { cache.chunks = [] }),
      changed((cache) => { cache.identity['vectorDimension'] = 0 }),
      changed((cache) => { cache.chunks = [null as unknown as Record<string, unknown>] }),
      changed((cache) => { cache.chunks[0]!['extra'] = true }),
      changed((cache) => { delete cache.chunks[0]!['text']; cache.chunks[0]!['extra'] = true }),
      changed((cache) => { cache.chunks[0]!['id'] = 1 }),
      changed((cache) => { cache.chunks[0]!['id'] = 'bad' }),
      changed((cache) => { cache.chunks.push(structuredClone(cache.chunks[0]!)) }),
      changed((cache) => { cache.chunks[0]!['path'] = 1 }),
      changed((cache) => { cache.chunks[0]!['path'] = '' }),
      changed((cache) => { cache.chunks[0]!['title'] = 1 }),
      changed((cache) => { cache.chunks[0]!['title'] = '' }),
      changed((cache) => { cache.chunks[0]!['section'] = 1 }),
      changed((cache) => { cache.chunks[0]!['section'] = '' }),
      changed((cache) => { cache.chunks[0]!['text'] = 1 }),
      changed((cache) => { cache.chunks[0]!['text'] = '' }),
      changed((cache) => { cache.chunks[0]!['vector'] = {} }),
      changed((cache) => { cache.chunks[0]!['vector'] = [1] }),
      changed((cache) => { cache.chunks[0]!['vector'] = [1, null] }),
    ]
    for (const payload of invalid) {
      await writeFile(paths.ragIndex, JSON.stringify(payload))
      expect((await gateway.overview()).rag.index.state).toBe('invalid')
    }
    const overflow = changed((cache) => { cache.chunks[0]!['vector'] = ['OVERFLOW', 0] })
    await writeFile(paths.ragIndex, JSON.stringify(overflow).replace('"OVERFLOW"', '1e400'))
    expect((await gateway.overview()).rag.index.state).toBe('invalid')

    const validSection = changed((cache) => { cache.chunks[0]!['section'] = 'Details' })
    await writeFile(paths.ragIndex, JSON.stringify(validSection))
    expect((await gateway.overview()).rag.index.state).toBe('present')
    const validWithoutSection = changed((cache) => { delete cache.chunks[0]!['section'] })
    await writeFile(paths.ragIndex, JSON.stringify(validWithoutSection))
    expect((await gateway.overview()).rag.index.state).toBe('present')

    const stale: CacheFixture[] = [
      changed((cache) => {
        const duplicate = structuredClone(cache.chunks[0]!)
        duplicate['id'] = digest('another chunk')
        cache.chunks.push(duplicate)
      }),
      changed((cache) => { cache.identity['manifestHash'] = digest('another manifest') }),
      changed((cache) => { cache.identity['approvedSourcesHash'] = digest('another approval') }),
      changed((cache) => { cache.identity['embeddingBaseURL'] = 'http://other.test/v1/' }),
      changed((cache) => { cache.identity['embeddingModel'] = 'other-model' }),
      changed((cache) => { cache.identity['chunkChars'] = 121 }),
      changed((cache) => { cache.identity['chunkOverlapChars'] = 13 }),
    ]
    for (const payload of stale) {
      await writeFile(paths.ragIndex, JSON.stringify(payload))
      expect((await gateway.overview()).rag.index).toMatchObject({
        state: 'present',
        matchesConfiguredIdentity: false,
      })
    }
  })

  it('enforces configured RAG and Wiki inventory limits', async () => {
    const ragPaths = await createPaths()
    await writeFixtures(ragPaths)
    const second = 'second approved document'
    await writeFile(join(ragPaths.ragSources, 'second.txt'), second)
    const first = await readFile(join(ragPaths.ragSources, 'billing.md'), 'utf8')
    await writeFile(ragPaths.ragManifest, JSON.stringify({
      version: 1,
      sources: [
        { path: 'billing.md', sha256: digest(first) },
        { path: 'second.txt', sha256: digest(second) },
      ],
    }))
    const ragGateway = await installGateway(ragPaths, {
      limits: { ...config(ragPaths).limits, maxDocuments: 1 },
    })
    await expect(ragGateway.overview()).rejects.toThrow('RAG document count exceeds 1')

    const wikiPaths = await createPaths()
    await writeFixtures(wikiPaths, { extraWikiSource: true })
    const wikiGateway = await installGateway(wikiPaths, {
      limits: { ...config(wikiPaths).limits, maxWikiPages: 1 },
    })
    await expect(wikiGateway.overview()).rejects.toThrow('Wiki page count exceeds 1')
  })

  it('walks Wiki source directories and rejects unsafe or excessive entries', async () => {
    const nestedPaths = await createPaths()
    await writeFixtures(nestedPaths)
    await mkdir(join(nestedPaths.wikiSources, 'nested'))
    await writeFile(join(nestedPaths.wikiSources, 'nested', 'note.txt'), 'nested text')
    await writeFile(join(nestedPaths.wikiSources, 'ignored.bin'), 'ignored')
    const nestedGateway = await installGateway(nestedPaths)
    expect((await nestedGateway.listDocuments()).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'nested/note.txt', state: 'unpublished' }),
    ]))

    const limitedGateway = await installGateway(nestedPaths, {
      limits: { ...config(nestedPaths).limits, maxDocuments: 1 },
    })
    await expect(limitedGateway.listDocuments()).rejects.toThrow('Wiki document count exceeds 1')

    await rm(join(nestedPaths.wikiSources, 'nested'), { recursive: true })
    await symlink(join(nestedPaths.root, 'outside'), join(nestedPaths.wikiSources, 'linked'))
    await expect(nestedGateway.listDocuments()).rejects.toThrow('contains symbolic link linked')

    const fileRoot = await createPaths()
    await writeFixtures(fileRoot)
    await rm(fileRoot.wikiSources, { recursive: true })
    await writeFile(fileRoot.wikiSources, 'not a directory')
    const fileRootGateway = await installGateway(fileRoot)
    await expect(fileRootGateway.listDocuments()).rejects.toThrow('must be a real directory')
  })

  it('projects closed bad cases and rejects malformed or excessive ledgers', async () => {
    const { gateway, paths } = await harness()
    const closed = badCase({ id: 'case-2', status: 'closed', retrieval: 'llm-wiki', verdict: 'pass' })
    await writeFile(paths.badCases, [
      badCase({ capturedAt: '2026-09-04T12:34:56Z' }),
      badCase({ id: 'case-fraction', capturedAt: '2026-09-04T12:34:56.12Z' }),
    ].map(item => JSON.stringify(item)).join('\n'))
    expect((await gateway.listBadCases()).items.map(item => item.capturedAt)).toEqual([
      '2026-09-04T12:34:56Z',
      '2026-09-04T12:34:56.12Z',
    ])

    await writeFile(paths.badCases, `${JSON.stringify(badCase())}\n${JSON.stringify(closed)}\n`)
    expect(await gateway.listBadCases()).toMatchObject({ items: [{ status: 'open' }, { status: 'closed' }] })
    expect((await gateway.overview()).badCases).toEqual({ total: 2, open: 1, closed: 1 })

    const invalid: unknown[] = [
      null,
      badCase({ id: 1 as unknown as string }),
      badCase({ id: '' }),
      badCase({ status: 'pending' as 'open' }),
      badCase({ preset: 1 as unknown as string }),
      badCase({ preset: '' }),
      badCase({ retrieval: 'other' as 'rag' }),
      badCase({ capturedAt: 1 as unknown as string }),
      badCase({ capturedAt: '' }),
      badCase({ capturedAt: '2026-02-30' }),
      badCase({ capturedAt: '2026-99-30' }),
      badCase({ queryLanguage: 1 as unknown as string }),
      badCase({ queryLanguage: '' }),
      badCase({ query: 1 as unknown as string }),
      badCase({ query: '' }),
      badCase({ verdict: 'other' as 'fail' }),
      { ...badCase(), diagnosis: null },
      badCase({ diagnosis: { summary: 1 as unknown as string, failureTypes: [] } }),
      badCase({ diagnosis: { summary: 'bad list', failureTypes: {} } }),
      badCase({ diagnosis: { summary: 'bad item', failureTypes: [1] } }),
      badCase({ acceptanceCriteria: {} }),
      badCase({ acceptanceCriteria: [1] }),
    ]
    for (const payload of invalid) {
      await writeFile(paths.badCases, `${JSON.stringify(payload)}\n`)
      await expect(gateway.listBadCases()).rejects.toThrow('bad case line 1')
    }
    await writeFile(paths.badCases, '{\n')
    await expect(gateway.listBadCases()).rejects.toThrow('contains invalid JSON')

    await writeFile(paths.badCases, `${JSON.stringify(badCase())}\n${JSON.stringify(closed)}\n`)
    const countGateway = await installGateway(paths, {
      limits: { ...config(paths).limits, maxBadCases: 1 },
    })
    await expect(countGateway.listBadCases()).rejects.toThrow('bad-case count exceeds 1')

    const sizeGateway = await installGateway(paths, {
      limits: { ...config(paths).limits, maxBadCasesBytes: 1 },
    })
    await expect(sizeGateway.listBadCases()).rejects.toThrow('badCasesPath exceeds 1 bytes')

    await rm(paths.badCases)
    await mkdir(paths.badCases)
    await expect(gateway.listBadCases()).rejects.toThrow('must be a real file')
  })
})

describe('CustomerServiceAdminGateway staging', () => {
  it('stages a bounded UTF-8 text file with compare-and-set and no overwrite', async () => {
    const { gateway } = await harness()
    const empty = await gateway.listStagedDocuments()
    expect(empty.items).toEqual([])

    const staged = await gateway.stageTextDocument({
      name: 'new-policy.md',
      content: '# New policy\n',
      expectedRevision: empty.revision,
    })
    expect(staged).toMatchObject({
      ok: true,
      value: { document: { name: 'new-policy.md', sizeBytes: 13 } },
    })
    if (!staged.ok) throw new Error('expected staging success')
    expect(staged.value.revision).not.toBe(empty.revision)
    expect((await gateway.listStagedDocuments()).items).toHaveLength(1)

    expect(await gateway.stageTextDocument({ name: 'new-policy.md', content: 'replacement' })).toEqual({
      ok: false,
      error: { code: 'document-exists', name: 'new-policy.md' },
    })
    expect(await gateway.stageTextDocument({
      name: 'second.md',
      content: 'second',
      expectedRevision: empty.revision,
    })).toMatchObject({
      ok: false,
      error: { code: 'staging-conflict', expectedRevision: empty.revision },
    })
  })

  it('returns stable validation failures before filesystem mutation', async () => {
    const { gateway, paths } = await harness()
    await expect(gateway.listStagedDocuments()).resolves.toBeDefined()
    expect(await gateway.stageTextDocument({ name: '../escape.md', content: 'x' }))
      .toEqual({ ok: false, error: { code: 'invalid-name', name: '../escape.md' } })
    expect(await gateway.stageTextDocument({ name: 'image.pdf', content: 'x' }))
      .toMatchObject({ ok: false, error: { code: 'unsupported-extension', extension: '.pdf' } })
    expect(await gateway.stageTextDocument({ name: 'bad.txt', content: '\ud800' }))
      .toEqual({ ok: false, error: { code: 'invalid-utf8' } })
    expect(await gateway.stageTextDocument({ name: 'blank.txt', content: '  \n' }))
      .toEqual({ ok: false, error: { code: 'empty-document' } })
    expect(await gateway.stageTextDocument({ name: 'large.txt', content: 'x'.repeat(65) }))
      .toEqual({ ok: false, error: { code: 'document-too-large', maxBytes: 64, actualBytes: 65 } })
    await expect(readdir(paths.staging)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.runIf(process.platform !== 'win32')('rejects linked staging roots and entries', async () => {
    const rootLink = await createPaths()
    await writeFixtures(rootLink)
    const elsewhere = join(rootLink.root, 'elsewhere')
    await mkdir(elsewhere)
    await symlink(elsewhere, rootLink.staging)
    const rootContext = new Context()
    contexts.push(rootContext)
    await rootContext.plugin(CustomerServiceAdminGateway, config(rootLink))
    const linkedRootGateway = rootContext.get('customerServiceAdmin') as CustomerServiceAdminGateway
    await expect(linkedRootGateway.listStagedDocuments()).rejects.toThrow('must be a real directory')

    const entryLink = await createPaths()
    await writeFixtures(entryLink)
    await mkdir(entryLink.staging)
    const outside = join(entryLink.root, 'outside.md')
    await writeFile(outside, 'outside')
    await symlink(outside, join(entryLink.staging, 'linked.md'))
    const entryContext = new Context()
    contexts.push(entryContext)
    await entryContext.plugin(CustomerServiceAdminGateway, config(entryLink))
    const linkedEntryGateway = entryContext.get('customerServiceAdmin') as CustomerServiceAdminGateway
    await expect(linkedEntryGateway.listStagedDocuments()).rejects.toThrow('must be a real file')
  })

  it('lists deterministic staging snapshots and rejects unsafe existing entries', async () => {
    const { gateway, paths } = await harness()
    await mkdir(paths.staging)
    await Promise.all([
      writeFile(join(paths.staging, 'zeta.txt'), 'z'),
      writeFile(join(paths.staging, 'alpha.md'), 'alpha'),
      writeFile(join(paths.staging, '.dsh-stage-123e4567-e89b-12d3-a456-426614174000.tmp'), 'temporary'),
    ])
    expect((await gateway.listStagedDocuments()).items.map(item => item.name)).toEqual(['alpha.md', 'zeta.txt'])

    const limitedGateway = await installGateway(paths, {
      limits: { ...config(paths).limits, maxDocuments: 1 },
    })
    await expect(limitedGateway.listStagedDocuments()).rejects.toThrow('staged document count exceeds 1')

    const sizeGateway = await installGateway(paths, {
      limits: { ...config(paths).limits, maxStagedDocumentBytes: 1 },
    })
    await expect(sizeGateway.listStagedDocuments()).rejects.toThrow('staged document exceeds its byte limit')

    await writeFile(join(paths.staging, 'unsupported.pdf'), 'pdf')
    await expect(gateway.listStagedDocuments()).rejects.toThrow('uses an unsupported extension')
    await rm(join(paths.staging, 'unsupported.pdf'))

    await mkdir(join(paths.staging, 'directory.md'))
    await expect(gateway.listStagedDocuments()).rejects.toThrow('staged entry must be a real file')

    await rm(paths.staging, { recursive: true })
    await writeFile(paths.staging, 'not a directory')
    await expect(gateway.listStagedDocuments()).rejects.toThrow('stagingDirectory must be a real directory')
  })

  it('rejects staging overlap and invalid deployment limits at construction', async () => {
    const paths = await createPaths()
    await writeFixtures(paths)
    expect(() => new CustomerServiceAdminGateway(new Context(), config(paths, {
      stagingDirectory: join(paths.ragSources, 'staging'),
    }))).toThrow('must not overlap')
    expect(() => new CustomerServiceAdminGateway(new Context(), config(paths, {
      limits: { ...config(paths).limits, maxDocuments: 0 },
    }))).toThrow('limits.maxDocuments')
    expect(() => new CustomerServiceAdminGateway(new Context(), config(paths, {
      badCasesPath: ' ',
    }))).toThrow('badCasesPath must be non-empty')
  })

  it.runIf(process.platform !== 'win32')('rejects staging paths whose symlink ancestors resolve into live data', async () => {
    const paths = await createPaths()
    await writeFixtures(paths)
    const alias = join(paths.root, 'alias')
    await symlink(paths.root, alias)
    const gateway = await installGateway(paths, {
      stagingDirectory: join(alias, 'rag-sources', 'staging'),
    })
    await expect(gateway.listStagedDocuments()).rejects.toThrow('resolves across a live source')
  })
})
