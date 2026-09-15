/** Bounded, reasoning-free projections over the canonical session event log. */
import { createHash } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-customer-service-knowledge'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { QualityConfig, QualityInspection, QualityRun, QualityRunSummary, QualityTraceRecord } from './quality-types.ts'

/**
 * Remove common credential and personal identifier literals from inspection text.
 * @param text - Recorded visible message or serialized tool data.
 * @returns Pattern-redacted text; this is not a complete personal-data classifier.
 */
export function redactQualityText(text: string): string {
  return text.replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [已隱藏]')
    .replace(/\bsk-[\w-]{8,}/gu, '[已隱藏]')
    .replace(/((?:api[_-]?key|password|secret|access[_-]?token|authorization)\s*["']?\s*[:=]\s*["']?)[^\s,}"']+/giu, '$1[已隱藏]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[電郵已隱藏]')
    .replace(/\b(?:\+?853[ -]?)?[68]\d{7}\b/gu, '[電話已隱藏]')
}

function textBlocks(blocks: readonly ContentBlock[]): string {
  return redactQualityText(blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'))
}

/**
 * Project a complete observed log without changing its surface or active agent.
 * @param meta - Canonical session metadata.
 * @param events - Entire observed event snapshot, including historical tool results.
 * @param config - Event and emitted-byte bounds.
 * @returns A fingerprinted, safe inspection; oversized logs fail instead of being truncated.
 */
export function inspectQualityEvents(meta: SessionHeader, events: readonly SessionEvent[], config: QualityConfig): QualityInspection {
  if (events.length > config.maxEvents) throw new Error('會話事件超過評估限制，無法建立完整快照。')
  const records: QualityTraceRecord[] = []
  const calls = new Map<string, QualityTraceRecord>()
  const starts = new Map<string, number>()
  const firstTokens = new Map<string, number>()
  const openTurns = new Set<number>()
  let turn = 0
  let step = 0
  const add = (event: SessionEvent, kind: QualityTraceRecord['kind'], name: string, input = '', output = '') => {
    const record: QualityTraceRecord = { seq: event.seq, endSeq: event.seq, turn, step, kind, name,
      input, output, time: event.time, durationMs: null, firstTokenMs: null, tokens: null, error: false }
    records.push(record)
    return record
  }
  for (const event of events) {
    switch (event.type) {
      case 'turn/start': turn = event.data.turn; step = 0; openTurns.add(turn); break
      case 'step/start':
        turn = event.data.turn; step = event.data.step
        starts.set(`${turn}:${step}`, event.time)
        break
      case 'user/message':
        if (event.data.source.kind === 'user') add(event, 'user', '客戶問題', textBlocks(event.data.content))
        break
      case 'customer-service-knowledge/retrieval': {
        turn = event.data.turn; step = event.data.step
        const record = add(
          event,
          'tool',
          '自動知識檢索',
          redactQualityText(event.data.query),
          redactQualityText(event.data.evidence),
        )
        record.durationMs = event.data.durationMs
        break
      }
      case 'assistant/chunk': {
        const key = `${event.data.turn}:${event.data.step}`
        if ((event.data.chunk.type === 'text-delta' || event.data.chunk.type === 'reasoning-delta') && !firstTokens.has(key)) firstTokens.set(key, event.time)
        break
      }
      case 'assistant/message': {
        turn = event.data.turn; step = event.data.step
        const record = add(event, 'assistant', '模型回答', '', textBlocks(event.data.message.content))
        const key = `${turn}:${step}`
        const start = starts.get(key)
        const first = firstTokens.get(key)
        record.durationMs = start === undefined ? null : Math.max(0, event.time - start)
        record.time = start ?? event.time
        record.firstTokenMs = start === undefined || first === undefined ? null : Math.max(0, first - start)
        record.tokens = event.data.usage?.outputTokens ?? null
        break
      }
      case 'tool/call': {
        turn = event.data.turn; step = event.data.step
        calls.set(event.data.callId, add(event, 'tool', event.data.name, redactQualityText(event.data.arguments)))
        break
      }
      case 'tool/result': {
        const block = event.data.message.content[0]
        const call = calls.get(block.toolCallId)
        if (call) {
          call.output = textBlocks(block.content); call.endSeq = event.seq
          call.error = block.isError === true || event.data.error !== undefined
          call.durationMs = Math.max(0, event.time - call.time)
          calls.delete(block.toolCallId)
        }
        break
      }
      case 'turn/end': {
        turn = event.data.turn; openTurns.delete(turn)
        const record = add(event, 'lifecycle', '回合結束', '', redactQualityText(JSON.stringify(event.data.reason)))
        record.error = event.data.reason.kind !== 'completed'
        break
      }
      default: break // Other plugin events and internal reasoning are outside the operator projection.
    }
  }
  for (const call of calls.values()) { call.error = !openTurns.has(call.turn); call.output = '工具結果未記錄' }
  const title = records.find(record => record.kind === 'user')?.input.slice(0, 80) ?? '沒有客戶訊息'
  const inspection: QualityInspection = { sessionId: meta.id, title, preset: meta.agentPreset ?? '未記錄',
    capturedAt: new Date().toISOString(), throughSeq: events.at(-1)?.seq ?? -1,
    fingerprint: createHash('sha256').update(JSON.stringify(events)).digest('hex'),
    turns: [...new Set(records.filter(record => record.kind === 'user').map(record => record.turn))],
    unfinishedTurns: [...openTurns], records }
  if (Buffer.byteLength(JSON.stringify(inspection)) > config.maxInputBytes) throw new Error('會話文字超過完整評估限制；系統未截斷內容，也未進行評分。')
  return inspection
}

/**
 * Derive list metrics without substituting unavailable scores or hiding critical findings.
 * @param run - Persisted automatic result and human review history.
 * @returns Point-in-time list summary with independent risk and review status.
 */
export function summarizeQualityRun(run: QualityRun): QualityRunSummary {
  let earned = 0, possible = 0, covered = 0
  for (const result of run.result) for (const score of result.scores) {
    const weight = run.weights[score.dimension]
    if (score.status !== 'not-applicable') possible += weight
    if (score.status === 'scored' && score.score !== null) { earned += score.score * weight; covered += weight }
  }
  const reviews = run.reviews.filter(review => review.action === 'review')
  const issue = run.reviews.filter(review => review.action !== 'review').at(-1)
  return { id: run.id, sessionId: run.inspection.sessionId, title: run.inspection.title, createdAt: run.createdAt,
    status: run.status, score: covered > 0 && covered === possible ? Math.round(earned / covered) : null,
    reviewedScore: reviews.at(-1)?.score ?? null, reviewed: reviews.length > 0,
    coverage: possible > 0 ? Math.round(100 * covered / possible) : 0,
    critical: run.result.some(result => result.scores.some(score => score.severity === 'critical')),
    issue: !issue ? 'none' : issue.action === 'resolve-issue' ? 'resolved' : 'open',
    intent: [...new Set(run.result.map(result => result.intent))].join('、') }
}
