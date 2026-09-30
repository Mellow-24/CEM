/** Package-owned invariant companion for the speech Web Consumer. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from './interruption.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-speech-web'

/** Cordis companion plugin name. */
export const name = 'speech-web-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Auxiliary interruption requests retain their exact model-visible input in a rollback-safe audit event. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [unknown, SessionEvent]
    if (event.type === 'speech/interruption-request' && event.ignorable !== true) {
      fail('speech/interruption-request must be ignorable by older session readers')
    }
  }, { global: true })
  ctx.on('llm/stream', (options, next) => {
    if (!options.messages.some(message => message.source.kind === 'plugin' && message.source.plugin === 'speech-web-interruption')) return next()
    const session = options.sessionId === undefined ? undefined : ctx.sessions.get(options.sessionId)
    const event = session?.events.findLast(candidate => candidate.type === 'speech/interruption-request')
    const data = event?.type === 'speech/interruption-request' ? event.data : undefined
    if (data === undefined || data.provider !== options.provider || data.model !== options.model
      || data.system !== options.system || data.maxTokens !== options.maxTokens
      || data.reasoningEffort !== options.reasoningEffort || data.temperature !== options.temperature
      || JSON.stringify(data.messages) !== JSON.stringify(options.messages)) {
      fail('speech interruption model request must match its preceding session audit event')
    }
    return next()
  }, { global: true })
}, { inject: ['sessions', 'llm'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
