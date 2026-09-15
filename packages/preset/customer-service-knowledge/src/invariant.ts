/** Package-owned automatic knowledge-retrieval invariants. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { directCustomerQuery } from './index.ts'
import type { CustomerServiceKnowledgeRetrievalEvent } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-customer-service-knowledge'
const EVENT_TYPE = 'customer-service-knowledge/retrieval'
const SOURCE_NAME = 'customer-service-knowledge'

/** Cordis companion plugin name. */
export const name = 'customer-service-knowledge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Whether a record contains exactly the named fields. */
function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(record, key))
}

/** Validate one retrieval event against its open step and model-visible evidence. */
function validateRetrieval(
  history: readonly SessionEvent[],
  event: SessionEvent<typeof EVENT_TYPE>,
  fail: InvariantFailure,
): void {
  const record = event.data as unknown as Record<string, unknown>
  if (!hasExactKeys(record, [
    'turn', 'step', 'query', 'status', 'reason', 'reranked', 'sourceCount', 'durationMs', 'evidence',
  ])) fail(`${EVENT_TYPE} carries invalid fields`)
  if (typeof record.turn !== 'number' || !Number.isSafeInteger(record.turn) || record.turn < 1
    || typeof record.step !== 'number' || !Number.isSafeInteger(record.step) || record.step < 1) {
    fail(`${EVENT_TYPE} turn and step must be positive safe integers`)
  }
  if (typeof record.query !== 'string' || record.query.trim().length === 0
    || typeof record.evidence !== 'string' || record.evidence.length === 0) {
    fail(`${EVENT_TYPE} query and evidence must be non-empty strings`)
  }
  if (record.status !== 'found' && record.status !== 'not-found') {
    fail(`${EVENT_TYPE} carries unknown status ${JSON.stringify(record.status)}`)
  }
  if (record.status === 'found' ? record.reason !== null : (
    record.reason !== 'empty-corpus' && record.reason !== 'insufficient-evidence'
  )) fail(`${EVENT_TYPE} reason does not match status`)
  if (typeof record.reranked !== 'boolean'
    || typeof record.sourceCount !== 'number'
    || !Number.isSafeInteger(record.sourceCount) || record.sourceCount < 0
    || typeof record.durationMs !== 'number'
    || !Number.isSafeInteger(record.durationMs) || record.durationMs < 0) {
    fail(`${EVENT_TYPE} carries invalid retrieval metrics`)
  }
  const data = record as unknown as CustomerServiceKnowledgeRetrievalEvent
  if ((data.status === 'found') !== (data.sourceCount > 0)) {
    fail(`${EVENT_TYPE} sourceCount does not match status`)
  }

  const turnStart = history.findLastIndex(candidate => candidate.type === 'turn/start')
  const stepStart = history.findLastIndex(candidate => candidate.type === 'step/start')
  const turnEnd = history.findLastIndex(candidate => candidate.type === 'turn/end')
  const stepEnd = history.findLastIndex(candidate => candidate.type === 'step/end')
  if (turnStart <= turnEnd || stepStart <= stepEnd) fail(`${EVENT_TYPE} must be appended inside an open step`)
  const openTurn = history[turnStart]
  const openStep = history[stepStart]
  if (openTurn?.type !== 'turn/start' || openStep?.type !== 'step/start'
    || data.turn !== openTurn.data.turn || data.turn !== openStep.data.turn
    || data.step !== openStep.data.step) {
    fail(`${EVENT_TYPE} position does not match the open step`)
  }
  const stepEvents = history.slice(stepStart + 1)
  const messages = stepEvents.flatMap(candidate => candidate.type === 'user/message' ? [candidate.data] : [])
  if (directCustomerQuery(messages) !== data.query) {
    fail(`${EVENT_TYPE} query must match the current direct-user message`)
  }
  const evidence = messages.filter(message => message.source.kind === 'plugin'
    && message.source.plugin === SOURCE_NAME)
  if (evidence.length !== 1
    || evidence[0]?.content.length !== 1
    || evidence[0].content[0]?.type !== 'text'
    || evidence[0].content[0].text !== data.evidence) {
    fail(`${EVENT_TYPE} must match one current model-visible evidence message`)
  }
  if (stepEvents.some(candidate => candidate.type === EVENT_TYPE)) {
    fail(`${EVENT_TYPE} may occur at most once per step`)
  }
  if (stepEvents.some(candidate => candidate.type === 'assistant/chunk'
    || candidate.type === 'assistant/message')) {
    fail(`${EVENT_TYPE} must precede assistant output`)
  }
}

/** Validate package-owned events and ignore the rest of the session vocabulary. */
function validateEvent(
  history: readonly SessionEvent[],
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (event.type === EVENT_TYPE) validateRetrieval(history, event, fail)
}

/** Validate all existing automatic retrieval events in one session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const [index, event] of session.events.entries()) {
    validateEvent(session.events.slice(0, index), event, fail)
  }
}

/** Install replay and pre-commit validation for automatic retrieval events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session.events.slice(0, event.seq), event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the automatic knowledge-retrieval invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
