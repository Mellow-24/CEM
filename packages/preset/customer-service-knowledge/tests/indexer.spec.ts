import { createHash } from 'node:crypto'
import {
  chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LocalKnowledgeIndex, assertKnowledgeConfig, cosineSimilarity, splitText,
} from '../src/indexer.ts'
import type { ApprovedSourceEntry, KnowledgeConfig } from '../src/indexer.ts'

interface CorpusPaths {
  readonly root: string
  readonly sourceDirectory: string
  readonly sourceManifestPath: string
  readonly indexPath: string
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function temporaryCorpus(createSource = true): Promise<CorpusPaths> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-customer-service-knowledge-'))
  temporaryDirectories.push(root)
  const sourceDirectory = join(root, 'source')
  if (createSource) await mkdir(sourceDirectory)
  return {
    root,
    sourceDirectory,
    sourceManifestPath: join(sourceDirectory, 'source-manifest.json'),
    indexPath: join(root, 'cache', 'index.json'),
  }
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function writeManifest(paths: CorpusPaths, sources: readonly ApprovedSourceEntry[]): Promise<void> {
  await mkdir(dirname(paths.sourceManifestPath), { recursive: true })
  await writeFile(paths.sourceManifestPath, `${JSON.stringify({ version: 1, sources }, null, 2)}\n`)
}

async function approve(
  paths: CorpusPaths,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> {
  const sources: ApprovedSourceEntry[] = []
  for (const path of Object.keys(files).sort()) {
    const value = files[path]
    if (value === undefined) throw new Error(`missing test source ${path}`)
    const absolute = join(paths.sourceDirectory, ...path.split('/'))
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, value)
    sources.push({ path, sha256: digest(value) })
  }
  await writeManifest(paths, sources)
}

function config(paths: CorpusPaths, overrides: Partial<KnowledgeConfig> = {}): KnowledgeConfig {
  return {
    sourceDirectory: paths.sourceDirectory,
    sourceManifestPath: paths.sourceManifestPath,
    indexPath: paths.indexPath,
    embeddingBaseURL: 'http://knowledge.test/v1',
    embeddingModel: 'embedding',
    rerankerURL: 'http://knowledge.test/v1/rerank',
    rerankerModel: 'reranker',
    rerank: true,
    embeddingBatchSize: 4,
    chunkChars: 120,
    chunkOverlapChars: 12,
    candidateCount: 4,
    resultCount: 2,
    minimumVectorScore: -1,
    minimumRerankScore: 0,
    maxQueryBytes: 256,
    maxExcerptBytes: 256,
    maxResultBytes: 4096,
    requestTimeoutMs: 1_000,
    ...overrides,
  }
}

function embeddingFor(text: string): number[] {
  if (text.includes('营业')) return [1, 0]
  if (text.includes('投诉')) return [0, 1]
  return [0.5, 0.5]
}

function requestJson(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
  return JSON.parse(init.body) as unknown
}

function installModelFetch(options: { rerank?: boolean; rerankScore?: number } = {}): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
    const body = JSON.parse(init.body) as { input?: string[]; documents?: string[] }
    if (url.endsWith('/embeddings')) {
      return Response.json({ data: (body.input ?? []).map(text => ({ embedding: embeddingFor(text) })) })
    }
    if (url.endsWith('/rerank') && (options.rerank ?? true)) {
      return Response.json({
        results: (body.documents ?? []).map((_, index) => ({
          index,
          relevance_score: index === 1 ? (options.rerankScore ?? 1) : 0.5,
        })),
      })
    }
    return new Response('missing reranker', { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('configuration and pure retrieval helpers', () => {
  it('splits normalized text at preferred boundaries with bounded overlap', () => {
    expect(splitText('  \r\n  ', 8, 2)).toEqual([])
    const chunks = splitText('甲乙丙丁。戊己庚辛。壬癸子丑。', 8, 2)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.length <= 8)).toBe(true)
    expect(chunks.join('')).toContain('壬癸子丑')
    expect(splitText('abcdefghijk', 5, 0)).toEqual(['abcde', 'fghij', 'k'])
    expect(splitText('a     b', 3, 0)).toEqual(['a', 'b'])
  })

  it('rejects vectors that cannot produce a finite cosine score', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([], [])).toBe(Number.NEGATIVE_INFINITY)
    expect(cosineSimilarity([1], [1, 2])).toBe(Number.NEGATIVE_INFINITY)
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(Number.NEGATIVE_INFINITY)
    expect(cosineSimilarity([Number.NaN], [1])).toBe(Number.NEGATIVE_INFINITY)
    expect(cosineSimilarity([1], [Number.POSITIVE_INFINITY])).toBe(Number.NEGATIVE_INFINITY)
  })

