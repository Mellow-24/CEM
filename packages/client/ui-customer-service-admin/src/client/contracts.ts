/** Types shared by the four customer-service Settings contributions. */

import type {
  CustomerServiceAdminOverview,
  CustomerServiceBadCaseList,
  CustomerServiceDocumentList,
  CustomerServiceSearchTestRequest,
  CustomerServiceSearchTestResult,
  CustomerServiceStageTextDocumentRequest,
  CustomerServiceStageTextDocumentResult,
  CustomerServiceStagedDocumentList,
  SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Snapshot shown by the operations overview. */
export type AdminOverview = CustomerServiceAdminOverview
/** Active knowledge-document catalog. */
export type AdminDocumentList = CustomerServiceDocumentList
/** Independent upload-staging catalog. */
export type AdminStagedDocumentList = CustomerServiceStagedDocumentList
/** Domain result of one safe staging write. */
export type AdminStageDocumentResult = CustomerServiceStageTextDocumentResult
/** Request accepted by the safe staging write. */
export type AdminStageDocumentRequest = CustomerServiceStageTextDocumentRequest
/** Recorded customer-service evaluation cases. */
export type AdminBadCaseList = CustomerServiceBadCaseList
/** Request accepted by the real retrieval test bench. */
export type AdminSearchTestRequest = CustomerServiceSearchTestRequest
/** Result returned by the real retrieval test bench. */
export type AdminSearchTestResult = CustomerServiceSearchTestResult

/** Stable page identity carried by each Settings registration. */
export type AdminPage = 'overview' | 'knowledge' | 'sessions' | 'evaluation'

/** Plain callbacks injected from the plugin apply closure. */
export interface CustomerServiceAdminInjected {
  /** Read current knowledge, index, release, and evaluation totals. */
  overview: () => Promise<AdminOverview>
  /** Read active RAG and Wiki source documents. */
  listDocuments: () => Promise<AdminDocumentList>
  /** Read documents in the independent upload-staging directory. */
  listStagedDocuments: () => Promise<AdminStagedDocumentList>
  /** Place one UTF-8 text document in safe staging without overwriting live knowledge. */
  stageTextDocument: (request: AdminStageDocumentRequest) => Promise<AdminStageDocumentResult>
  /** Read recorded evaluation cases. */
  listBadCases: () => Promise<AdminBadCaseList>
  /** Run one retrieval-only test against current configuration. */
  searchTest: (request: AdminSearchTestRequest) => Promise<AdminSearchTestResult>
  /** Select one known session in the conversation UI. */
  openSession: (sessionId: SessionId) => void
}
