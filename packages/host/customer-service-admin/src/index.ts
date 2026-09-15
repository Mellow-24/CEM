/**
 * Host-owned operational projection for the Macau customer-service console.
 * @module @deepseek-ai/dsh-host-customer-service-admin
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  link, lstat, mkdir, open, readFile, readdir, realpath, unlink,
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import {
  LocalKnowledgeIndex, assertKnowledgeConfig, resolveKnowledgeCredential,
} from '@deepseek-ai/dsh-customer-service-knowledge'
import type { KnowledgeConfig } from '@deepseek-ai/dsh-customer-service-knowledge'
import {
  WikiReader, assertWikiReaderConfig,
} from '@deepseek-ai/dsh-customer-service-wiki'
import type {
  WikiNavigation, WikiReaderConfig,
} from '@deepseek-ai/dsh-customer-service-wiki'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { QualityEngine } from './quality-engine.ts'
import type { QualityConfig, QualityInspection, QualityRun, QualityRunId, QualityRunSummary,
  QualityStartRequest, QualityReviewRequest } from './quality-types.ts'
import type {
  CustomerServiceAdminOverview,
  CustomerServiceBadCase,
  CustomerServiceBadCaseId,
  CustomerServiceBadCaseList,
  CustomerServiceBadCaseSummary,
  CustomerServiceDocument,
  CustomerServiceDocumentId,
  CustomerServiceDocumentList,
  CustomerServiceRagEvidenceId,
  CustomerServiceRagIndexStatus,
  CustomerServiceRagSearchTestResult,
  CustomerServiceSearchTestRequest,
  CustomerServiceSearchTestResult,
  CustomerServiceStagedDocument,
  CustomerServiceStagedDocumentList,
  CustomerServiceStagingRevision,
  CustomerServiceStageTextDocumentError,
  CustomerServiceStageTextDocumentRequest,
  CustomerServiceStageTextDocumentResult,
  CustomerServiceWikiEvidenceId,
  CustomerServiceWikiPageId,
  CustomerServiceWikiRelease,
  CustomerServiceWikiReleaseId,
  CustomerServiceWikiSearchTestRequest,
  CustomerServiceWikiSearchTestResult,
} from './types.ts'

export type * from './types.ts'

/** Wiki reader settings plus the operator-owned raw-source root to inventory. */
export interface CustomerServiceAdminWikiConfig extends WikiReaderConfig {
  /** Recursive raw-source directory whose files are compared with the current release. */
  readonly sourceDirectory: string
}

/** Bounds for every filesystem projection exposed by the Remote. */
export interface CustomerServiceAdminLimits {
  readonly maxDocuments: number
  readonly maxWikiPages: number
  readonly maxBadCases: number
  readonly maxBadCasesBytes: number
  readonly maxIndexBytes: number
  readonly maxStagedDocumentBytes: number
}

/** Complete deployment configuration for the customer-service admin gateway. */
export interface Config {
  readonly quality?: QualityConfig | undefined
  readonly rag: KnowledgeConfig
  readonly wiki: CustomerServiceAdminWikiConfig
  readonly badCasesPath: string
  readonly stagingDirectory: string
  readonly limits: CustomerServiceAdminLimits
}

const knowledgeConfigSchema: s<KnowledgeConfig> = s.object({
  sourceDirectory: s.string().required(),
  sourceManifestPath: s.string().required(),
  indexPath: s.string().required(),
  embeddingBaseURL: s.string().required(),
  embeddingModel: s.string().required(),
  embeddingApiKeyEnv: s.string(),
  rerankerURL: s.string().required(),
  rerankerModel: s.string().required(),
  rerankerApiKeyEnv: s.string(),
  rerank: s.boolean().required(),
  embeddingBatchSize: s.number().required(),
  chunkChars: s.number().required(),
  chunkOverlapChars: s.number().required(),
  candidateCount: s.number().required(),
  resultCount: s.number().required(),
  minimumVectorScore: s.number().required(),
  minimumRerankScore: s.number().required(),
  maxQueryBytes: s.number().required(),
  maxExcerptBytes: s.number().required(),
  maxResultBytes: s.number().required(),
  requestTimeoutMs: s.number().required(),
})

const wikiConfigSchema: s<CustomerServiceAdminWikiConfig> = s.object({
  sourceDirectory: s.string().required(),
  releaseDirectory: s.string().required(),
  navigationMaxChars: s.number().required(),
  evidenceChunkChars: s.number().required(),
  evidenceChunkOverlapChars: s.number().required(),
  resultCount: s.number().required(),
  maxResultChars: s.number().required(),
  queryMaxChars: s.number().required(),
})

/** Loader schema for all paths, retrieval settings, and response bounds. */
export const Config: s<Config> = s.object({
  quality: s.union([s.const(undefined), s.object({
    directory: s.string().required(), provider: s.string().required(), model: s.string().required(),
    timeoutMs: s.number().required(), maxEvents: s.number().required(), maxInputBytes: s.number().required(),
    maxOutputTokens: s.number().required(), maxRecordBytes: s.number().required(), maxRuns: s.number().required(),
    maxTurns: s.number().required(), slowResponseMs: s.number().required(),
  })]),
  rag: knowledgeConfigSchema.required(),
  wiki: wikiConfigSchema.required(),
  badCasesPath: s.string().required(),
  stagingDirectory: s.string().required(),
  limits: s.object({
    maxDocuments: s.number().required(),
    maxWikiPages: s.number().required(),
    maxBadCases: s.number().required(),
    maxBadCasesBytes: s.number().required(),
    maxIndexBytes: s.number().required(),
    maxStagedDocumentBytes: s.number().required(),
  }).required(),
})

