import type { SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AdminBadCaseList,
  AdminDocumentList,
  AdminOverview,
  AdminSearchTestResult,
  AdminStagedDocumentList,
} from '../src/client/contracts.ts'

export const OVERVIEW: AdminOverview = {
  rag: {
    documents: 12,
    chunks: 248,
    config: {
      embeddingModel: 'deepseek-embedding',
      rerankerModel: 'deepseek-reranker',
      rerank: true,
      chunkChars: 1200,
      chunkOverlapChars: 160,
      candidateCount: 12,
      resultCount: 4,
      minimumVectorScore: 0.35,
      minimumRerankScore: 0.55,
    },
    index: {
      state: 'present',
      indexedChunks: 248,
      vectorDimension: 1024,
      matchesConfiguredIdentity: true,
    },
  },
  wiki: {
    release: {
      releaseId: 'release-2026-09' as never,
      policyHash: 'policy-abc',
      sourceArtifacts: 8,
      pages: [
        { pageId: 'billing' as never, kind: 'topic', title: '賬單與繳費', language: 'zh-CN' },
        { pageId: 'contracts' as never, kind: 'source', title: '合約服務', language: 'zh-CN' },
      ],
    },
  },
  badCases: { total: 5, open: 2, closed: 3 },
}

export const DOCUMENTS: AdminDocumentList = {
  items: [
    {
      documentId: 'rag-faq' as never,
      retrieval: 'rag',
      relativePath: 'approved/customer-faq.md',
      sizeBytes: 2048,
      sha256: '0123456789abcdef0123456789abcdef',
      state: 'approved',
    },
    {
      documentId: 'wiki-billing' as never,
      retrieval: 'llm-wiki',
      relativePath: 'wiki/billing.md',
      sizeBytes: 1024,
      sha256: 'fedcba9876543210fedcba9876543210',
      state: 'changed',
    },
  ],
}

export const STAGED: AdminStagedDocumentList = {
  revision: 'staging-r1' as never,
  items: [{
    documentId: 'staged-price' as never,
    name: 'price-update.md',
    sizeBytes: 900,
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    modifiedAt: '2026-09-04T08:00:00.000Z',
  }],
}

export const BAD_CASES: AdminBadCaseList = {
  items: [
    {
      badCaseId: 'case-open' as never,
      status: 'open',
      preset: 'macau-customer-service',
      retrieval: 'rag',
      capturedAt: '2026-09-04T08:00:00.000Z',
      queryLanguage: 'zh-CN',
      query: '如何更改合約戶名？',
      verdict: 'fail',
      summary: '回答未覆蓋所需證明文件。',
      failureTypes: ['missing-evidence'],
      acceptanceCriteria: ['列出必需文件', '引用有效來源'],
    },
    {
      badCaseId: 'case-closed' as never,
      status: 'closed',
      preset: 'macau-customer-service-wiki',
      retrieval: 'llm-wiki',
      capturedAt: '2026-09-03T08:00:00.000Z',
      queryLanguage: 'pt',
      query: 'Como pagar a conta?',
      verdict: 'pass',
      summary: '已通過發佈版知識驗證。',
      failureTypes: [],
      acceptanceCriteria: ['返回繳費渠道'],
    },
  ],
}

export const RAG_SEARCH: AdminSearchTestResult = {
  retrieval: 'rag',
  status: 'found',
  reranked: true,
  durationMs: 42,
  sources: [{
    evidenceId: 'rag-evidence' as never,
    relativePath: 'approved/customer-faq.md',
    title: '客戶服務指南',
    section: '合約資料',
    excerpt: '申請人需提交身份證明及最新賬單。',
    score: 0.92,
  }],
}

export const WIKI_SEARCH: AdminSearchTestResult = {
  retrieval: 'llm-wiki',
  status: 'found',
  releaseId: 'release-2026-09' as never,
  pageId: 'billing' as never,
  durationMs: 18,
  sources: [{
    evidenceId: 'wiki-evidence' as never,
    relativePath: 'wiki/billing.md',
    start: 18,
    end: 86,
    excerpt: '可使用線上銀行或自助終端繳費。',
    score: 1,
  }],
}

export const SESSIONS: readonly SessionSummary[] = [
  {
    id: 'session-running' as never,
    displayTitle: '更改合約戶名',
    updatedAt: Date.UTC(2026, 8, 4, 8),
    running: true,
    blank: false,
    cwd: '/srv/macau/customer-a',
    agentPreset: 'macau-customer-service',
  },
  {
    id: 'session-blank' as never,
    displayTitle: 'New Session',
    updatedAt: Date.UTC(2026, 8, 3, 8),
    running: false,
    blank: true,
    agentPreset: 'macau-customer-service-wiki',
  },
  {
    id: 'session-complete' as never,
    displayTitle: '線上繳費方式',
    updatedAt: Date.UTC(2026, 8, 2, 8),
    running: false,
    blank: false,
    agentPreset: 'macau-customer-service-wiki',
  },
  {
    id: 'session-subagent' as never,
    displayTitle: '內部資料整理',
    updatedAt: Date.UTC(2026, 8, 1, 8),
    running: false,
    blank: false,
    origin: 'subagent',
  },
  {
    id: 'session-no-preset' as never,
    displayTitle: '停電信息查詢',
    updatedAt: Date.UTC(2026, 7, 31, 8),
    running: false,
    blank: false,
  },
]
