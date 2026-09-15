/** Slot-derived quality pages and plain Host callbacks. */
import type { PropsLocale, PropsRuntime, PropsStore, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { QualityInspection, QualityRun, QualityRunId, QualityRunSummary, QualityStartRequest,
  QualityReviewRequest, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { createQualityViewStore } from './quality-view-store.ts'

/** Independent reads and explicit, persisted evaluation/review mutations. */
export interface QualityCallbacks {
  inspectQuality: (id: SessionId) => Promise<QualityInspection>
  startQuality: (request: QualityStartRequest) => Promise<QualityRun>
  listQuality: () => Promise<QualityRunSummary[]>
  getQuality: (id: QualityRunId) => Promise<QualityRun>
  reviewQuality: (request: QualityReviewRequest) => Promise<QualityRun>
}
/** Shared page props with root-scoped viewing state. */
export type QualityPageProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.customerServiceAdmin'>
  & PropsStore<ReturnType<typeof createQualityViewStore>>
  & QualityCallbacks
  & { standalone?: boolean }
/** Only the session detail entry owns the trace rendering region. */
export type QualitySessionsProps = QualityPageProps & PropsRenderSlots<'operations.trace'>