  it('validates every deployment-owned scalar and path relation', async () => {
    const paths = await temporaryCorpus()
    const valid = config(paths)
    expect(() => { assertKnowledgeConfig(valid) }).not.toThrow()
    const invalid: Array<[Partial<KnowledgeConfig>, RegExp]> = [
      [{ maxQueryBytes: 0 }, /maxQueryBytes must be a positive integer/],
      [{ chunkOverlapChars: -1 }, /non-negative integer/],
      [{ chunkOverlapChars: 120 }, /smaller than chunkChars/],
      [{ resultCount: 5 }, /must not exceed candidateCount/],
      [{ minimumVectorScore: Number.NaN }, /minimumVectorScore/],
      [{ minimumVectorScore: -1.1 }, /minimumVectorScore/],
      [{ minimumVectorScore: 1.1 }, /minimumVectorScore/],
      [{ minimumRerankScore: Number.POSITIVE_INFINITY }, /minimumRerankScore/],
      [{ maxExcerptBytes: 4097 }, /maxExcerptBytes must not exceed/],
      [{ maxResultBytes: 1, maxExcerptBytes: 1 }, /maxResultBytes must be at least/],
      [{ embeddingModel: '' }, /embeddingModel must be non-empty/],
      [{ embeddingApiKeyEnv: 'not-a-reference!' }, /credential ref/],
      [{ rerankerApiKeyEnv: 'not-a-reference!' }, /credential ref/],
      [{ embeddingBaseURL: 'relative' }, /absolute HTTP/],
      [{ embeddingBaseURL: 'file:///tmp/model' }, /without inline credentials/],
      [{ embeddingBaseURL: 'http://user:secret@knowledge.test/v1' }, /without inline credentials/],
      [{ indexPath: join(paths.sourceDirectory, 'index.json') }, /outside sourceDirectory/],
      [{ indexPath: paths.sourceDirectory }, /outside sourceDirectory/],
      [{ indexPath: paths.sourceManifestPath }, /must not replace sourceManifestPath/],
    ]
    for (const [overrides, expected] of invalid) {
      expect(() => { assertKnowledgeConfig({ ...valid, ...overrides }) }).toThrow(expected)
    }
    expect(() => { assertKnowledgeConfig({
      ...valid,
      rerank: false,
      rerankerURL: '',
      rerankerModel: '',
      chunkOverlapChars: 0,
    }) }).not.toThrow()
  })
})

