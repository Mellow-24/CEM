/**
 * Approved-source indexing and relevance-filtered retrieval for the Macau customer-service preset.
 *
 * The source manifest, not directory membership, grants approval. Every lookup revalidates the
 * manifest and source hashes before an untrusted persisted cache may be reused. One index instance
 * serializes preparation and search because the standing preset composition shares it across agents.
 * @module @deepseek-ai/dsh-customer-service-knowledge/indexer
 */

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, posix, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  fitKnowledgeResult,
  minimumKnowledgeResultBytes,
  truncateUtf8,
  utf8ByteLength,
  type KnowledgeSearchResult,
  type KnowledgeSource,
} from './evidence.ts'

export type { KnowledgeNotFoundReason, KnowledgeSearchResult, KnowledgeSource } from './evidence.ts'

/** The complete deployment-owned retrieval configuration. */
export interface KnowledgeConfig {
  /** Directory containing exactly the approved source files plus ignored unsupported files. */
  readonly sourceDirectory: string
  /** Versioned JSON allowlist containing each approved relative path and SHA-256 digest. */
  readonly sourceManifestPath: string
  /** Disposable owner-only JSON vector-cache path outside {@link sourceDirectory}. */
  readonly indexPath: string
  /** OpenAI-compatible endpoint prefix ending in `/v1`. */
  readonly embeddingBaseURL: string
  /** Embedding model accepted by the configured endpoint. */
  readonly embeddingModel: string
  /** Optional credential reference sent as a Bearer token to the embedding endpoint. */
  readonly embeddingApiKeyEnv?: string
  /** Rerank endpoint contacted only when {@link rerank} is true. */
  readonly rerankerURL: string
  /** Reranker model accepted by the configured endpoint. */
  readonly rerankerModel: string
  /** Optional credential reference sent as a Bearer token to the reranker endpoint. */
  readonly rerankerApiKeyEnv?: string
  /** Whether retrieval attempts a rerank after vector candidate selection. */
  readonly rerank: boolean
  /** Number of fragments sent to one embeddings request during indexing. */
  readonly embeddingBatchSize: number
  /** Maximum UTF-16 code units in one heading-aware knowledge fragment. */
  readonly chunkChars: number
  /** UTF-16 code units repeated from one fragment at the start of its successor. */
  readonly chunkOverlapChars: number
  /** Candidate fragments retained after vector similarity and before reranking. */
  readonly candidateCount: number
  /** Maximum cited fragments returned to the model. */
  readonly resultCount: number
  /** Minimum cosine similarity required before a fragment may be evidence. */
  readonly minimumVectorScore: number
  /** Minimum reranker score required when reranking succeeds. */
  readonly minimumRerankScore: number
  /** Maximum UTF-8 bytes accepted in one query. */
  readonly maxQueryBytes: number
  /** Maximum UTF-8 bytes exposed from each cited fragment before complete-result fitting. */
  readonly maxExcerptBytes: number
  /** Maximum UTF-8 bytes for canonical JSON and rendered model text independently. */
  readonly maxResultBytes: number
  /** Upper bound for one model HTTP request. */
  readonly requestTimeoutMs: number
}

/** Resolve one configured credential reference immediately before its model request. */
export type KnowledgeCredentialResolver = (reference: string) => Promise<string>

/** One source entry in the versioned approval manifest. */
export interface ApprovedSourceEntry {
  /** Normalized POSIX path relative to {@link KnowledgeConfig.sourceDirectory}. */
  readonly path: string
  /** Lowercase SHA-256 hex digest of the approved file bytes. */
  readonly sha256: string
}

/** Version 1 approved-source allowlist. */
export interface ApprovedSourceManifest {
  /** Manifest format version. */
  readonly version: 1
  /** Approved sources in lexical path order without duplicates. */
  readonly sources: readonly ApprovedSourceEntry[]
}

interface ApprovedSourceFile extends ApprovedSourceEntry {
  readonly text: string
}

interface ApprovedCorpus {
  readonly files: readonly ApprovedSourceFile[]
  readonly manifestHash: string
  readonly approvedSourcesHash: string
}

interface SourceSection {
  readonly title: string
  readonly section?: string
  readonly text: string
}

interface IndexedChunk {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly section?: string
  readonly text: string
  readonly vector: readonly number[]
}

type ChunkDraft = Omit<IndexedChunk, 'vector'>

interface IndexIdentity {
  readonly parserVersion: 1
  readonly manifestHash: string
  readonly approvedSourcesHash: string
  readonly embeddingBaseURL: string
  readonly embeddingModel: string
  readonly chunkChars: number
  readonly chunkOverlapChars: number
  readonly vectorDimension: number
}

