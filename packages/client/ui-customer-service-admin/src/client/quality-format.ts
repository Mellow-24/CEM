/** Shared operator labels and pure scoring projections. */
import type { QualityDimension, QualityRun } from '@deepseek-ai/dsh-api-remotes/client'

/** Labels follow the versioned six-dimensional evaluation rubric. */
export const QUALITY_LABELS: Record<QualityDimension, string> = {
  intent: '意圖理解與路徑', retrieval: '檢索質量', grounding: '回答準確性與依據', completion: '處理完整性',
  expression: '服務表達與語言', execution: '執行與響應效率',
}
/**
 * Compute weighted aggregate only when every applicable dimension has evidence.
 * @param run - Persisted automatic scores and their pinned weights.
 * @returns Total, evidence coverage, and independent critical-risk flag.
 */
export function qualityTotals(run: QualityRun): { score: number | null; coverage: number; critical: boolean } {
  let earned = 0, possible = 0, covered = 0
  for (const turn of run.result) for (const score of turn.scores) {
    const weight = run.weights[score.dimension]
    if (score.status !== 'not-applicable') possible += weight
    if (score.status === 'scored' && score.score !== null) { earned += weight * score.score; covered += weight }
  }
  return { score: covered && covered === possible ? Math.round(earned / covered) : null,
    coverage: possible ? Math.round(covered / possible * 100) : 0,
    critical: run.result.some(turn => turn.scores.some(score => score.severity === 'critical')) }
}
/** Human-readable task status, independent of inferred service outcome. */
export const QUALITY_STATUS = { running: '評估中', completed: '已完成', failed: '失敗待重試' }