interface RagSourceEntry {
  readonly path: string
  readonly sha256: string
}

interface RagSnapshot {
  readonly files: number
  readonly chunks: number
  readonly sources: readonly RagSourceEntry[]
  readonly manifestHash: string
  readonly approvedSourcesHash: string
}

interface WikiReleaseArtifact {
  readonly path: string
  readonly sourceHash: string
}

interface ValidatedWikiReleaseManifest {
  readonly policyHash: string
  readonly artifacts: readonly WikiReleaseArtifact[]
}

interface WikiSnapshot {
  readonly release: CustomerServiceWikiRelease
  readonly artifacts: readonly WikiReleaseArtifact[]
}

interface ParsedIndex {
  readonly formatVersion: number
  readonly indexedChunks: number
  readonly vectorDimension: number
  readonly embeddingModel: string
  readonly identity: {
    readonly parserVersion: number
    readonly manifestHash: string
    readonly approvedSourcesHash: string
    readonly embeddingBaseURL: string
    readonly embeddingModel: string
    readonly chunkChars: number
    readonly chunkOverlapChars: number
  }
}

const SUPPORTED_EXTENSIONS = Object.freeze(['.csv', '.htm', '.html', '.json', '.markdown', '.md', '.txt'])
const SUPPORTED_EXTENSION_SET = new Set(SUPPORTED_EXTENSIONS)
const SHA256 = /^[a-f0-9]{64}$/u
const STAGING_TEMP = /^\.dsh-stage-[0-9a-f-]+\.tmp$/u
const ISO_CAPTURED_AT = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z)?$/u

/** Hash bytes or text with the digest used by both retrieval implementations. */
function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Whether a parsed JSON value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a wire-decoded record contains exactly the fields owned by its format. */
function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(record, key))
}

/** Whether a ledger timestamp is a real ISO calendar date or UTC instant. */
function isIsoCapturedAt(value: string): boolean {
  const match = ISO_CAPTURED_AT.exec(value)
  if (match === null) return false
  const normalized = `${match[1]}T${match[2] ?? '00:00:00'}.${(match[3] ?? '').padEnd(3, '0')}Z`
  const parsed = new Date(normalized)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === normalized
}

/** Require an array containing only strings. */
function stringArray(value: unknown, subject: string): readonly string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`customer-service-admin: ${subject} must be an array of strings`)
  }
  return value
}

/** Brand a content-derived or owner-validated document id. */
function documentId(value: string): CustomerServiceDocumentId {
  return value as CustomerServiceDocumentId
}

/** Brand an operator-owned bad-case id after parsing its record. */
function badCaseId(value: string): CustomerServiceBadCaseId {
  return value as CustomerServiceBadCaseId
}

/** Brand a Wiki release id validated by WikiReader. */
function wikiReleaseId(value: string): CustomerServiceWikiReleaseId {
  return value as CustomerServiceWikiReleaseId
}

/** Brand a Wiki page id validated by WikiReader. */
function wikiPageId(value: string): CustomerServiceWikiPageId {
  return value as CustomerServiceWikiPageId
}

/** Brand a RAG evidence id validated by LocalKnowledgeIndex. */
function ragEvidenceId(value: string): CustomerServiceRagEvidenceId {
  return value as CustomerServiceRagEvidenceId
}

/** Brand a Wiki evidence id validated by WikiReader. */
function wikiEvidenceId(value: string): CustomerServiceWikiEvidenceId {
  return value as CustomerServiceWikiEvidenceId
}

/** Brand one content-derived staging snapshot token. */
function stagingRevision(value: string): CustomerServiceStagingRevision {
  return value as CustomerServiceStagingRevision
}

