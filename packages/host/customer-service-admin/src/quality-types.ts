/** Serializable session inspection, evaluation, and operator review records. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identity of one immutable evaluation input and its revisioned result. */
export type QualityRunId = Branded<'CustomerServiceQualityRunId'>
/** The six independently scored service dimensions. */
export type QualityDimension = 'intent' | 'retrieval' | 'grounding' | 'completion' | 'expression' | 'execution'
/** Deployment limits and the auxiliary evaluation route. */
export interface QualityConfig {
  directory: string
  provider: string
  model: string
  timeoutMs: number
  maxEvents: number
  maxInputBytes: number
  maxOutputTokens: number
  maxRecordBytes: number
  maxRuns: number
  maxTurns: number
  slowResponseMs: number
}
/** A business-safe projection of an actual recorded event or paired tool call. */
export interface QualityTraceRecord {
  seq: number
  endSeq: number
  turn: number
  step: number
  kind: 'user' | 'assistant' | 'tool' | 'lifecycle'
  name: string
  input: string
  output: string
  time: number
  durationMs: number | null
  firstTokenMs: number | null
  tokens: number | null
  error: boolean
}
/** A complete, bounded point-in-time projection, never a silently truncated history page. */
export interface QualityInspection {
  sessionId: SessionId
  title: string
  preset: string
  capturedAt: string
  throughSeq: number
  fingerprint: string
  turns: number[]
  /** Turns without a recorded end; inspectable but not eligible for evaluation. */
  unfinishedTurns: number[]
  records: QualityTraceRecord[]
}
/** One dimension's assessment and source event references. */
export interface QualityScore {
  dimension: QualityDimension
  status: 'scored' | 'not-applicable' | 'insufficient-evidence'
  score: number | null
  reason: string
  evidenceSeqs: number[]
  severity: 'none' | 'minor' | 'major' | 'critical'
  suggestion: string
}
/** One turn's inferred intent and six-dimensional assessment. */
export interface QualityTurnResult {
  turn: number
  intent: string
  scores: QualityScore[]
}
/** Human changes are append-only and never replace the automatic assessment. */
export interface QualityReview {
  time: string
  action: 'review' | 'open-issue' | 'resolve-issue' | 'reopen-issue'
  reason: string
  score: number | null
}
/** Persistent job state, pinned evidence, scoring rules, and review history. */
export interface QualityRun {
  id: QualityRunId
  revision: number
  status: 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt: string | null
  provider: string
  model: string
  ruleVersion: string
  weights: Record<QualityDimension, number>
  inspection: QualityInspection
  selectedTurn: number | null
  result: QualityTurnResult[]
  error: string | null
  reviews: QualityReview[]
}
/** The operator-selected snapshot and scoring rule weights. */
export interface QualityStartRequest {
  sessionId: SessionId
  expectedFingerprint: string
  turn?: number
  weights: Record<QualityDimension, number>
}
/** Compare-and-set review mutation targeting one exact evaluation. */
export interface QualityReviewRequest {
  id: QualityRunId
  expectedRevision: number
  action: QualityReview['action']
  reason: string
  score?: number
}
/** Lightweight index row; detailed evidence is loaded only on demand. */
export interface QualityRunSummary {
  id: QualityRunId
  sessionId: SessionId
  title: string
  createdAt: string
  status: QualityRun['status']
  score: number | null
  reviewedScore: number | null
  coverage: number
  critical: boolean
  reviewed: boolean
  issue: 'none' | 'open' | 'resolved'
  intent: string
}