describe('approved-source manifest', () => {
  it('fails fast for a missing source root or manifest', async () => {
    const missingRoot = await temporaryCorpus(false)
    await expect(new LocalKnowledgeIndex(config(missingRoot), () => {}).validateSources())
      .rejects.toThrow(/sourceDirectory is unavailable/)

    const missingManifest = await temporaryCorpus()
    await expect(new LocalKnowledgeIndex(config(missingManifest), () => {}).validateSources())
      .rejects.toThrow(/sourceManifestPath is unavailable/)
  })

  it('requires real directories and manifest files', async () => {
    const rootFile = await temporaryCorpus(false)
    await writeFile(rootFile.sourceDirectory, 'not a directory')
    await expect(new LocalKnowledgeIndex(config(rootFile), () => {}).validateSources())
      .rejects.toThrow(/sourceDirectory must be a real directory/)

    const manifestDirectory = await temporaryCorpus()
    await mkdir(manifestDirectory.sourceManifestPath)
    await expect(new LocalKnowledgeIndex(config(manifestDirectory), () => {}).validateSources())
      .rejects.toThrow(/sourceManifestPath must be a real file/)
  })

  it.runIf(process.platform !== 'win32')('rejects source and manifest symlinks', async () => {
    const linkedRoot = await temporaryCorpus(false)
    const target = join(linkedRoot.root, 'target')
    await mkdir(target)
    await symlink(target, linkedRoot.sourceDirectory)
    await expect(new LocalKnowledgeIndex(config(linkedRoot), () => {}).validateSources())
      .rejects.toThrow(/sourceDirectory must be a real directory/)

    const linkedManifest = await temporaryCorpus()
    const targetManifest = join(linkedManifest.root, 'manifest.json')
    await writeFile(targetManifest, '{"version":1,"sources":[]}\n')
    await symlink(targetManifest, linkedManifest.sourceManifestPath)
    await expect(new LocalKnowledgeIndex(config(linkedManifest), () => {}).validateSources())
      .rejects.toThrow(/sourceManifestPath must be a real file/)
  })

  it.runIf(process.platform !== 'win32')('rejects an index parent symlink that resolves into the approved root', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, {})
    const alias = join(paths.root, 'source-alias')
    await symlink(paths.sourceDirectory, alias)
    const inside = config(paths, { indexPath: join(alias, 'index.json') })
    await expect(new LocalKnowledgeIndex(inside, () => {}).validateSources())
      .rejects.toThrow(/indexPath must be outside sourceDirectory/)

    const manifestAlias = config(paths, { indexPath: join(alias, 'source-manifest.json') })
    await expect(new LocalKnowledgeIndex(manifestAlias, () => {}).validateSources())
      .rejects.toThrow(/must not replace sourceManifestPath/)
  })

  it('propagates an invalid index parent path during source validation', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, {})
    const blocker = join(paths.root, 'not-a-directory')
    await writeFile(blocker, 'file')
    const invalid = config(paths, { indexPath: join(blocker, 'child', 'index.json') })
    await expect(new LocalKnowledgeIndex(invalid, () => {}).validateSources()).rejects.toBeInstanceOf(Error)
  })

  it('rejects invalid manifest encoding, JSON, fields, paths, hashes, duplicates, and order', async () => {
    const paths = await temporaryCorpus()
    const cases: Array<[string | Uint8Array, RegExp]> = [
      [new Uint8Array([0xff]), /source manifest is not valid UTF-8/],
      ['{', /source manifest is not valid JSON/],
      ['[]', /must be \{ version: 1/],
      ['{"version":2,"sources":[]}', /must be \{ version: 1/],
      ['{"version":1,"sources":{},"extra":true}', /must be \{ version: 1/],
      ['{"version":1,"sources":[null]}', /entry 1 must contain/],
      ['{"version":1,"sources":[{"path":1,"sha256":"x"}]}', /entry 1 must contain/],
      ['{"version":1,"sources":[{"path":"","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}', /unsafe path/],
      ['{"version":1,"sources":[{"path":"a\\\\b.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}', /unsafe path/],
      ['{"version":1,"sources":[{"path":"../a.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}', /unsafe path/],
      ['{"version":1,"sources":[{"path":"C:/a.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}', /unsafe path/],
      ['{"version":1,"sources":[{"path":"a/../b.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}', /unsafe path/],
      ['{"version":1,"sources":[{"path":"a.pdf","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}', /unsupported extension/],
      ['{"version":1,"sources":[{"path":"a.md","sha256":"ABC"}]}', /64 lowercase/],
      ['{"version":1,"sources":[{"path":"a.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"path":"a.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}', /duplicate paths/],
      ['{"version":1,"sources":[{"path":"b.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"path":"a.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}', /lexical order/],
    ]
    for (const [manifest, expected] of cases) {
      await writeFile(paths.sourceManifestPath, manifest)
      await expect(new LocalKnowledgeIndex(config(paths), () => {}).validateSources()).rejects.toThrow(expected)
    }
  })

  it('rejects missing, extra, changed, symlinked, and invalid-UTF-8 sources', async () => {
    const mismatch = await temporaryCorpus()
    await writeFile(join(mismatch.sourceDirectory, 'extra.md'), 'extra')
    await writeManifest(mismatch, [{ path: 'missing.md', sha256: digest('missing') }])
    await expect(new LocalKnowledgeIndex(config(mismatch), () => {}).validateSources())
      .rejects.toThrow(/missing: missing.md; unapproved: extra.md/)

    const missingOnly = await temporaryCorpus()
    await writeManifest(missingOnly, [{ path: 'missing.md', sha256: digest('missing') }])
    await expect(new LocalKnowledgeIndex(config(missingOnly), () => {}).validateSources())
      .rejects.toThrow(/missing: missing.md$/)

    const extraOnly = await temporaryCorpus()
    await writeFile(join(extraOnly.sourceDirectory, 'extra.md'), 'extra')
    await writeManifest(extraOnly, [])
    await expect(new LocalKnowledgeIndex(config(extraOnly), () => {}).validateSources())
      .rejects.toThrow(/unapproved: extra.md$/)

    const changed = await temporaryCorpus()
    await approve(changed, { 'a.md': 'approved' })
    await writeFile(join(changed.sourceDirectory, 'a.md'), 'changed')
    await expect(new LocalKnowledgeIndex(config(changed), () => {}).validateSources())
      .rejects.toThrow(/hash mismatch for a.md/)

    const invalidUtf8 = await temporaryCorpus()
    const bytes = new Uint8Array([0xff])
    await approve(invalidUtf8, { 'bad.md': bytes })
    await expect(new LocalKnowledgeIndex(config(invalidUtf8), () => {}).validateSources())
      .rejects.toThrow(/approved source bad.md is not valid UTF-8/)

    if (process.platform !== 'win32') {
      const linked = await temporaryCorpus()
      await approve(linked, {})
      await symlink(join(linked.root, 'elsewhere.md'), join(linked.sourceDirectory, 'linked.md'))
      await expect(new LocalKnowledgeIndex(config(linked), () => {}).validateSources())
        .rejects.toThrow(/must not contain symlink linked.md/)
    }
  })

  it('derives nested Markdown, HTML, JSON, CSV, and empty sources without indexing unsupported files', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, {
      'a.md': '# Title\n\nBody\n## Section\n\nMore',
      'blank-heading.md': '#   \nbody',
      'b.html': '<style>x</style><script>x</script><h1>HTML</h1>&lt;safe&gt;&amp;&nbsp;',
      'c.json': '{"answer":42}',
      'nested/d.csv': 'name,value\na,1',
      'z.txt': '',
    })
    await writeFile(join(paths.sourceDirectory, '.DS_Store'), 'ignored')
    const validated = await new LocalKnowledgeIndex(config(paths), () => {}).validateSources()
    expect(validated.files).toBe(6)
    expect(validated.chunks).toBeGreaterThanOrEqual(6)
  })

  it('wraps malformed approved JSON with the source path', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'bad.json': '{' })
    await expect(new LocalKnowledgeIndex(config(paths), () => {}).validateSources())
      .rejects.toThrow(/cannot parse bad.json/)
  })
})