/** Whether target is root itself or a lexical descendant. */
function pathWithin(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

/** Resolve a not-yet-created path through its nearest existing real ancestor. */
async function prospectiveRealPath(path: string): Promise<string> {
  const suffix = [basename(path)]
  let parent = dirname(resolve(path))
  for (;;) {
    try {
      return resolve(await realpath(parent), ...suffix)
    } catch (error) {
      /* v8 ignore next -- requires a host filesystem failure other than a not-yet-created ancestor */
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const next = dirname(parent)
    /* v8 ignore next -- every supported host resolves an existing filesystem root before this guard */
    if (next === parent) throw new Error(`customer-service-admin: cannot resolve path parent for ${path}`)
    suffix.unshift(basename(parent))
    parent = next
  }
}

/** Reject staging paths that overlap any live source or artifact location. */
function assertLexicalStagingIsolation(config: Config): void {
  const staging = resolve(config.stagingDirectory)
  const protectedPaths = [
    config.rag.sourceDirectory,
    config.rag.sourceManifestPath,
    config.rag.indexPath,
    config.wiki.sourceDirectory,
    config.wiki.releaseDirectory,
    config.badCasesPath,
  ].map(path => resolve(path))
  if (staging === dirname(staging) || protectedPaths.some(path => pathWithin(staging, path) || pathWithin(path, staging))) {
    throw new Error('customer-service-admin: stagingDirectory must not overlap a live source or artifact path')
  }
}

/** Validate deployment configuration even for programmatic construction. */
function assertConfig(config: Config): void {
  assertKnowledgeConfig(config.rag)
  assertWikiReaderConfig(config.wiki)
  for (const [field, value] of Object.entries({
    badCasesPath: config.badCasesPath,
    stagingDirectory: config.stagingDirectory,
    wikiSourceDirectory: config.wiki.sourceDirectory,
  })) {
    if (value.trim().length === 0) throw new Error(`customer-service-admin: ${field} must be non-empty`)
  }
  for (const [field, value] of Object.entries(config.limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`customer-service-admin: limits.${field} must be a positive safe integer`)
    }
  }
  assertLexicalStagingIsolation(config)
}

/** Require runtime-resolved staging isolation so configured symlink ancestors cannot alias live data. */
async function assertRealStagingIsolation(config: Config): Promise<void> {
  const staging = await prospectiveRealPath(config.stagingDirectory)
  const protectedPaths = await Promise.all([
    config.rag.sourceDirectory,
    config.rag.sourceManifestPath,
    config.rag.indexPath,
    config.wiki.sourceDirectory,
    config.wiki.releaseDirectory,
    config.badCasesPath,
  ].map(prospectiveRealPath))
  if (protectedPaths.some(path => pathWithin(staging, path) || pathWithin(path, staging))) {
    throw new Error('customer-service-admin: stagingDirectory resolves across a live source or artifact path')
  }
}

/** Copy the exact RAG entries LocalKnowledgeIndex validated from unchanged manifest bytes. */
function projectValidatedRagManifest(text: string): readonly RagSourceEntry[] {
  const payload = JSON.parse(text) as { readonly sources: readonly RagSourceEntry[] }
  return payload.sources.map(source => ({ path: source.path, sha256: source.sha256 }))
}

/** Read one stable approved RAG snapshot around LocalKnowledgeIndex validation. */
async function readRagSnapshot(
  index: LocalKnowledgeIndex,
  config: Config,
): Promise<RagSnapshot> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await readFile(config.rag.sourceManifestPath)
    const counts = await index.validateSources()
    const after = await readFile(config.rag.sourceManifestPath)
    /* v8 ignore next -- requires another process to replace the manifest during this validation call */
    if (sha256(before) !== sha256(after)) continue
    const sources = projectValidatedRagManifest(after.toString('utf8'))
    if (sources.length > config.limits.maxDocuments) {
      throw new Error(`customer-service-admin: RAG document count exceeds ${String(config.limits.maxDocuments)}`)
    }
    return {
      files: counts.files,
      chunks: counts.chunks,
      sources,
      manifestHash: sha256(after),
      approvedSourcesHash: sha256(JSON.stringify(sources)),
    }
  }
  /* v8 ignore next -- requires two consecutive cross-process manifest replacement races */
  throw new Error('customer-service-admin: RAG source manifest changed during projection')
}

/** Parse enough of a bounded cache to report whether its complete content is structurally valid. */
function parseIndex(payload: unknown): ParsedIndex | undefined {
  if (!isRecord(payload) || !hasExactKeys(payload, ['chunks', 'identity', 'version'])
    || payload.version !== 2 || !isRecord(payload.identity) || !Array.isArray(payload.chunks)) {
    return undefined
  }
  const identity = payload.identity
  if (!hasExactKeys(identity, [
    'approvedSourcesHash', 'chunkChars', 'chunkOverlapChars', 'embeddingBaseURL',
    'embeddingModel', 'manifestHash', 'parserVersion', 'vectorDimension',
  ])) return undefined
  if (identity.parserVersion !== 1
    || typeof identity.manifestHash !== 'string' || !SHA256.test(identity.manifestHash)
    || typeof identity.approvedSourcesHash !== 'string' || !SHA256.test(identity.approvedSourcesHash)
    || typeof identity.embeddingBaseURL !== 'string' || typeof identity.embeddingModel !== 'string'
    || !Number.isInteger(identity.chunkChars) || (identity.chunkChars as number) < 1
    || !Number.isInteger(identity.chunkOverlapChars) || (identity.chunkOverlapChars as number) < 0
    || !Number.isInteger(identity.vectorDimension) || (identity.vectorDimension as number) < 0) return undefined
  const dimension = identity.vectorDimension as number
  if ((payload.chunks.length === 0) !== (dimension === 0)) return undefined
  const ids = new Set<string>()
  for (const chunk of payload.chunks) {
    if (!isRecord(chunk)) return undefined
    const expectedKeys = chunk.section === undefined
      ? ['id', 'path', 'text', 'title', 'vector']
      : ['id', 'path', 'section', 'text', 'title', 'vector']
    if (!hasExactKeys(chunk, expectedKeys)
      || typeof chunk.id !== 'string' || !SHA256.test(chunk.id) || ids.has(chunk.id)
      || typeof chunk.path !== 'string' || chunk.path.length === 0
      || typeof chunk.title !== 'string' || chunk.title.length === 0
      || (chunk.section !== undefined && (typeof chunk.section !== 'string' || chunk.section.length === 0))
      || typeof chunk.text !== 'string' || chunk.text.length === 0
      || !Array.isArray(chunk.vector) || chunk.vector.length !== dimension
      || !chunk.vector.every(value => typeof value === 'number' && Number.isFinite(value))) return undefined
    ids.add(chunk.id)
  }
  return {
    formatVersion: 2,
    indexedChunks: payload.chunks.length,
    vectorDimension: dimension,
    embeddingModel: identity.embeddingModel,
    identity: {
      parserVersion: 1,
      manifestHash: identity.manifestHash,
      approvedSourcesHash: identity.approvedSourcesHash,
      embeddingBaseURL: identity.embeddingBaseURL,
      embeddingModel: identity.embeddingModel,
      chunkChars: identity.chunkChars as number,
      chunkOverlapChars: identity.chunkOverlapChars as number,
    },
  }
}

