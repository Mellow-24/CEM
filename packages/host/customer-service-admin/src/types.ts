/**
 * Public Remote vocabulary for the Macau customer-service operations console.
 * This module contains types only so browser consumers never import Host code.
 * @module @deepseek-ai/dsh-host-customer-service-admin/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
export type * from './quality-types.ts'

/** Stable identity of one projected knowledge document version. */
export type CustomerServiceDocumentId = Branded<'CustomerServiceDocumentId'>
/** Stable operator-authored identity of one bad case. */
export type CustomerServiceBadCaseId = Branded<'CustomerServiceBadCaseId'>
/** Content-addressed identity of one immutable Wiki release. */
export type CustomerServiceWikiReleaseId = Branded<'CustomerServiceWikiReleaseId'>
/** Stable identity of one page inside a Wiki release. */
export type CustomerServiceWikiPageId = Branded<'CustomerServiceWikiPageId'>
/** Stable content-derived identity of one RAG fragment. */
export type CustomerServiceRagEvidenceId = Branded<'CustomerServiceRagEvidenceId'>
/** Stable content-derived identity of one Wiki evidence span. */
export type CustomerServiceWikiEvidenceId = Branded<'CustomerServiceWikiEvidenceId'>
/** Equality-only token for one complete staging-directory snapshot. */
export type CustomerServiceStagingRevision = Branded<'CustomerServiceStagingRevision'>

/** Retrieval implementation managed by the console. */
export type CustomerServiceRetrieval = 'rag' | 'llm-wiki'

/** Deployment-owned RAG settings safe to show in an operations console. */
export interface CustomerServiceRagConfig {
  readonly embeddingModel: string
  readonly rerankerModel: string
  readonly rerank: boolean
  readonly chunkChars: number
  readonly chunkOverlapChars: number
  readonly candidateCount: number
  readonly resultCount: number
  readonly minimumVectorScore: number
  readonly minimumRerankScore: number
}

/** Point-in-time metadata for the disposable RAG vector cache. */
export interface CustomerServiceRagIndexStatus {
  readonly state: 'missing' | 'present' | 'invalid'
  readonly sizeBytes?: number
  readonly modifiedAt?: string
  readonly formatVersion?: number
  readonly indexedChunks?: number
  readonly vectorDimension?: number
  readonly embeddingModel?: string
  readonly matchesConfiguredIdentity?: boolean
}

/** One page projected from the current immutable Wiki release. */
export interface CustomerServiceWikiPage {
  readonly pageId: CustomerServiceWikiPageId
  readonly kind: 'source' | 'topic'
  readonly title: string
  readonly language: string
}

/** Current immutable Wiki publication summary. */
export interface CustomerServiceWikiRelease {
  readonly releaseId: CustomerServiceWikiReleaseId
  readonly policyHash: string
  readonly pages: readonly CustomerServiceWikiPage[]
  readonly sourceArtifacts: number
}

/** Counts used by the console overview cards. */
export interface CustomerServiceBadCaseSummary {
  readonly total: number
  readonly open: number
  readonly closed: number
}

/** Complete point-in-time operations overview. */
export interface CustomerServiceAdminOverview {
  readonly rag: {
    readonly documents: number
    readonly chunks: number
    readonly config: CustomerServiceRagConfig
    readonly index: CustomerServiceRagIndexStatus
  }
  readonly wiki: {
    readonly release: CustomerServiceWikiRelease
  }
  readonly badCases: CustomerServiceBadCaseSummary
}

/** One source document and its relation to the active retrieval artifact. */
export interface CustomerServiceDocument {
  readonly documentId: CustomerServiceDocumentId
  readonly retrieval: CustomerServiceRetrieval
  readonly relativePath: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly state: 'approved' | 'published' | 'changed' | 'unpublished'
}

/** Current RAG and Wiki source-document projection. */
export interface CustomerServiceDocumentList {
  readonly items: readonly CustomerServiceDocument[]
}

/** One operator-recorded failed or resolved regression case. */
export interface CustomerServiceBadCase {
  readonly badCaseId: CustomerServiceBadCaseId
  readonly status: 'open' | 'closed'
  readonly preset: string
  readonly retrieval: CustomerServiceRetrieval
  /** ISO calendar date or UTC timestamp recorded by the evaluator. */
  readonly capturedAt: string
  readonly queryLanguage: string
  readonly query: string
  readonly verdict: 'pass' | 'fail'
  readonly summary: string
  readonly failureTypes: readonly string[]
  readonly acceptanceCriteria: readonly string[]
}

/** Current bad-case records in file order. */
export interface CustomerServiceBadCaseList {
  readonly items: readonly CustomerServiceBadCase[]
}

/** Execute the configured RAG retriever with no answer generation. */
export interface CustomerServiceRagSearchTestRequest {
  readonly retrieval: 'rag'
  readonly query: string
}

