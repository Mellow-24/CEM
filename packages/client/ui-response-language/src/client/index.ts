/** Browser-side response-language selector plugin. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ResponseLanguagePreference } from '@deepseek-ai/dsh-response-language/client'
import {
  ResponseLanguageSelect,
  type ResponseLanguageSelectInjected,
} from './ResponseLanguageSelect.tsx'
import { en, zh, type ResponseLanguageKey } from './locales.ts'

export type { ResponseLanguageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Composer reply-language selector copy. */
    responseLanguage: ResponseLanguageKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'responseLanguage'

/** Required services: conversation slot registry, Commands Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Register the response-language selector in the composer's right tool row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-response-language: dictionaries')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'response-language',
    order: 0,
    locale: NS,
    inject: (sessionId: SessionId): ResponseLanguageSelectInjected => ({
      select: async (preference: ResponseLanguagePreference) => {
        const result = await ctx.remote.commands.execute(sessionId, `/response-language ${preference}`)
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return 'unknown command: /response-language'
        return null
      },
    }),
  }, ResponseLanguageSelect))
}