/** Inspect the disposable vector cache without rebuilding or contacting its model endpoint. */
async function inspectIndex(config: Config, rag: RagSnapshot): Promise<CustomerServiceRagIndexStatus> {
  let details
  try {
    details = await lstat(config.rag.indexPath)
  } catch (error) {
    /* v8 ignore else -- only an absent disposable cache is an operational state */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    /* v8 ignore next -- requires a host permission or I/O fault rather than an absent cache */
    throw error
  }
  const base = {
    sizeBytes: details.size,
    modifiedAt: details.mtime.toISOString(),
  }
  if (!details.isFile() || details.isSymbolicLink() || details.size > config.limits.maxIndexBytes) {
    return { state: 'invalid', ...base }
  }
  const bytes = await readFile(config.rag.indexPath)
  /* v8 ignore next -- requires the cache inode to grow between lstat and readFile */
  if (bytes.length > config.limits.maxIndexBytes) return { state: 'invalid', ...base, sizeBytes: bytes.length }
  let payload: unknown
  try {
    payload = JSON.parse(bytes.toString('utf8'))
  } catch {
    return { state: 'invalid', ...base }
  }
  const parsed = parseIndex(payload)
  if (parsed === undefined) return { state: 'invalid', ...base }
  const identity = parsed.identity
  const matchesConfiguredIdentity = parsed.indexedChunks === rag.chunks
    && identity.manifestHash === rag.manifestHash
    && identity.approvedSourcesHash === rag.approvedSourcesHash
    && identity.embeddingBaseURL === new URL(config.rag.embeddingBaseURL).href
    && identity.embeddingModel === config.rag.embeddingModel
    && identity.chunkChars === config.rag.chunkChars
    && identity.chunkOverlapChars === config.rag.chunkOverlapChars
  return {
    state: 'present',
    ...base,
    formatVersion: parsed.formatVersion,
    indexedChunks: parsed.indexedChunks,
    vectorDimension: parsed.vectorDimension,
    embeddingModel: parsed.embeddingModel,
    matchesConfiguredIdentity,
  }
}

/** Read validated Wiki release metadata that is not included in reader navigation. */
async function readWikiSnapshot(
  reader: WikiReader,
  config: Config,
): Promise<WikiSnapshot> {
  const navigation = await reader.navigation()
  if (navigation.pages.length > config.limits.maxWikiPages) {
    throw new Error(`customer-service-admin: Wiki page count exceeds ${String(config.limits.maxWikiPages)}`)
  }
  const path = resolve(config.wiki.releaseDirectory, 'releases', navigation.releaseId, 'manifest.json')
  // WikiReader just validated this immutable release file and its complete graph.
  const payload = JSON.parse(await readFile(path, 'utf8')) as ValidatedWikiReleaseManifest
  const artifacts = payload.artifacts.map(artifact => ({
    path: artifact.path,
    sourceHash: artifact.sourceHash,
  }))
  return {
    release: projectWikiRelease(navigation, payload.policyHash, artifacts.length),
    artifacts,
  }
}

/** Convert reader navigation into browser-safe branded release metadata. */
function projectWikiRelease(
  navigation: WikiNavigation,
  policyHash: string,
  sourceArtifacts: number,
): CustomerServiceWikiRelease {
  return {
    releaseId: wikiReleaseId(navigation.releaseId),
    policyHash,
    pages: navigation.pages.map(page => ({
      pageId: wikiPageId(page.id),
      kind: page.kind,
      title: page.title,
      language: page.language,
    })),
    sourceArtifacts,
  }
}

/** List supported real files recursively and reject every source-tree symlink. */
async function listSourceFiles(root: string, maximum: number): Promise<readonly string[]> {
  const rootDetails = await lstat(root)
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error('customer-service-admin: Wiki sourceDirectory must be a real directory')
  }
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`customer-service-admin: Wiki sourceDirectory contains symbolic link ${relative(root, path)}`)
      }
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile() && SUPPORTED_EXTENSION_SET.has(extname(entry.name).toLowerCase())) {
        files.push(relative(root, path).split(sep).join('/'))
        if (files.length > maximum) {
          throw new Error(`customer-service-admin: Wiki document count exceeds ${String(maximum)}`)
        }
      }
    }
  }
  await visit(root)
  return files
}

