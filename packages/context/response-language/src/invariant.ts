/** Package-owned durable response-language invariants. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import {
  FIXED_RESPONSE_LANGUAGES,
  RESPONSE_LANGUAGE_PREFERENCES,
} from './index.ts'
import type { ResponseLanguageResolvedEvent, ResponseLanguageRetryEvent } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-response-language'
const RESOLUTION_BASES = ['fixed', 'detected', 'carried', 'fallback'] as const

/** Cordis companion plugin name. */
export const name = 'response-language-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Whether a record has exactly the required keys plus allowed optional keys. */
function hasExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(record)
  return required.every(key => Object.hasOwn(record, key))
    && keys.every(key => required.includes(key) || optional.includes(key))
}

/** Position where a pre-step resolution may append. */
function proposedPosition(
  history: readonly SessionEvent[],
  fail: InvariantFailure,
): { turn: number; step: number } {
  let openTurn: number | undefined
  let lastStep = 0
  let stepOpen = false
  for (const event of history) {
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        lastStep = 0
        stepOpen = false
        break
      case 'step/start':
        lastStep = event.data.step
        stepOpen = true
        break
      case 'step/end':
        stepOpen = false
        break
      case 'turn/end':
        openTurn = undefined
        lastStep = 0
        stepOpen = false
        break
      default:
        break
    }
  }
  if (openTurn === undefined) fail('response-language/resolved must be appended inside an open turn')
  if (stepOpen) fail('response-language/resolved must precede step/start')
  return { turn: openTurn, step: lastStep + 1 }
}

/** Validate one preference payload. */
function validatePreference(event: SessionEvent<'response-language/preference'>, fail: InvariantFailure): void {
  const data = event.data as unknown as Record<string, unknown>
  if (!hasExactKeys(data, ['value'])) {
    fail('response-language/preference must carry only value')
  }
  if (!(RESPONSE_LANGUAGE_PREFERENCES as readonly unknown[]).includes(data.value)) {
    fail(`response-language/preference carries unknown value ${JSON.stringify(data.value)}`)
  }
}

/** Validate payload fields and their fixed/automatic relationship. */
function validateResolutionData(data: ResponseLanguageResolvedEvent, fail: InvariantFailure): void {
  const record = data as unknown as Record<string, unknown>
  if (!hasExactKeys(
    record,
    ['turn', 'step', 'preference', 'language', 'basis'],
    ['messageId', 'confidence'],
  )) {
    fail('response-language/resolved carries invalid fields')
  }
  if (!Number.isSafeInteger(data.turn) || data.turn < 1
    || !Number.isSafeInteger(data.step) || data.step < 1) {
    fail('response-language/resolved turn and step must be positive safe integers')
  }
  if (!(RESPONSE_LANGUAGE_PREFERENCES as readonly unknown[]).includes(data.preference)) {
    fail(`response-language/resolved carries unknown preference ${JSON.stringify(data.preference)}`)
  }
  if (!(FIXED_RESPONSE_LANGUAGES as readonly unknown[]).includes(data.language)) {
    fail(`response-language/resolved carries unknown language ${JSON.stringify(data.language)}`)
  }
  if (!(RESOLUTION_BASES as readonly unknown[]).includes(data.basis)) {
    fail(`response-language/resolved carries unknown basis ${JSON.stringify(data.basis)}`)
  }
  if (data.messageId !== undefined && (typeof data.messageId !== 'string' || data.messageId === '')) {
    fail('response-language/resolved messageId must be a non-empty string when present')
  }
  if (data.preference !== 'auto') {
    if (data.basis !== 'fixed' || data.language !== data.preference) {
      fail('fixed response-language preference must resolve to itself with basis "fixed"')
    }
    if (data.messageId !== undefined || data.confidence !== undefined) {
      fail('fixed response-language resolution cannot carry detection fields')
    }
    return
  }
  if (data.basis === 'fixed') {
    fail('automatic response-language preference cannot use basis "fixed"')
  }
  if (data.basis === 'detected') {
    if (data.messageId === undefined) {
      fail('detected response-language resolution requires messageId')
    }
    if (typeof data.confidence !== 'number'
      || !Number.isFinite(data.confidence)
      || data.confidence <= 0
      || data.confidence > 1) {
      fail('detected response-language resolution requires confidence in (0, 1]')
    }
    return
  }
  if (data.confidence !== undefined) {
    fail('carried or fallback response-language resolution cannot carry confidence')
  }
}

