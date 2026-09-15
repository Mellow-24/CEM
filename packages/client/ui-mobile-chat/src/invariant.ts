/** Package-owned invariant companion for the isolated mobile presentation. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'client-ui-mobile-chat-invariant'
export const inject = ['invariants']
/** No runtime invariant: this plugin owns transient presentation, not durable state. */
const install: InvariantInstaller = () => {}
/** Register the package without claiming ownership of shared Session events. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-client-ui-mobile-chat', install))