/** Project one RAG source manifest into document rows. */
async function ragDocuments(config: Config, rag: RagSnapshot): Promise<CustomerServiceDocument[]> {
  const rows: CustomerServiceDocument[] = []
  for (const source of rag.sources) {
    const bytes = await readFile(resolve(config.rag.sourceDirectory, ...source.path.split('/')))
    /* v8 ignore next 2 -- requires another process to mutate an approved source after snapshot validation */
    if (sha256(bytes) !== source.sha256) {
      throw new Error(`customer-service-admin: RAG source changed during projection: ${source.path}`)
    }
    rows.push({
      documentId: documentId(sha256(JSON.stringify(['rag', source.path, source.sha256]))),
      retrieval: 'rag',
      relativePath: source.path,
      sizeBytes: bytes.length,
      sha256: source.sha256,
      state: 'approved',
    })
  }
  return rows
}

/** Project Wiki raw sources and compare each exact version with the current release. */
async function wikiDocuments(config: Config, wiki: WikiSnapshot): Promise<CustomerServiceDocument[]> {
  const paths = await listSourceFiles(config.wiki.sourceDirectory, config.limits.maxDocuments)
  const published = new Map(wiki.artifacts.map(artifact => [artifact.path, artifact.sourceHash]))
  const rows: CustomerServiceDocument[] = []
  for (const path of paths) {
    const bytes = await readFile(resolve(config.wiki.sourceDirectory, ...path.split('/')))
    const hash = sha256(bytes)
    const releasedHash = published.get(path)
    rows.push({
      documentId: documentId(sha256(JSON.stringify(['llm-wiki', path, hash]))),
      retrieval: 'llm-wiki',
      relativePath: path,
      sizeBytes: bytes.length,
      sha256: hash,
      state: releasedHash === undefined ? 'unpublished' : releasedHash === hash ? 'published' : 'changed',
    })
  }
  return rows
}

/** Parse one untrusted JSONL bad-case record into the limited console projection. */
function parseBadCase(payload: unknown, line: number): CustomerServiceBadCase {
  if (!isRecord(payload) || typeof payload.id !== 'string' || payload.id.length === 0
    || (payload.status !== 'open' && payload.status !== 'closed')
    || typeof payload.preset !== 'string' || payload.preset.length === 0
    || (payload.retrieval !== 'rag' && payload.retrieval !== 'llm-wiki')
    || typeof payload.capturedAt !== 'string' || !isIsoCapturedAt(payload.capturedAt)
    || typeof payload.queryLanguage !== 'string' || payload.queryLanguage.length === 0
    || typeof payload.query !== 'string' || payload.query.length === 0
    || (payload.verdict !== 'pass' && payload.verdict !== 'fail')) {
    throw new Error(`customer-service-admin: bad case line ${String(line)} is invalid`)
  }
  const diagnosis = payload.diagnosis
  if (!isRecord(diagnosis) || typeof diagnosis.summary !== 'string') {
    throw new Error(`customer-service-admin: bad case line ${String(line)} is invalid`)
  }
  const failureTypes = stringArray(diagnosis.failureTypes, `bad case line ${String(line)} diagnosis.failureTypes`)
  const acceptanceCriteria = stringArray(payload.acceptanceCriteria, `bad case line ${String(line)} acceptanceCriteria`)
  return {
    badCaseId: badCaseId(payload.id),
    status: payload.status,
    preset: payload.preset,
    retrieval: payload.retrieval,
    capturedAt: payload.capturedAt,
    queryLanguage: payload.queryLanguage,
    query: payload.query,
    verdict: payload.verdict,
    summary: diagnosis.summary,
    failureTypes,
    acceptanceCriteria,
  }
}