describe('cache and search behavior', () => {
  it('resolves endpoint credentials for every embedding and rerank request', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    const fetch = installModelFetch()
    const resolveCredential = vi.fn(async (reference: string) => `${reference}-secret`)
    const index = new LocalKnowledgeIndex(config(paths, {
      embeddingApiKeyEnv: 'EMBEDDING_API_KEY',
      rerankerApiKeyEnv: 'RERANKER_API_KEY',
    }), () => {}, resolveCredential)

    expect((await index.search('营业')).reranked).toBe(true)
    expect(resolveCredential.mock.calls.map(([reference]) => reference)).toEqual([
      'EMBEDDING_API_KEY', 'EMBEDDING_API_KEY', 'RERANKER_API_KEY',
    ])
    const authorizations = fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('authorization'))
    expect(authorizations).toEqual([
      'Bearer EMBEDDING_API_KEY-secret',
      'Bearer EMBEDDING_API_KEY-secret',
      'Bearer RERANKER_API_KEY-secret',
    ])
  })

  it('fails before an authenticated model request when no credential resolver exists', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    const fetch = installModelFetch()
    const index = new LocalKnowledgeIndex(config(paths, {
      embeddingApiKeyEnv: 'DASHSCOPE_API_KEY',
    }), () => {})

    await expect(index.search('营业')).rejects.toThrow(/no credential resolver for DASHSCOPE_API_KEY/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds once, reuses a strict persisted cache, and returns stable reranked evidence', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, {
      'complaint.md': '# 投诉\n\n客户可通过客服热线提交投诉。\n',
      'hours.md': '# 营业时间\n\n澳门门店星期一至星期五上午九时至下午六时营业。\n',
    })
    const fetch = installModelFetch()
    const first = new LocalKnowledgeIndex(config(paths), () => {})

    expect(await first.prepare()).toEqual({ files: 2, chunks: 2, rebuilt: true })
    expect(await first.prepare()).toEqual({ files: 2, chunks: 2, rebuilt: false })
    const result = await first.search('营业时间')
    expect(result.status).toBe('found')
    expect(result.reranked).toBe(true)
    expect(result.sources.map(source => source.path)).toEqual(['complaint.md', 'hours.md'])
    expect(result.sources.every(source => /^[a-f0-9]{64}$/u.test(source.id))).toBe(true)

    const embeddingCalls = fetch.mock.calls.filter(([url]) => String(url).endsWith('/embeddings')).length
    const second = new LocalKnowledgeIndex(config(paths), () => {})
    expect(await second.prepare()).toEqual({ files: 2, chunks: 2, rebuilt: false })
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/embeddings'))).toHaveLength(embeddingCalls)
  })

  it('embeds and reranks a complete FAQ-heading question', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, {
      'supply.md': '# 供電服務\n\n## cem-kb-1｜我想申請供電,我需要做甚麼?\n\n請透過網上服務申請。\n',
    })
    const fetch = installModelFetch()
    const index = new LocalKnowledgeIndex(config(paths), () => {})
    await index.prepare()
    const callsAfterIndexing = fetch.mock.calls.length

    const result = await index.search('我想申請供電，我需要做甚麼？')

    expect(result).toMatchObject({ status: 'found', reranked: true })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.section).toContain('我想申請供電')
    expect(fetch.mock.calls.slice(callsAfterIndexing).map(([url]) => String(url))).toEqual([
      'http://knowledge.test/v1/embeddings',
      'http://knowledge.test/v1/rerank',
    ])
  })

  it('returns explicit empty-corpus and threshold-based insufficient-evidence outcomes', async () => {
    const empty = await temporaryCorpus()
    await approve(empty, {})
    const fetch = installModelFetch()
    const emptyResult = await new LocalKnowledgeIndex(config(empty), () => {}).search('anything')
    expect(emptyResult).toEqual({ status: 'not-found', reason: 'empty-corpus', sources: [], reranked: false })
    expect(fetch).not.toHaveBeenCalled()

    const low = await temporaryCorpus()
    await approve(low, { 'hours.md': '# 营业时间\n\n营业。' })
    const vectorResult = await new LocalKnowledgeIndex(config(low, { minimumVectorScore: 0.9 }), () => {})
      .search('unrelated')
    expect(vectorResult).toEqual({
      status: 'not-found', reason: 'insufficient-evidence', sources: [], reranked: true,
    })

    const rerankResult = await new LocalKnowledgeIndex(config(low, { minimumRerankScore: 0.8 }), () => {})
      .search('营业时间')
    expect(rerankResult).toEqual({
      status: 'not-found', reason: 'insufficient-evidence', sources: [], reranked: true,
    })
  })

  it('bounds queries and trims complete results by UTF-8 bytes', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': `# ${'标题'.repeat(30)}\n\n${'营业内容'.repeat(80)}` })
    installModelFetch()
    const index = new LocalKnowledgeIndex(config(paths, {
      maxQueryBytes: 6,
      maxExcerptBytes: 300,
      maxResultBytes: 1600,
      rerank: false,
    }), () => {})
    await expect(index.search('')).rejects.toThrow(/query must be non-empty/)
    await expect(index.search('营业时间')).rejects.toThrow(/query exceeds 6 UTF-8 bytes/)
    const result = await index.search('营业')
    expect(result.status).toBe('found')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1600)
    expect(Buffer.byteLength(result.sources[0]?.excerpt ?? '')).toBeLessThanOrEqual(300)
  })

  it('rebuilds malformed, tampered, and configuration-stale caches', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    const fetch = installModelFetch()
    const original = new LocalKnowledgeIndex(config(paths), () => {})
    await original.prepare()
    const initialCalls = fetch.mock.calls.length

    await writeFile(paths.indexPath, '{')
    await new LocalKnowledgeIndex(config(paths), () => {}).prepare()
    expect(fetch.mock.calls.length).toBeGreaterThan(initialCalls)

    const parsed = JSON.parse(await readFile(paths.indexPath, 'utf8')) as {
      chunks: Array<{ text: string }>
    }
    const firstChunk = parsed.chunks[0]
    if (firstChunk === undefined) throw new Error('expected one cache chunk')
    firstChunk.text = 'poisoned'
    await writeFile(paths.indexPath, `${JSON.stringify(parsed)}\n`)
    const afterMalformed = fetch.mock.calls.length
    await new LocalKnowledgeIndex(config(paths), () => {}).prepare()
    expect(fetch.mock.calls.length).toBeGreaterThan(afterMalformed)

    const afterTampered = fetch.mock.calls.length
    await new LocalKnowledgeIndex(config(paths, { chunkChars: 60 }), () => {}).prepare()
    expect(fetch.mock.calls.length).toBeGreaterThan(afterTampered)
  })

  it('discards malformed cache roots, identities, chunks, and vectors', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    const fetch = installModelFetch()
    await new LocalKnowledgeIndex(config(paths), () => {}).prepare()
    type Cache = {
      version: unknown
      identity: Record<string, unknown>
      chunks: Array<Record<string, unknown>>
      extra?: unknown
    }
    const valid = JSON.parse(await readFile(paths.indexPath, 'utf8')) as Cache
    const changed = (mutate: (cache: Cache) => void): unknown => {
      const cache = structuredClone(valid)
      mutate(cache)
      return cache
    }
    const invalid: unknown[] = [
      null,
      [],
      {},
      changed((cache) => { cache.extra = true }),
      changed((cache) => { cache.version = 1 }),
      { version: 2, identity: null, chunks: [] },
      { version: 2, identity: {}, chunks: [] },
      { version: 2, identity: valid.identity, chunks: {} },
      changed((cache) => { cache.identity.parserVersion = 2 }),
      changed((cache) => { cache.identity.manifestHash = 'bad' }),
      changed((cache) => { cache.identity.approvedSourcesHash = 1 }),
      changed((cache) => { cache.identity.embeddingBaseURL = 1 }),
      changed((cache) => { cache.identity.embeddingModel = 1 }),
      changed((cache) => { cache.identity.chunkChars = 0 }),
      changed((cache) => { cache.identity.chunkOverlapChars = -1 }),
      changed((cache) => { cache.identity.vectorDimension = -1 }),
      changed((cache) => { cache.chunks = [] }),
      changed((cache) => { cache.identity.vectorDimension = 0 }),
      changed((cache) => { cache.chunks = [null as unknown as Record<string, unknown>] }),
      changed((cache) => { cache.chunks[0]!.extra = true }),
      changed((cache) => { cache.chunks[0]!.id = 'bad' }),
      changed((cache) => { cache.chunks.push(structuredClone(cache.chunks[0]!)) }),
      changed((cache) => { cache.chunks[0]!.path = '' }),
      changed((cache) => { cache.chunks[0]!.title = '' }),
      changed((cache) => { cache.chunks[0]!.section = '' }),
      changed((cache) => { cache.chunks[0]!.text = '' }),
      changed((cache) => { cache.chunks[0]!.vector = {} }),
      changed((cache) => { cache.chunks[0]!.vector = [1] }),
      changed((cache) => { cache.chunks[0]!.vector = [1, null] }),
      changed((cache) => { delete cache.chunks[0]!.section }),
    ]
    for (const payload of invalid) {
      await writeFile(paths.indexPath, `${JSON.stringify(payload)}\n`)
      const before = fetch.mock.calls.length
      await new LocalKnowledgeIndex(config(paths), () => {}).prepare()
      expect(fetch.mock.calls.length).toBeGreaterThan(before)
    }
  })

  it('strictly reuses a cache for a source without Markdown headings', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'plain.txt': 'plain evidence' })
    const fetch = installModelFetch()
    await new LocalKnowledgeIndex(config(paths), () => {}).prepare()
    const calls = fetch.mock.calls.length
    expect(await new LocalKnowledgeIndex(config(paths), () => {}).prepare())
      .toMatchObject({ rebuilt: false })
    expect(fetch.mock.calls).toHaveLength(calls)
  })

  it('rebuilds when the query vector reveals a changed embedding dimension', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    let embeddingRequest = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const body = requestJson(init) as { input: string[] }
      if (String(input).endsWith('/rerank')) {
        return Response.json({ results: [{ index: 0, relevance_score: 1 }] })
      }
      embeddingRequest += 1
      const dimension = embeddingRequest === 2 ? 3 : embeddingRequest >= 3 ? 3 : 2
      return Response.json({
        data: body.input.map(() => ({
          embedding: Array.from({ length: dimension }, (_, index) => index === 0 ? 1 : 0),
        })),
      })
    }))
    const result = await new LocalKnowledgeIndex(config(paths), () => {}).search('营业')
    expect(result.status).toBe('found')
    expect(embeddingRequest).toBe(3)
  })

  it('rejects embedding dimensions that change between index batches', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'a.md': '# A\n\none', 'b.md': '# B\n\ntwo' })
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = requestJson(init) as { input: string[] }
      call += 1
      const vector = call === 1 ? [1, 0] : [1, 0, 0]
      return Response.json({ data: body.input.map(() => ({ embedding: vector })) })
    }))
    await expect(new LocalKnowledgeIndex(config(paths, { embeddingBatchSize: 1 }), () => {}).prepare())
      .rejects.toThrow(/changed vector dimensions across requests/)
  })

  it('rejects malformed and inconsistent embedding responses', async () => {
    const cases: Array<[unknown, RegExp]> = [
      [null, /non-object response/],
      [{ data: {} }, /returned 0 vectors for 1 inputs/],
      [{ data: [] }, /returned 0 vectors for 1 inputs/],
      [{ data: [null] }, /embedding 0 is malformed/],
      [{ data: [{ embedding: [] }] }, /not a finite non-empty vector/],
      [{ data: [{ embedding: [null] }] }, /not a finite non-empty vector/],
    ]
    for (const [payload, expected] of cases) {
      const paths = await temporaryCorpus()
      await approve(paths, { 'a.md': 'evidence' })
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
      await expect(new LocalKnowledgeIndex(config(paths), () => {}).prepare()).rejects.toThrow(expected)
    }

    const inconsistent = await temporaryCorpus()
    await approve(inconsistent, { 'a.md': '# A\none', 'b.md': '# B\ntwo' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      data: [{ embedding: [1, 0] }, { embedding: [1, 0, 0] }],
    })))
    await expect(new LocalKnowledgeIndex(config(inconsistent), () => {}).prepare())
      .rejects.toThrow(/inconsistent vector dimensions/)
  })

  it('surfaces embedding HTTP errors and internal request timeouts', async () => {
    const http = await temporaryCorpus()
    await approve(http, { 'a.md': 'evidence' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 503 })))
    await expect(new LocalKnowledgeIndex(config(http), () => {}).prepare())
      .rejects.toThrow(/model endpoint returned HTTP 503/)

    const timed = await temporaryCorpus()
    await approve(timed, { 'a.md': 'evidence' })
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason
          reject(reason instanceof Error ? reason : new Error('request aborted'))
        }, { once: true })
      })
    }))
    await expect(new LocalKnowledgeIndex(config(timed, { requestTimeoutMs: 5 }), () => {}).prepare())
      .rejects.toThrow(/request timed out after 5ms/)
  })

  it('falls back for every malformed rerank representation and accepts data/score aliases', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'a.md': '营业 evidence', 'b.md': '投诉 evidence' })
    const malformed: unknown[] = [
      null,
      {},
      { results: {} },
      { results: [] },
      { results: [null] },
      { results: [{ index: '0', relevance_score: 1 }] },
      { results: [{ index: 0.5, relevance_score: 1 }] },
      { results: [{ index: -1, relevance_score: 1 }] },
      { results: [{ index: 2, relevance_score: 1 }] },
      { results: [{ index: 0, relevance_score: 'high' }] },
      { results: [{ index: 0, relevance_score: null }] },
      { results: [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 0.5 }] },
    ]
    let rerankPayload: unknown = malformed[0]
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const body = requestJson(init) as { input?: string[] }
      return String(input).endsWith('/embeddings')
        ? Response.json({ data: (body.input ?? []).map(text => ({ embedding: embeddingFor(text) })) })
        : Response.json(rerankPayload)
    }))
    const warnings: string[] = []
    const index = new LocalKnowledgeIndex(config(paths), warning => warnings.push(warning))
    for (const payload of malformed) {
      rerankPayload = payload
      expect((await index.search('营业')).reranked).toBe(false)
    }
    expect(warnings).toHaveLength(malformed.length)

    rerankPayload = { data: [{ index: 0, score: 0.9 }] }
    expect((await index.search('营业')).reranked).toBe(true)
  })

  it('retries transient reranker failure and does not convert cancellation into fallback state', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    const fetch = installModelFetch({ rerank: false })
    const warnings: string[] = []
    const index = new LocalKnowledgeIndex(config(paths), message => warnings.push(message))
    expect((await index.search('营业')).reranked).toBe(false)
    expect((await index.search('营业')).reranked).toBe(false)
    expect(warnings).toHaveLength(2)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/rerank'))).toHaveLength(2)

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const body = requestJson(init) as { input?: string[] }
      if (String(input).endsWith('/embeddings')) {
        return Response.json({ data: (body.input ?? []).map(() => ({ embedding: [1, 0] })) })
      }
      throw 'string failure'
    }))
    expect((await index.search('营业')).reranked).toBe(false)
    expect(warnings.at(-1)).toContain('string failure')

    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const body = requestJson(init) as { input?: string[] }
      if (String(input).endsWith('/embeddings')) {
        return Response.json({ data: (body.input ?? []).map(() => ({ embedding: [1, 0] })) })
      }
      controller.abort(new Error('cancelled by test'))
      init?.signal?.throwIfAborted()
      return Response.json({})
    }))
    await expect(new LocalKnowledgeIndex(config(paths), () => {}).search('营业', controller.signal))
      .rejects.toThrow(/cancelled by test/)
  })

  it('serializes concurrent searches over the shared standing instance', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    let active = 0
    let maximum = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      const body = requestJson(init) as { input?: string[] }
      return String(input).endsWith('/embeddings')
        ? Response.json({ data: (body.input ?? []).map(() => ({ embedding: [1, 0] })) })
        : Response.json({ results: [{ index: 0, relevance_score: 1 }] })
    }))
    const index = new LocalKnowledgeIndex(config(paths), () => {})
    await Promise.all([index.search('营业'), index.search('营业')])
    expect(maximum).toBe(1)
  })

  it('propagates non-missing cache I/O failure', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    installModelFetch()
    await mkdir(paths.indexPath, { recursive: true })
    await expect(new LocalKnowledgeIndex(config(paths), () => {}).prepare()).rejects.toBeInstanceOf(Error)
  })

  it.runIf(process.platform !== 'win32')('removes a temporary cache after atomic rename failure', async () => {
    const paths = await temporaryCorpus()
    await approve(paths, { 'hours.md': '# 营业时间\n\n营业。' })
    installModelFetch()
    await mkdir(dirname(paths.indexPath), { recursive: true })
    await chmod(dirname(paths.indexPath), 0o500)
    try {
      await expect(new LocalKnowledgeIndex(config(paths), () => {}).prepare()).rejects.toBeInstanceOf(Error)
    } finally {
      await chmod(dirname(paths.indexPath), 0o700)
    }
  })
})
