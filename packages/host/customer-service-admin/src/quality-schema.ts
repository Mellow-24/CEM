/** Validation of model output, durable evaluation files, and operator mutations. */
import { z } from 'zod'

/** Closed dimension set shared by parsing, prompting, and weight validation. */
export const qualityDimensions = ['intent', 'retrieval', 'grounding', 'completion', 'expression', 'execution'] as const
const dimension = z.enum(qualityDimensions)
const seq = z.number().int().nonnegative()
const scoreNumber = z.number().min(0).max(100)
/** Operator-controlled weights; all six entries are mandatory and total 100. */
export const qualityWeightsSchema = z.object({ intent: scoreNumber, retrieval: scoreNumber, grounding: scoreNumber,
  completion: scoreNumber, expression: scoreNumber, execution: scoreNumber }).strict()
  .refine(weights => Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 100) < 0.001, '各維度權重總和必須為 100')
const score = z.object({ dimension, status: z.enum(['scored', 'not-applicable', 'insufficient-evidence']),
  score: scoreNumber.nullable(), reason: z.string().trim().min(1).max(2000), evidenceSeqs: z.array(seq).max(40),
  severity: z.enum(['none', 'minor', 'major', 'critical']), suggestion: z.string().max(2000) }).strict()
  .refine(value => value.status === 'scored' ? value.score !== null && value.evidenceSeqs.length > 0 : value.score === null,
    '已評分項目必須包含分數與證據；不可評估項目不得包含分數')
const turnResult = z.object({ turn: seq, intent: z.string().trim().min(1).max(120), scores: z.array(score).length(6) }).strict()
  .refine(value => new Set(value.scores.map(item => item.dimension)).size === 6, '六個評估維度不得重複')
/** Strict model response parser; event membership is checked against the pinned snapshot separately. */
export const qualityResultSchema = z.object({ turns: z.array(turnResult).min(1) }).strict()
/** Durable human review payload. The label does not assert an authenticated identity. */
export const qualityReviewSchema = z.object({ time: z.iso.datetime(), action: z.enum(['review', 'open-issue', 'resolve-issue', 'reopen-issue']),
  reason: z.string().trim().min(1).max(2000), score: scoreNumber.nullable() }).strict()
/** Public deployment configuration has no hidden tunables. */
export const qualityConfigSchema = z.object({ directory: z.string().min(1), provider: z.string().min(1), model: z.string().min(1),
  timeoutMs: z.number().int().positive().max(2147483647), maxEvents: z.number().int().positive(),
  maxInputBytes: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
  maxRecordBytes: z.number().int().positive(), maxRuns: z.number().int().positive(),
  maxTurns: z.number().int().positive(), slowResponseMs: z.number().int().positive() }).strict()
const record = z.object({ seq, endSeq: seq, turn: seq, step: seq, kind: z.enum(['user', 'assistant', 'tool', 'lifecycle']),
  name: z.string(), input: z.string(), output: z.string(), time: z.number(), durationMs: z.number().nonnegative().nullable(),
  firstTokenMs: z.number().nonnegative().nullable(), tokens: z.number().nonnegative().nullable(), error: z.boolean() }).strict()
/** Validate each persisted record before using it for summaries, evidence, or review. */
export const qualityRunSchema = z.object({ id: z.uuid(), revision: seq, status: z.enum(['running', 'completed', 'failed']),
  createdAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(), provider: z.string(), model: z.string(), ruleVersion: z.string(),
  weights: qualityWeightsSchema, inspection: z.object({ sessionId: z.string().min(1), title: z.string(), preset: z.string(),
    capturedAt: z.iso.datetime(), throughSeq: z.number().int(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    turns: z.array(seq), unfinishedTurns: z.array(seq), records: z.array(record) }).strict(), selectedTurn: seq.nullable(),
  result: z.array(turnResult), error: z.string().nullable(), reviews: z.array(qualityReviewSchema) }).strict()
