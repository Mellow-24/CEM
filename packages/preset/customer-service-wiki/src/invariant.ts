/**
 * Package-owned invariant companion for @deepseek-ai/dsh-customer-service-wiki.
 * @module @deepseek-ai/dsh-customer-service-wiki/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-customer-service-wiki'

/** Cordis companion plugin name. */
export const name = 'customer-service-wiki-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the customer tools own no durable event stream, and the immutable release
 * manifest plus source-span hashes are validated synchronously by each read operation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package invariant companion.
 * @param ctx - context carrying the invariant registry.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