interface PersistedIndex {
  readonly version: 2
  readonly identity: IndexIdentity
  readonly chunks: readonly IndexedChunk[]
}

interface BaseIndexIdentity extends Omit<IndexIdentity, 'vectorDimension'> {}

interface DerivedCorpus {
  readonly files: number
  readonly drafts: readonly ChunkDraft[]
  readonly identity: BaseIndexIdentity
}

interface PreparedIndex {
  readonly files: number
  readonly index: PersistedIndex
  readonly derivation: DerivedCorpus
  readonly rebuilt: boolean
}

interface RankedChunk {
  readonly chunk: IndexedChunk
  readonly score: number
}

interface RerankEntry {
  readonly index: number
  readonly score: number
}

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.json', '.csv'])
const SHA256 = /^[a-f0-9]{64}$/u
const UTF8 = new TextDecoder('utf-8', { fatal: true })

/** Create a lowercase SHA-256 digest of bytes or text. */
function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Whether a value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether an object has exactly the named own enumerable keys. */
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length
    && expected.slice().sort().every((key, index) => actual[index] === key)
}

/** Decode approved bytes without silently replacing invalid UTF-8. */
function decodeUtf8(bytes: Uint8Array, subject: string): string {
  try {
    return UTF8.decode(bytes)
  } catch (error) {
    throw new Error(`customer-service-knowledge: ${subject} is not valid UTF-8`, { cause: error })
  }
}

/** Whether `target` is `root` itself or a lexical descendant. */
function pathWithin(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

/** Resolve a not-yet-created path through the nearest existing real parent directory. */
async function prospectiveRealPath(path: string): Promise<string> {
  const suffix = [basename(path)]
  let parent = dirname(resolve(path))
  for (;;) {
    try {
      return resolve(await realpath(parent), ...suffix)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const next = dirname(parent)
    /* v8 ignore next -- every supported host has an existing filesystem root, so ascent resolves before this guard */
    if (next === parent) throw new Error(`customer-service-knowledge: cannot resolve indexPath parent for ${path}`)
    suffix.unshift(basename(parent))
    parent = next
  }
}

/** Require one absolute HTTP(S) endpoint without inline credentials. */
function assertEndpoint(field: string, value: string): void {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch (error) {
    throw new Error(`customer-service-knowledge: ${field} must be an absolute HTTP(S) URL`, { cause: error })
  }
  if ((endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') || endpoint.username !== '' || endpoint.password !== '') {
    throw new Error(`customer-service-knowledge: ${field} must be an absolute HTTP(S) URL without inline credentials`)
  }
}

/**
 * Validate complete configuration and path relations before the plugin publishes its tool.
 * @param config - complete retrieval configuration supplied by the preset composition.
 */
export function assertKnowledgeConfig(config: KnowledgeConfig): void {
  const positiveIntegerFields: ReadonlyArray<keyof Pick<KnowledgeConfig,
    | 'embeddingBatchSize' | 'chunkChars' | 'candidateCount' | 'resultCount'
    | 'maxQueryBytes' | 'maxExcerptBytes' | 'maxResultBytes' | 'requestTimeoutMs'
  >> = [
    'embeddingBatchSize', 'chunkChars', 'candidateCount', 'resultCount', 'maxQueryBytes',
    'maxExcerptBytes', 'maxResultBytes', 'requestTimeoutMs',
  ]
  for (const field of positiveIntegerFields) {
    const value = config[field]
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`customer-service-knowledge: ${field} must be a positive integer`)
    }
  }
  if (!Number.isInteger(config.chunkOverlapChars) || config.chunkOverlapChars < 0) {
    throw new Error('customer-service-knowledge: chunkOverlapChars must be a non-negative integer')
  }
  if (config.chunkOverlapChars >= config.chunkChars) {
    throw new Error('customer-service-knowledge: chunkOverlapChars must be smaller than chunkChars')
  }
  if (config.resultCount > config.candidateCount) {
    throw new Error('customer-service-knowledge: resultCount must not exceed candidateCount')
  }
  if (!Number.isFinite(config.minimumVectorScore)
    || config.minimumVectorScore < -1 || config.minimumVectorScore > 1) {
    throw new Error('customer-service-knowledge: minimumVectorScore must be a finite number from -1 through 1')
  }
  if (!Number.isFinite(config.minimumRerankScore)) {
    throw new Error('customer-service-knowledge: minimumRerankScore must be finite')
  }
  if (config.maxExcerptBytes > config.maxResultBytes) {
    throw new Error('customer-service-knowledge: maxExcerptBytes must not exceed maxResultBytes')
  }
  if (config.maxResultBytes < minimumKnowledgeResultBytes()) {
    throw new Error(`customer-service-knowledge: maxResultBytes must be at least ${minimumKnowledgeResultBytes()} bytes`)
  }
  for (const [field, value] of Object.entries({
    sourceDirectory: config.sourceDirectory,
    sourceManifestPath: config.sourceManifestPath,
    indexPath: config.indexPath,
    embeddingBaseURL: config.embeddingBaseURL,
    embeddingModel: config.embeddingModel,
    ...config.rerank ? {
      rerankerURL: config.rerankerURL,
      rerankerModel: config.rerankerModel,
    } : {},
  })) {
    if (value.trim().length === 0) throw new Error(`customer-service-knowledge: ${field} must be non-empty`)
  }
  assertEndpoint('embeddingBaseURL', config.embeddingBaseURL)
  if (config.rerank) assertEndpoint('rerankerURL', config.rerankerURL)
  if (config.embeddingApiKeyEnv !== undefined) credentialRef(config.embeddingApiKeyEnv)
  if (config.rerankerApiKeyEnv !== undefined) credentialRef(config.rerankerApiKeyEnv)
  const sourceRoot = resolve(config.sourceDirectory)
  const indexPath = resolve(config.indexPath)
  if (indexPath === resolve(config.sourceManifestPath)) {
    throw new Error('customer-service-knowledge: indexPath must not replace sourceManifestPath')
  }
  if (pathWithin(sourceRoot, indexPath)) {
    throw new Error('customer-service-knowledge: indexPath must be outside sourceDirectory')
  }
}

/**
 * Split plain text into bounded, overlapping fragments at paragraph or sentence boundaries.
 * @param text - normalized source text to divide.
 * @param chunkChars - maximum UTF-16 code units in one fragment.
 * @param overlapChars - suffix code units repeated in the successor fragment.
 * @returns non-empty source fragments in source order.
 */
export function splitText(text: string, chunkChars: number, overlapChars: number): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) return []
  const chunks: string[] = []
  let start = 0
  while (start < normalized.length) {
    const hardEnd = Math.min(start + chunkChars, normalized.length)
    let end = hardEnd
    if (hardEnd < normalized.length) {
      const window = normalized.slice(start, hardEnd)
      const boundary = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
      )
      if (boundary >= Math.floor(chunkChars / 2)) end = start + boundary + 1
    }
    const chunk = normalized.slice(start, end).trim()
    if (chunk.length > 0) chunks.push(chunk)
    if (end >= normalized.length) break
    start = Math.max(end - overlapChars, start + 1)
  }
  return chunks
}

