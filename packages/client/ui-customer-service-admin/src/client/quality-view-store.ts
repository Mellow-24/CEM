/** Cross-page selection and scoring-rule drafts; evaluation results remain Host-owned. */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { QualityDimension, QualityRunId, SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Create shared navigation and operator rule drafts, not a second conversation store.
 * @returns Root-scoped viewing state; refreshing resets draft weights.
 */
export function createQualityViewStore(): ReturnType<typeof defineQualityViewStore> {
  return defineQualityViewStore()
}

function defineQualityViewStore() {
  return defineStore({
    init: () => ({ selectedSession: null as SessionId | null, selectedRun: null as QualityRunId | null,
      query: '', preset: '', status: '', page: 1, minScore: '',
      weights: { intent: 20, retrieval: 20, grounding: 25, completion: 15, expression: 10, execution: 10 } }),
    actions: {
      select: (draft, sessionId: SessionId | null, runId: QualityRunId | null = null) => {
        draft.selectedSession = sessionId; draft.selectedRun = runId
      },
      filter: (draft, key: 'query' | 'preset' | 'status' | 'minScore', value: string) => { draft[key] = value; draft.page = 1 },
      page: (draft, page: number) => { draft.page = page },
      clear: (draft) => { draft.query = ''; draft.preset = ''; draft.status = ''; draft.minScore = ''; draft.page = 1 },
      weight: (draft, key: QualityDimension, value: number) => { draft.weights[key] = value },
    },
  })
}