/** Execute Wiki evidence lookup on one page in the current release. */
export interface CustomerServiceWikiSearchTestRequest {
  readonly retrieval: 'llm-wiki'
  readonly query: string
  readonly pageId: CustomerServiceWikiPageId
}

/** Supported retrieval-console test request. */
export type CustomerServiceSearchTestRequest =
  | CustomerServiceRagSearchTestRequest
  | CustomerServiceWikiSearchTestRequest

/** One evidence fragment returned by the RAG test. */
export interface CustomerServiceRagSearchEvidence {
  readonly evidenceId: CustomerServiceRagEvidenceId
  readonly relativePath: string
  readonly title: string
  readonly section?: string
  readonly excerpt: string
  readonly score: number
}

/** Direct RAG retrieval outcome with no generated customer answer. */
export interface CustomerServiceRagSearchTestResult {
  readonly retrieval: 'rag'
  readonly status: 'found' | 'not-found'
  readonly reason?: 'empty-corpus' | 'insufficient-evidence'
  readonly reranked: boolean
  readonly durationMs: number
  readonly sources: readonly CustomerServiceRagSearchEvidence[]
}

/** One evidence span returned by the Wiki test. */
export interface CustomerServiceWikiSearchEvidence {
  readonly evidenceId: CustomerServiceWikiEvidenceId
  readonly relativePath: string
  readonly start: number
  readonly end: number
  readonly excerpt: string
  readonly score: number
}

/** Direct Wiki evidence outcome pinned to the current release. */
export interface CustomerServiceWikiSearchTestResult {
  readonly retrieval: 'llm-wiki'
  readonly status: 'found' | 'not-found'
  readonly releaseId: CustomerServiceWikiReleaseId
  readonly pageId: CustomerServiceWikiPageId
  readonly durationMs: number
  readonly sources: readonly CustomerServiceWikiSearchEvidence[]
}

/** Retrieval-console test result selected by the request's retrieval tag. */
export type CustomerServiceSearchTestResult =
  | CustomerServiceRagSearchTestResult
  | CustomerServiceWikiSearchTestResult

/** One safely staged text document. */
export interface CustomerServiceStagedDocument {
  readonly documentId: CustomerServiceDocumentId
  readonly name: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly modifiedAt: string
}

/** Complete visible staging snapshot and its compare-and-set token. */
export interface CustomerServiceStagedDocumentList {
  readonly revision: CustomerServiceStagingRevision
  readonly items: readonly CustomerServiceStagedDocument[]
}

/** Request to add one new flat text file to the isolated staging directory. */
export interface CustomerServiceStageTextDocumentRequest {
  readonly name: string
  readonly content: string
  readonly expectedRevision?: CustomerServiceStagingRevision
}

/** Invalid staging filename. */
export interface CustomerServiceStageInvalidName {
  readonly code: 'invalid-name'
  readonly name: string
}

/** Filename extension outside the supported text-source set. */
export interface CustomerServiceStageUnsupportedExtension {
  readonly code: 'unsupported-extension'
  readonly extension: string
  readonly supportedExtensions: readonly string[]
}

/** JavaScript string that cannot round-trip through UTF-8. */
export interface CustomerServiceStageInvalidUtf8 {
  readonly code: 'invalid-utf8'
}

/** Text containing no non-whitespace content. */
export interface CustomerServiceStageEmptyDocument {
  readonly code: 'empty-document'
}

/** Text larger than the deployment-owned staging limit. */
export interface CustomerServiceStageDocumentTooLarge {
  readonly code: 'document-too-large'
  readonly maxBytes: number
  readonly actualBytes: number
}

/** Staging already contains the requested filename. */
export interface CustomerServiceStageDocumentExists {
  readonly code: 'document-exists'
  readonly name: string
}

/** Compare-and-set rejection after the caller observed another snapshot. */
export interface CustomerServiceStageConflict {
  readonly code: 'staging-conflict'
  readonly expectedRevision: CustomerServiceStagingRevision
  readonly actualRevision: CustomerServiceStagingRevision
}

/** Stable business failures returned by staging admission. */
export type CustomerServiceStageTextDocumentError =
  | CustomerServiceStageInvalidName
  | CustomerServiceStageUnsupportedExtension
  | CustomerServiceStageInvalidUtf8
  | CustomerServiceStageEmptyDocument
  | CustomerServiceStageDocumentTooLarge
  | CustomerServiceStageDocumentExists
  | CustomerServiceStageConflict

/** Successful staging commit. */
export interface CustomerServiceStageTextDocumentValue {
  readonly document: CustomerServiceStagedDocument
  readonly revision: CustomerServiceStagingRevision
}

/** Result of adding one document without overwriting an existing file. */
export type CustomerServiceStageTextDocumentResult =
  | { readonly ok: true; readonly value: CustomerServiceStageTextDocumentValue }
  | { readonly ok: false; readonly error: CustomerServiceStageTextDocumentError }