/** Remove non-content HTML markup without executing or interpreting source code. */
function htmlToText(text: string): string {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
}

/** Extract heading-owned sections from one supported source document. */
function extractSections(file: ApprovedSourceFile): SourceSection[] {
  const extension = extname(file.path).toLowerCase()
  const text = extension === '.html' || extension === '.htm'
    ? htmlToText(file.text)
    : extension === '.json'
      ? JSON.stringify(JSON.parse(file.text), null, 2)
      : file.text
  const fallbackTitle = basename(file.path, extension)
  const sections: SourceSection[] = []
  let title = fallbackTitle
  let section: string | undefined
  let lines: string[] = []
  const flush = (): void => {
    const body = lines.join('\n').trim()
    if (body.length > 0) sections.push({ title, ...section === undefined ? {} : { section }, text: body })
    lines = []
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (heading === null) {
      lines.push(line)
      continue
    }
    flush()
    const value = (heading[2] as string).trim()
    if (value.length === 0) continue
    if (heading[1]?.length === 1) title = value
    section = value
  }
  flush()
  return sections.length > 0 ? sections : [{ title, text }]
}

/** Parse the exact approved-source manifest representation. */
function parseSourceManifest(raw: string): ApprovedSourceManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error('customer-service-knowledge: source manifest is not valid JSON', { cause: error })
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['sources', 'version']) || parsed.version !== 1 || !Array.isArray(parsed.sources)) {
    throw new Error('customer-service-knowledge: source manifest must be { version: 1, sources: [...] }')
  }
  const sources: ApprovedSourceEntry[] = []
  for (const [position, entry] of parsed.sources.entries()) {
    if (!isRecord(entry) || !hasExactKeys(entry, ['path', 'sha256'])
      || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      throw new Error(`customer-service-knowledge: source manifest entry ${position + 1} must contain only string path and sha256 fields`)
    }
    const path = entry.path
    if (path.length === 0 || path.includes('\\') || path.includes('\0') || posix.isAbsolute(path)
      || /^[A-Za-z]:\//u.test(path) || posix.normalize(path) !== path || path === '..' || path.startsWith('../')) {
      throw new Error(`customer-service-knowledge: source manifest entry ${position + 1} has an unsafe path`)
    }
    if (!SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase())) {
      throw new Error(`customer-service-knowledge: source manifest entry ${position + 1} uses an unsupported extension`)
    }
    if (!SHA256.test(entry.sha256)) {
      throw new Error(`customer-service-knowledge: source manifest entry ${position + 1} sha256 must be 64 lowercase hex characters`)
    }
    sources.push({ path, sha256: entry.sha256 })
  }
  const paths = sources.map(source => source.path)
  if (new Set(paths).size !== paths.length) {
    throw new Error('customer-service-knowledge: source manifest contains duplicate paths')
  }
  const sorted = [...paths].sort()
  if (paths.some((path, index) => path !== sorted[index])) {
    throw new Error('customer-service-knowledge: source manifest paths must be in lexical order')
  }
  return { version: 1, sources }
}