/** Read bounded JSONL bad cases without exposing captured prompts, answers, or asset paths. */
async function readBadCases(config: Config): Promise<CustomerServiceBadCase[]> {
  const details = await lstat(config.badCasesPath)
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('customer-service-admin: badCasesPath must be a real file')
  }
  if (details.size > config.limits.maxBadCasesBytes) {
    throw new Error(`customer-service-admin: badCasesPath exceeds ${String(config.limits.maxBadCasesBytes)} bytes`)
  }
  const bytes = await readFile(config.badCasesPath)
  /* v8 ignore next 2 -- requires the ledger inode to grow between lstat and readFile */
  if (bytes.length > config.limits.maxBadCasesBytes) {
    throw new Error(`customer-service-admin: badCasesPath exceeds ${String(config.limits.maxBadCasesBytes)} bytes`)
  }
  const lines = bytes.toString('utf8').split(/\r?\n/u)
  const cases: CustomerServiceBadCase[] = []
  for (const [position, text] of lines.entries()) {
    if (text.trim().length === 0) continue
    if (cases.length >= config.limits.maxBadCases) {
      throw new Error(`customer-service-admin: bad-case count exceeds ${String(config.limits.maxBadCases)}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch (error) {
      throw new Error(`customer-service-admin: bad case line ${String(position + 1)} contains invalid JSON`, { cause: error })
    }
    cases.push(parseBadCase(payload, position + 1))
  }
  return cases
}

/** Count open and closed bad-case records. */
function summarizeBadCases(cases: readonly CustomerServiceBadCase[]): CustomerServiceBadCaseSummary {
  return {
    total: cases.length,
    open: cases.filter(item => item.status === 'open').length,
    closed: cases.filter(item => item.status === 'closed').length,
  }
}

/** Derive one revision from all user-visible staging content. */
function revisionOf(items: readonly CustomerServiceStagedDocument[]): CustomerServiceStagingRevision {
  return stagingRevision(sha256(JSON.stringify(items.map(item => ({
    name: item.name,
    sizeBytes: item.sizeBytes,
    sha256: item.sha256,
  })))))
}

/** Read one real staging directory, or return an empty snapshot before first write. */
async function readStagedDocuments(config: Config): Promise<CustomerServiceStagedDocumentList> {
  await assertRealStagingIsolation(config)
  let rootDetails
  try {
    rootDetails = await lstat(config.stagingDirectory)
  } catch (error) {
    /* v8 ignore else -- only an absent staging directory is an operational state */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const items: readonly CustomerServiceStagedDocument[] = []
      return { revision: revisionOf(items), items }
    }
    /* v8 ignore next -- requires a host permission or I/O fault rather than an absent staging root */
    throw error
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error('customer-service-admin: stagingDirectory must be a real directory')
  }
  const entries = await readdir(config.stagingDirectory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const items: CustomerServiceStagedDocument[] = []
  for (const entry of entries) {
    if (STAGING_TEMP.test(entry.name)) continue
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`customer-service-admin: staged entry must be a real file: ${entry.name}`)
    }
    if (!SUPPORTED_EXTENSION_SET.has(extname(entry.name).toLowerCase())) {
      throw new Error(`customer-service-admin: staged entry uses an unsupported extension: ${entry.name}`)
    }
    if (items.length >= config.limits.maxDocuments) {
      throw new Error(`customer-service-admin: staged document count exceeds ${String(config.limits.maxDocuments)}`)
    }
    const path = resolve(config.stagingDirectory, entry.name)
    const details = await lstat(path)
    /* v8 ignore next 2 -- requires another process to replace an entry after readdir */
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`customer-service-admin: staged entry must remain a real file: ${entry.name}`)
    }
    if (details.size > config.limits.maxStagedDocumentBytes) {
      throw new Error(`customer-service-admin: staged document exceeds its byte limit: ${entry.name}`)
    }
    const bytes = await readFile(path)
    /* v8 ignore next 2 -- requires the staged inode to grow between lstat and readFile */
    if (bytes.length > config.limits.maxStagedDocumentBytes) {
      throw new Error(`customer-service-admin: staged document exceeds its byte limit: ${entry.name}`)
    }
    const hash = sha256(bytes)
    items.push({
      documentId: documentId(sha256(JSON.stringify(['staged', entry.name, hash]))),
      name: entry.name,
      sizeBytes: bytes.length,
      sha256: hash,
      modifiedAt: details.mtime.toISOString(),
    })
  }
  return { revision: revisionOf(items), items }
}

/** Return a business failure without throwing an infrastructure error. */
function rejected(error: CustomerServiceStageTextDocumentError): CustomerServiceStageTextDocumentResult {
  return { ok: false, error }
}

/** Validate a staging request before touching its configured directory. */
function validateStageRequest(
  request: CustomerServiceStageTextDocumentRequest,
  maximum: number,
): Uint8Array | CustomerServiceStageTextDocumentResult {
  const name = request.name
  if (name.trim() !== name || name.length === 0 || name === '.' || name === '..'
    || name.includes('/') || name.includes('\\') || name.includes('\0') || isAbsolute(name)) {
    return rejected({ code: 'invalid-name', name })
  }
  const extension = extname(name).toLowerCase()
  if (!SUPPORTED_EXTENSION_SET.has(extension)) {
    return rejected({ code: 'unsupported-extension', extension, supportedExtensions: SUPPORTED_EXTENSIONS })
  }
  const bytes = Buffer.from(request.content, 'utf8')
  if (bytes.toString('utf8') !== request.content) return rejected({ code: 'invalid-utf8' })
  if (request.content.trim().length === 0) return rejected({ code: 'empty-document' })
  if (bytes.length > maximum) {
    return rejected({ code: 'document-too-large', maxBytes: maximum, actualBytes: bytes.length })
  }
  return bytes
}

/** Prove a closed request union remains exhaustively handled. */
/* v8 ignore next 3 -- CustomerServiceSearchTestRequest is closed and every retrieval tag is handled */
function assertNever(value: never): never {
  throw new Error(`customer-service-admin: unsupported retrieval request ${JSON.stringify(value)}`)
}

/** Host gateway for bounded customer-service operations data and isolated text staging. */
export class CustomerServiceAdminGateway extends TypertRemoteService {
  static Config: s<Config> = Config

  private readonly ragIndex: LocalKnowledgeIndex
  private readonly wikiReader: WikiReader
  private readonly qualityEngine?: QualityEngine
  private stagingTail: Promise<void> = Promise.resolve()

  /**
   * @param ctx - Host context receiving the direct Remote service.
   * @param config - complete deployment paths, retrieval settings, and read limits.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'customerServiceAdmin')
    assertConfig(config)
    this.ragIndex = new LocalKnowledgeIndex(
      config.rag,
      warning => { ctx.logger('customer-service-admin').warn(warning) },
      reference => resolveKnowledgeCredential(ctx, reference),
    )
    this.wikiReader = new WikiReader(config.wiki)
    if (config.quality) {
      const isolated: Config = { rag: config.rag, wiki: config.wiki, badCasesPath: config.badCasesPath,
        limits: config.limits, stagingDirectory: config.quality.directory }
      assertLexicalStagingIsolation(isolated)
      if (pathWithin(resolve(config.stagingDirectory), resolve(config.quality.directory))
        || pathWithin(resolve(config.quality.directory), resolve(config.stagingDirectory))) {
        throw new Error('customer-service-admin: quality directory must not overlap staging')
      }
      const quality = new QualityEngine(ctx, config.quality, () => assertRealStagingIsolation(isolated))
      this.qualityEngine = quality
      ctx.effect(() => () => quality.dispose(), 'customer-service-quality: jobs')
    }
  }

  private quality(): QualityEngine {
    if (!this.qualityEngine) throw new Error('尚未配置會話質檢服務。')
    return this.qualityEngine
  }

  /** Inspect complete recorded evidence without resuming a customer session.
   * @param sessionId - Existing live or persisted session.
   * @returns Bounded immutable-source projection.
   */
  @Remote('inspectConversation')
  inspectConversation(sessionId: SessionId): Promise<QualityInspection> { return this.quality().inspect(sessionId) }

  /** Start an auxiliary evaluation over a pinned snapshot.
   * @param request - Observed fingerprint, optional turn and weights.
   * @returns Persisted job admission.
   */
  @Remote('startQuality')
  startQuality(request: QualityStartRequest): Promise<QualityRun> { return this.quality().start(request) }

  /**
   * Read evaluation and review summaries.
   * @returns Bounded newest-first job rows.
   */
  @Remote('listQuality')
  listQuality(): Promise<QualityRunSummary[]> { return this.quality().list() }

  /**
   * Read one evaluation and its original evidence.
   * @param id - Evaluation identity.
   * @returns Persisted record.
   */
  @Remote('getQuality')
  getQuality(id: QualityRunId): Promise<QualityRun> { return this.quality().get(id) }

  /** Append a human review or valid remediation transition.
   * @param request - Revision, action and required reason.
   * @returns Committed record with incremented revision.
   */
  @Remote('reviewQuality')
  reviewQuality(request: QualityReviewRequest): Promise<QualityRun> { return this.quality().review(request) }

  /** Serialize staging snapshots and commits owned by this gateway instance. */
  private enqueueStaging<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.stagingTail.then(operation)
    this.stagingTail = queued.then(() => undefined, () => undefined)
    return queued
  }

  /**
   * Read fresh RAG, Wiki, and regression status for the overview cards.
   * @returns one point-in-time operational overview without Host paths or endpoint URLs.
   */
  @Remote('overview')
  async overview(): Promise<CustomerServiceAdminOverview> {
    const [rag, wiki, badCases] = await Promise.all([
      readRagSnapshot(this.ragIndex, this.config),
      readWikiSnapshot(this.wikiReader, this.config),
      readBadCases(this.config),
    ])
    return {
      rag: {
        documents: rag.files,
        chunks: rag.chunks,
        config: {
          embeddingModel: this.config.rag.embeddingModel,
          rerankerModel: this.config.rag.rerankerModel,
          rerank: this.config.rag.rerank,
          chunkChars: this.config.rag.chunkChars,
          chunkOverlapChars: this.config.rag.chunkOverlapChars,
          candidateCount: this.config.rag.candidateCount,
          resultCount: this.config.rag.resultCount,
          minimumVectorScore: this.config.rag.minimumVectorScore,
          minimumRerankScore: this.config.rag.minimumRerankScore,
        },
        index: await inspectIndex(this.config, rag),
      },
      wiki: { release: wiki.release },
      badCases: summarizeBadCases(badCases),
    }
  }

  /**
   * Compare approved RAG and raw Wiki documents with their active artifacts.
   * @returns deterministic document rows without absolute Host paths.
   */
  @Remote('listDocuments')
  async listDocuments(): Promise<CustomerServiceDocumentList> {
    const [rag, wiki] = await Promise.all([
      readRagSnapshot(this.ragIndex, this.config),
      readWikiSnapshot(this.wikiReader, this.config),
    ])
    const [ragItems, wikiItems] = await Promise.all([
      ragDocuments(this.config, rag),
      wikiDocuments(this.config, wiki),
    ])
    return { items: [...ragItems, ...wikiItems] }
  }

  /**
   * Read the bounded operator-authored regression ledger.
   * @returns bad cases in JSONL file order with only console-relevant fields.
   */
  @Remote('listBadCases')
  async listBadCases(): Promise<CustomerServiceBadCaseList> {
    return { items: await readBadCases(this.config) }
  }

  /**
   * Run retrieval directly without generating or storing a customer answer.
   * RAG follows LocalKnowledgeIndex semantics and may rebuild its disposable cache.
   * @param request - selected retriever, query, and required Wiki page identity.
   * @returns ranked evidence plus elapsed Host time.
   */
  @Remote('searchTest')
  async searchTest(request: CustomerServiceSearchTestRequest): Promise<CustomerServiceSearchTestResult> {
    switch (request.retrieval) {
      case 'rag':
        return await this.searchRag(request.query)
      case 'llm-wiki':
        return await this.searchWiki(request)
      /* v8 ignore next 2 -- the closed request union is exhausted above */
      default:
        return assertNever(request)
    }
  }

  /** Execute the configured local-knowledge retriever. */
  private async searchRag(query: string): Promise<CustomerServiceRagSearchTestResult> {
    const started = performance.now()
    const result = await this.ragIndex.search(query)
    return {
      retrieval: 'rag',
      status: result.status,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      reranked: result.reranked,
      durationMs: performance.now() - started,
      sources: result.sources.map(source => ({
        evidenceId: ragEvidenceId(source.id),
        relativePath: source.path,
        title: source.title,
        ...(source.section === undefined ? {} : { section: source.section }),
        excerpt: source.excerpt,
        score: source.score,
      })),
    }
  }

  /** Execute evidence lookup against the current immutable Wiki release. */
  private async searchWiki(request: CustomerServiceWikiSearchTestRequest): Promise<CustomerServiceWikiSearchTestResult> {
    const started = performance.now()
    const navigation = await this.wikiReader.navigation()
    if (!navigation.pages.some(page => page.id === request.pageId)) {
      throw new Error(`customer-service-admin: Wiki page ${JSON.stringify(request.pageId)} is not in the current release`)
    }
    const evidence = await this.wikiReader.evidence(navigation.releaseId, request.pageId, request.query)
    return {
      retrieval: 'llm-wiki',
      status: evidence.length === 0 ? 'not-found' : 'found',
      releaseId: wikiReleaseId(navigation.releaseId),
      pageId: request.pageId,
      durationMs: performance.now() - started,
      sources: evidence.map(source => ({
        evidenceId: wikiEvidenceId(source.evidenceId),
        relativePath: source.sourcePath,
        start: source.start,
        end: source.end,
        excerpt: source.excerpt,
        score: source.score,
      })),
    }
  }

  /**
   * Read safely committed text documents from the isolated staging directory.
   * @returns deterministic rows and a content-derived compare-and-set token.
   */
  @Remote('listStagedDocuments')
  listStagedDocuments(): Promise<CustomerServiceStagedDocumentList> {
    return this.enqueueStaging(() => readStagedDocuments(this.config))
  }

  /**
   * Add one new flat UTF-8 text document without replacing any existing path.
   * @param request - filename, complete text, and optional observed staging revision.
   * @returns committed row and revision, or one stable admission failure.
   */
  @Remote('stageTextDocument')
  stageTextDocument(request: CustomerServiceStageTextDocumentRequest): Promise<CustomerServiceStageTextDocumentResult> {
    const validated = validateStageRequest(request, this.config.limits.maxStagedDocumentBytes)
    if (!(validated instanceof Uint8Array)) return Promise.resolve(validated)
    return this.enqueueStaging(async () => {
      const before = await readStagedDocuments(this.config)
      if (request.expectedRevision !== undefined && request.expectedRevision !== before.revision) {
        return rejected({
          code: 'staging-conflict',
          expectedRevision: request.expectedRevision,
          actualRevision: before.revision,
        })
      }
      if (before.items.some(item => item.name === request.name)) {
        return rejected({ code: 'document-exists', name: request.name })
      }
      await mkdir(this.config.stagingDirectory, { recursive: true, mode: 0o700 })
      await assertRealStagingIsolation(this.config)
      const rootDetails = await lstat(this.config.stagingDirectory)
      /* v8 ignore next 2 -- requires another process to replace the root after mkdir and isolation checks */
      if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
        throw new Error('customer-service-admin: stagingDirectory must be a real directory')
      }
      const temporary = resolve(this.config.stagingDirectory, `.dsh-stage-${randomUUID()}.tmp`)
      const target = resolve(this.config.stagingDirectory, request.name)
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(validated)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await link(temporary, target)
      } catch (error) {
        /* v8 ignore next 3 -- requires an external writer racing the serialized no-replace commit */
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return rejected({ code: 'document-exists', name: request.name })
        }
        /* v8 ignore next -- requires a host I/O fault while committing inside the validated staging root */
        throw error
      } finally {
        await unlink(temporary)
      }
      const after = await readStagedDocuments(this.config)
      const document = after.items.find(item => item.name === request.name)
      /* v8 ignore next -- the hard-link commit and serialized snapshot make the new file visible */
      if (document === undefined) throw new Error('customer-service-admin: committed staged document is missing')
      return { ok: true, value: { document, revision: after.revision } }
    })
  }
}

export default CustomerServiceAdminGateway