/** Validate one resolution payload against its session position. */
function validateResolution(
  history: readonly SessionEvent[],
  event: SessionEvent<'response-language/resolved'>,
  fail: InvariantFailure,
): void {
  validateResolutionData(event.data, fail)
  const expected = proposedPosition(history, fail)
  if (event.data.turn !== expected.turn || event.data.step !== expected.step) {
    fail(`response-language/resolved names turn ${String(event.data.turn)}/step ${String(event.data.step)}, expected ${String(expected.turn)}/${String(expected.step)}`)
  }
}

/** Position where a completed reply may request a correction retry. */
function activeStepPosition(
  history: readonly SessionEvent[],
  fail: InvariantFailure,
): { turn: number; step: number } {
  let openTurn: number | undefined
  let openStep: number | undefined
  for (const event of history) {
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        openStep = undefined
        break
      case 'step/start':
        openStep = event.data.step
        break
      case 'step/end':
        openStep = undefined
        break
      case 'turn/end':
        openTurn = undefined
        openStep = undefined
        break
      default:
        break
    }
  }
  if (openTurn === undefined || openStep === undefined) {
    fail('response-language/retry must be appended inside an open step')
  }
  return { turn: openTurn, step: openStep }
}

/** Whether a Cantonese target shares the available local detector result with a regional or standard Traditional Chinese reply. */
function languagesMatch(expected: string, observed: string): boolean {
  return expected === observed
    || (expected.startsWith('yue-Hant-')
      && (observed.startsWith('yue-Hant-') || observed === 'zh-Hant'))
}

/** Validate one output-language correction record against its open step. */
function validateRetry(
  history: readonly SessionEvent[],
  event: SessionEvent<'response-language/retry'>,
  fail: InvariantFailure,
): void {
  const data = event.data as ResponseLanguageRetryEvent
  const record = data as unknown as Record<string, unknown>
  if (!hasExactKeys(record, ['turn', 'step', 'expected', 'observed'])) {
    fail('response-language/retry carries invalid fields')
  }
  if (!Number.isSafeInteger(data.turn) || data.turn < 1
    || !Number.isSafeInteger(data.step) || data.step < 1) {
    fail('response-language/retry turn and step must be positive safe integers')
  }
  if (!(FIXED_RESPONSE_LANGUAGES as readonly unknown[]).includes(data.expected)
    || !(FIXED_RESPONSE_LANGUAGES as readonly unknown[]).includes(data.observed)) {
    fail('response-language/retry carries an unknown language')
  }
  if (languagesMatch(data.expected, data.observed)) {
    fail('response-language/retry expected and observed languages must differ')
  }
  const position = activeStepPosition(history, fail)
  if (data.turn !== position.turn || data.step !== position.step) {
    fail(`response-language/retry names turn ${String(data.turn)}/step ${String(data.step)}, expected ${String(position.turn)}/${String(position.step)}`)
  }
  const resolution = history.findLast(candidate => candidate.type === 'response-language/resolved'
    && candidate.data.turn === data.turn
    && candidate.data.step === data.step)
  if (resolution?.type !== 'response-language/resolved' || resolution.data.language !== data.expected) {
    fail('response-language/retry must match a preceding response-language/resolved event')
  }
  if (history.some(candidate => candidate.type === 'response-language/retry'
    && candidate.data.turn === data.turn
    && candidate.data.step === data.step)) {
    fail('response-language/retry may occur at most once per step')
  }
  if (history.some(candidate => (candidate.type === 'assistant/chunk' || candidate.type === 'assistant/message')
    && candidate.data.turn === data.turn
    && candidate.data.step === data.step)) {
    fail('response-language/retry must precede committed assistant output')
  }
}

/** Validate one package-owned event and ignore every other event type. */
function validateEvent(
  history: readonly SessionEvent[],
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (event.type === 'response-language/preference') {
    validatePreference(event, fail)
  } else if (event.type === 'response-language/resolved') {
    validateResolution(history, event, fail)
  } else if (event.type === 'response-language/retry') {
    validateRetry(history, event, fail)
  }
}

/** Validate all package-owned events already present in one session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const [index, event] of session.events.entries()) {
    validateEvent(session.events.slice(0, index), event, fail)
  }
}

/** Install validation for loaded and newly appended response-language events. */
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
 * Register the response-language invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