/** List real supported files while rejecting every symlink under the approved root. */
async function listCorpusPaths(root: string, manifestPath: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`customer-service-knowledge: approved source directory must not contain symlink ${relative(root, absolutePath)}`)
      }
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile() || absolutePath === manifestPath
        || !SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      found.push(relative(root, absolutePath).split('\\').join('/'))
    }
  }
  await visit(root)
  return found
}

/** Read and verify the manifest plus every approved source byte-for-byte. */
async function loadApprovedCorpus(config: KnowledgeConfig): Promise<ApprovedCorpus> {
  const root = resolve(config.sourceDirectory)
  let rootDetails
  try {
    rootDetails = await lstat(root)
  } catch (error) {
    throw new Error(`customer-service-knowledge: sourceDirectory is unavailable: ${root}`, { cause: error })
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error(`customer-service-knowledge: sourceDirectory must be a real directory: ${root}`)
  }
  const manifestPath = resolve(config.sourceManifestPath)
  let manifestDetails
  try {
    manifestDetails = await lstat(manifestPath)
  } catch (error) {
    throw new Error(`customer-service-knowledge: sourceManifestPath is unavailable: ${manifestPath}`, { cause: error })
  }
  if (!manifestDetails.isFile() || manifestDetails.isSymbolicLink()) {
    throw new Error(`customer-service-knowledge: sourceManifestPath must be a real file: ${manifestPath}`)
  }
  const realRoot = await realpath(root)
  const realManifest = await realpath(manifestPath)
  const realIndex = await prospectiveRealPath(config.indexPath)
  if (realIndex === realManifest) {
    throw new Error('customer-service-knowledge: indexPath must not replace sourceManifestPath')
  }
  if (pathWithin(realRoot, realIndex)) {
    throw new Error('customer-service-knowledge: indexPath must be outside sourceDirectory')
  }
  const manifestBytes = await readFile(manifestPath)
  const manifest = parseSourceManifest(decodeUtf8(manifestBytes, 'source manifest'))
  const actualPaths = await listCorpusPaths(root, manifestPath)
  const approvedPaths = manifest.sources.map(source => source.path)
  const missing = approvedPaths.filter(path => !actualPaths.includes(path))
  const unapproved = actualPaths.filter(path => !approvedPaths.includes(path))
  if (missing.length > 0 || unapproved.length > 0) {
    const differences: string[] = []
    if (missing.length > 0) differences.push(`missing: ${missing.join(', ')}`)
    if (unapproved.length > 0) differences.push(`unapproved: ${unapproved.join(', ')}`)
    throw new Error(
      `customer-service-knowledge: source manifest does not match sourceDirectory; ${differences.join('; ')}`,
    )
  }
  const files: ApprovedSourceFile[] = []
  for (const source of manifest.sources) {
    const absolutePath = resolve(root, source.path)
    const bytes = await readFile(absolutePath)
    const actualHash = sha256(bytes)
    if (actualHash !== source.sha256) {
      throw new Error(`customer-service-knowledge: approved source hash mismatch for ${source.path}`)
    }
    files.push({ ...source, text: decodeUtf8(bytes, `approved source ${source.path}`) })
  }
  return {
    files,
    manifestHash: sha256(manifestBytes),
    approvedSourcesHash: sha256(JSON.stringify(manifest.sources)),
  }
}

/** Stable content-derived fragment id that remains unique across repeated headings and text. */
function fragmentId(path: string, sectionIndex: number, chunkIndex: number, text: string): string {
  return sha256(JSON.stringify([path, sectionIndex, chunkIndex, text]))
}

/** Derive the exact chunk text and metadata that any reusable cache must match. */
function deriveChunks(files: readonly ApprovedSourceFile[], config: KnowledgeConfig): ChunkDraft[] {
  const drafts: ChunkDraft[] = []
  for (const file of files) {
    let sections: SourceSection[]
    try {
      sections = extractSections(file)
    } catch (error) {
      throw new Error(`customer-service-knowledge: cannot parse ${file.path}: ${String(error)}`, { cause: error })
    }
    for (const [sectionIndex, source] of sections.entries()) {
      for (const [chunkIndex, text] of splitText(source.text, config.chunkChars, config.chunkOverlapChars).entries()) {
        drafts.push({
          id: fragmentId(file.path, sectionIndex, chunkIndex, text),
          path: file.path,
          title: source.title,
          ...source.section === undefined ? {} : { section: source.section },
          text,
        })
      }
    }
  }
  return drafts
}

/**
 * Score two finite vectors by cosine similarity.
 * @param left - first vector.
 * @param right - second vector.
 * @returns cosine similarity, or negative infinity when values cannot be compared.
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.NEGATIVE_INFINITY
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return Number.NEGATIVE_INFINITY
    dot += a * b
    leftMagnitude += a * a
    rightMagnitude += b * b
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return Number.NEGATIVE_INFINITY
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

/** Strictly parse one disposable cache; malformed content returns undefined and is rebuilt. */
function parsePersistedIndex(payload: unknown): PersistedIndex | undefined {
  if (!isRecord(payload) || !hasExactKeys(payload, ['chunks', 'identity', 'version'])
    || payload.version !== 2 || !isRecord(payload.identity) || !Array.isArray(payload.chunks)) return undefined
  const identity = payload.identity
  if (!hasExactKeys(identity, [
    'approvedSourcesHash', 'chunkChars', 'chunkOverlapChars', 'embeddingBaseURL',
    'embeddingModel', 'manifestHash', 'parserVersion', 'vectorDimension',
  ])) return undefined
  if (identity.parserVersion !== 1 || typeof identity.manifestHash !== 'string' || !SHA256.test(identity.manifestHash)
    || typeof identity.approvedSourcesHash !== 'string' || !SHA256.test(identity.approvedSourcesHash)
    || typeof identity.embeddingBaseURL !== 'string' || typeof identity.embeddingModel !== 'string'
    || !Number.isInteger(identity.chunkChars) || (identity.chunkChars as number) < 1
    || !Number.isInteger(identity.chunkOverlapChars) || (identity.chunkOverlapChars as number) < 0
    || !Number.isInteger(identity.vectorDimension) || (identity.vectorDimension as number) < 0) return undefined
  const vectorDimension = identity.vectorDimension as number
  if ((payload.chunks.length === 0) !== (vectorDimension === 0)) return undefined
  const chunks: IndexedChunk[] = []
  const ids = new Set<string>()
  for (const raw of payload.chunks) {
    if (!isRecord(raw)) return undefined
    const expectedKeys = raw.section === undefined
      ? ['id', 'path', 'text', 'title', 'vector']
      : ['id', 'path', 'section', 'text', 'title', 'vector']
    if (!hasExactKeys(raw, expectedKeys)
      || typeof raw.id !== 'string' || !SHA256.test(raw.id) || ids.has(raw.id)
      || typeof raw.path !== 'string' || raw.path.length === 0
      || typeof raw.title !== 'string' || raw.title.length === 0
      || (raw.section !== undefined && (typeof raw.section !== 'string' || raw.section.length === 0))
      || typeof raw.text !== 'string' || raw.text.length === 0 || !Array.isArray(raw.vector)
      || raw.vector.length !== vectorDimension
      || !raw.vector.every(value => typeof value === 'number' && Number.isFinite(value))) return undefined
    ids.add(raw.id)
    chunks.push({
      id: raw.id,
      path: raw.path,
      title: raw.title,
      ...raw.section === undefined ? {} : { section: raw.section },
      text: raw.text,
      vector: raw.vector as number[],
    })
  }
  return {
    version: 2,
    identity: {
      parserVersion: 1,
      manifestHash: identity.manifestHash,
      approvedSourcesHash: identity.approvedSourcesHash,
      embeddingBaseURL: identity.embeddingBaseURL,
      embeddingModel: identity.embeddingModel,
      chunkChars: identity.chunkChars as number,
      chunkOverlapChars: identity.chunkOverlapChars as number,
      vectorDimension,
    },
    chunks,
  }
}

/** Read one cache, propagating filesystem failures but discarding malformed JSON or fields. */
async function readIndex(path: string): Promise<PersistedIndex | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return parsePersistedIndex(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** Persist one complete cache atomically with owner-only file and directory permissions. */
async function writeIndex(path: string, index: PersistedIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(index)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** Parse one OpenAI-compatible embedding response. */
function parseEmbeddingResponse(payload: unknown, expectedCount: number): number[][] {
  if (!isRecord(payload)) {
    throw new Error('customer-service-knowledge: embedding endpoint returned a non-object response')
  }
  const data = payload.data
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error(`customer-service-knowledge: embedding endpoint returned ${Array.isArray(data) ? data.length : 0} vectors for ${expectedCount} inputs`)
  }
  const vectors = data.map((entry, position): number[] => {
    if (!isRecord(entry)) throw new Error(`customer-service-knowledge: embedding ${position} is malformed`)
    const vector = entry.embedding
    if (!Array.isArray(vector) || vector.length === 0
      || !vector.every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`customer-service-knowledge: embedding ${position} is not a finite non-empty vector`)
    }
    return vector as number[]
  })
  const dimension = (vectors[0] as number[]).length
  if (vectors.some(vector => vector.length !== dimension)) {
    throw new Error('customer-service-knowledge: embedding endpoint returned inconsistent vector dimensions')
  }
  return vectors
}

/** Parse a common rerank response without accepting arbitrary response fields. */
function parseRerankResponse(payload: unknown, candidateCount: number): RerankEntry[] | undefined {
  if (!isRecord(payload)) return undefined
  const raw = payload.results ?? payload.data
  if (!Array.isArray(raw)) return undefined
  const entries: RerankEntry[] = []
  const indexes = new Set<number>()
  for (const entry of raw) {
    if (!isRecord(entry)) return undefined
    const index = entry.index
    const score = entry.relevance_score ?? entry.score
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= candidateCount
      || indexes.has(index) || typeof score !== 'number' || !Number.isFinite(score)) return undefined
    indexes.add(index)
    entries.push({ index, score })
  }
  return entries.length === 0 ? undefined : entries
}

/** One cancellable JSON request with a deployment-owned deadline. */
async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  bearerToken: string | undefined,
): Promise<unknown> {
  const timeout = new AbortController()
  const timer = setTimeout(() => {
    timeout.abort(new Error(`customer-service-knowledge: request timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const combined = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...bearerToken === undefined ? {} : { authorization: `Bearer ${bearerToken}` },
      },
      body: JSON.stringify(body),
      signal: combined,
    })
    if (!response.ok) throw new Error(`customer-service-knowledge: model endpoint returned HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Canonical endpoint identity used in the cache. */
function normalizedEndpoint(value: string): string {
  return new URL(value).href
}

/** Append the embeddings route without preserving a trailing slash ambiguity. */
function embeddingsUrl(base: string): string {
  return `${base.replace(/\/$/u, '')}/embeddings`
}

/** Whether one parsed cache was derived from the current sources and chunk configuration. */
function reusableIndex(index: PersistedIndex, derivation: DerivedCorpus): boolean {
  const identity = index.identity
  const expected = derivation.identity
  if (identity.manifestHash !== expected.manifestHash
    || identity.approvedSourcesHash !== expected.approvedSourcesHash
    || identity.embeddingBaseURL !== expected.embeddingBaseURL
    || identity.embeddingModel !== expected.embeddingModel
    || identity.chunkChars !== expected.chunkChars
    || identity.chunkOverlapChars !== expected.chunkOverlapChars
    || index.chunks.length !== derivation.drafts.length) return false
  return index.chunks.every((chunk, index) => {
    const draft = derivation.drafts[index]
    return draft !== undefined
      && chunk.id === draft.id && chunk.path === draft.path && chunk.title === draft.title
      && chunk.section === draft.section && chunk.text === draft.text
  })
}

/** Build and query the private vector cache used by one standing customer-service preset. */
export class LocalKnowledgeIndex {
  private index: PersistedIndex | undefined
  private queue: Promise<void> = Promise.resolve()

  /**
   * @param config - complete deployment-owned retrieval configuration.
   * @param warn - diagnostic sink for recoverable reranker failure.
   */
  constructor(
    private readonly config: KnowledgeConfig,
    private readonly warn: (message: string) => void,
    private readonly resolveCredential?: KnowledgeCredentialResolver,
  ) {
    assertKnowledgeConfig(config)
  }

  /** Resolve a named model credential without retaining its value between requests. */
  private async bearerToken(reference: string | undefined): Promise<string | undefined> {
    if (reference === undefined) return undefined
    if (this.resolveCredential === undefined) {
      throw new Error(`customer-service-knowledge: no credential resolver for ${reference}`)
    }
    return await this.resolveCredential(reference)
  }

  /** Serialize access to the standing instance's cache state and index file. */
  private async exclusive<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolveQueue) => { release = resolveQueue })
    await previous
    try {
      signal?.throwIfAborted()
      return await operation()
    } finally {
      release()
    }
  }

  /** Derive current approved chunks and every non-vector cache identity field. */
  private async derive(): Promise<DerivedCorpus> {
    const corpus = await loadApprovedCorpus(this.config)
    return {
      files: corpus.files.length,
      drafts: deriveChunks(corpus.files, this.config),
      identity: {
        parserVersion: 1,
        manifestHash: corpus.manifestHash,
        approvedSourcesHash: corpus.approvedSourcesHash,
        embeddingBaseURL: normalizedEndpoint(this.config.embeddingBaseURL),
        embeddingModel: this.config.embeddingModel,
        chunkChars: this.config.chunkChars,
        chunkOverlapChars: this.config.chunkOverlapChars,
      },
    }
  }

  /** Build a fresh cache, requiring one vector dimension across all batches. */
  private async rebuild(
    derivation: DerivedCorpus,
    signal: AbortSignal | undefined,
    expectedDimension?: number,
  ): Promise<PersistedIndex> {
    const chunks: IndexedChunk[] = []
    let vectorDimension = expectedDimension
    for (let start = 0; start < derivation.drafts.length; start += this.config.embeddingBatchSize) {
      const batch = derivation.drafts.slice(start, start + this.config.embeddingBatchSize)
      const vectors = await this.embed(batch.map(chunk => chunk.text), signal)
      for (const [position, draft] of batch.entries()) {
        const vector = vectors[position] as number[]
        vectorDimension ??= vector.length
        if (vector.length !== vectorDimension) {
          throw new Error('customer-service-knowledge: embedding endpoint changed vector dimensions across requests')
        }
        chunks.push({ ...draft, vector })
      }
    }
    const next: PersistedIndex = {
      version: 2,
      identity: { ...derivation.identity, vectorDimension: vectorDimension ?? 0 },
      chunks,
    }
    await writeIndex(this.config.indexPath, next)
    this.index = next
    return next
  }

  /** Build or reuse one strictly validated cache without acquiring the instance queue. */
  private async prepareUnlocked(signal: AbortSignal | undefined): Promise<PreparedIndex> {
    const derivation = await this.derive()
    if (this.index !== undefined && reusableIndex(this.index, derivation)) {
      return { files: derivation.files, index: this.index, derivation, rebuilt: false }
    }
    const persisted = await readIndex(this.config.indexPath)
    if (persisted !== undefined && reusableIndex(persisted, derivation)) {
      this.index = persisted
      return { files: derivation.files, index: persisted, derivation, rebuilt: false }
    }
    const index = await this.rebuild(derivation, signal)
    return { files: derivation.files, index, derivation, rebuilt: true }
  }

  /**
   * Validate the manifest, directory inventory, source hashes, decoding, and chunk derivation.
   * @param signal - optional cancellation checked before validation starts.
   * @returns approved-file and derived-fragment counts without contacting a model endpoint.
   */
  async validateSources(signal?: AbortSignal): Promise<{ files: number; chunks: number }> {
    return await this.exclusive(signal, async () => {
      const derivation = await this.derive()
      return { files: derivation.files, chunks: derivation.drafts.length }
    })
  }

  /**
   * Validate approved sources and build or reuse their disposable cache.
   * @param signal - optional cancellation signal forwarded to embedding requests.
   * @returns approved-file and fragment counts plus whether this call rebuilt the cache.
   */
  async prepare(signal?: AbortSignal): Promise<{ files: number; chunks: number; rebuilt: boolean }> {
    return await this.exclusive(signal, async () => {
      const prepared = await this.prepareUnlocked(signal)
      return { files: prepared.files, chunks: prepared.index.chunks.length, rebuilt: prepared.rebuilt }
    })
  }

  /**
   * Search approved sources and return only threshold-qualified, completely bounded evidence.
   * @param query - customer question or factual subquestion within {@link KnowledgeConfig.maxQueryBytes}.
   * @param signal - cancellation signal from the executing tool call.
   * @returns ranked evidence or an explicit empty-corpus/insufficient-evidence outcome.
   */
  async search(query: string, signal?: AbortSignal): Promise<KnowledgeSearchResult> {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length === 0) throw new Error('customer-service-knowledge: query must be non-empty')
    if (utf8ByteLength(normalizedQuery) > this.config.maxQueryBytes) {
      throw new Error(`customer-service-knowledge: query exceeds ${this.config.maxQueryBytes} UTF-8 bytes`)
    }
    return await this.exclusive(signal, () => this.searchUnlocked(normalizedQuery, signal))
  }

  /** Execute one lookup while holding the standing index queue. */
  private async searchUnlocked(query: string, signal: AbortSignal | undefined): Promise<KnowledgeSearchResult> {
    let prepared = await this.prepareUnlocked(signal)
    if (prepared.index.chunks.length === 0) {
      return { status: 'not-found', reason: 'empty-corpus', sources: [], reranked: false }
    }
    const queryVector = (await this.embed([query], signal))[0] as number[]
    if (queryVector.length !== prepared.index.identity.vectorDimension) {
      const index = await this.rebuild(prepared.derivation, signal, queryVector.length)
      prepared = { ...prepared, index, rebuilt: true }
    }
    const candidates = prepared.index.chunks
      .map(chunk => ({ chunk, score: cosineSimilarity(queryVector, chunk.vector) }))
      .filter((candidate): candidate is RankedChunk => Number.isFinite(candidate.score))
      .sort((left, right) => right.score - left.score)
      .slice(0, this.config.candidateCount)
    if (candidates.length === 0) {
      return { status: 'not-found', reason: 'insufficient-evidence', sources: [], reranked: false }
    }
    const reranked = await this.rerank(query, candidates, signal)
    const vectorScores = new Map(candidates.map(candidate => [candidate.chunk.id, candidate.score]))
    const relevant = reranked.entries.filter((entry) => {
      const vectorScore = vectorScores.get(entry.chunk.id)
      return vectorScore !== undefined
        && vectorScore >= this.config.minimumVectorScore
        && (!reranked.used || entry.score >= this.config.minimumRerankScore)
    })
    const chosen = relevant.slice(0, this.config.resultCount)
    if (chosen.length === 0) {
      return { status: 'not-found', reason: 'insufficient-evidence', sources: [], reranked: reranked.used }
    }
    const sources: KnowledgeSource[] = chosen.map(({ chunk, score }) => ({
      id: chunk.id,
      path: chunk.path,
      title: chunk.title,
      ...chunk.section === undefined ? {} : { section: chunk.section },
      excerpt: truncateUtf8(chunk.text, this.config.maxExcerptBytes),
      score,
    }))
    return fitKnowledgeResult({ status: 'found', sources, reranked: reranked.used }, this.config.maxResultBytes)
  }

  /** Send one embedding batch through the configured endpoint. */
  private async embed(input: readonly string[], signal: AbortSignal | undefined): Promise<number[][]> {
    const payload = await postJson(embeddingsUrl(this.config.embeddingBaseURL), {
      model: this.config.embeddingModel,
      input,
    }, this.config.requestTimeoutMs, signal, await this.bearerToken(this.config.embeddingApiKeyEnv))
    return parseEmbeddingResponse(payload, input.length)
  }

  /** Attempt one rerank; caller cancellation propagates and transient failures retry next lookup. */
  private async rerank(
    query: string,
    candidates: readonly RankedChunk[],
    signal: AbortSignal | undefined,
  ): Promise<{ entries: RankedChunk[]; used: boolean }> {
    if (!this.config.rerank) return { entries: [...candidates], used: false }
    try {
      const payload = await postJson(this.config.rerankerURL, {
        model: this.config.rerankerModel,
        query,
        documents: candidates.map(candidate => candidate.chunk.text),
        top_n: this.config.resultCount,
      }, this.config.requestTimeoutMs, signal, await this.bearerToken(this.config.rerankerApiKeyEnv))
      const ranks = parseRerankResponse(payload, candidates.length)
      if (ranks === undefined) throw new Error('response does not contain unique ranked candidate indexes')
      const byIndex = new Map(ranks.map(rank => [rank.index, rank.score]))
      const entries = candidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ index }) => byIndex.has(index))
        .map(({ candidate, index }) => ({ ...candidate, score: byIndex.get(index) as number }))
        .sort((left, right) => right.score - left.score)
      return { entries, used: true }
    } catch (error) {
      if (signal?.aborted) throw error
      this.warn(`customer-service-knowledge: reranker request failed; using threshold-qualified vector order for this lookup (${error instanceof Error ? error.message : String(error)})`)
      return { entries: [...candidates], used: false }
    }
  }
}
