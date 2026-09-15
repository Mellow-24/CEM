/** Macau customer-service operations pages registered into Web Settings. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CustomerServiceAdminInjected } from './contracts.ts'
import { OperationsSection } from './OperationsSection.tsx'
import { createRehearsalStore } from './demo-store.ts'
import { CUSTOMER_ADMIN_PAGES, OPERATION_PAGES } from './demo-data.ts'
import { conversationReadout } from './readout.ts'
import { en, pt, zh, type CustomerServiceAdminLocaleKey } from './locales.ts'
import { QualitySessionsPage, QualityQueuePage } from './QualityPages.tsx'
import { createQualityViewStore } from './quality-view-store.ts'
import type { QualityCallbacks } from './quality-contract.ts'
import { operationsText } from './operations-copy.ts'
import { CustomerAdminPortal } from './CustomerAdminPortal.tsx'
import { PortalQualitySessionsPage } from './PortalQualitySessionsPage.tsx'
import type {} from './customer-admin-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Customer-service operations console copy. */
    'settings.customerServiceAdmin': CustomerServiceAdminLocaleKey
  }
}

const NS = 'settings.customerServiceAdmin'

/** Browser path that activates the standalone CEM operations portal. */
export const CUSTOMER_ADMIN_PATH = '/customer-admin'

/**
 * Whether a pathname addresses the standalone operations portal.
 * @param pathname - Browser pathname without the origin, query, or fragment.
 * @returns True for the dedicated administration route and its trailing-slash form.
 */
export function isCustomerAdminPath(pathname: string): boolean {
  return pathname === CUSTOMER_ADMIN_PATH || pathname === `${CUSTOMER_ADMIN_PATH}/`
}

/** Services required by the operations pages and real-history reader. */
export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.customerServiceAdmin',
  'sessions',
  'connection',
]

interface OperationFailure {
  readonly code: string
  readonly message: string
}

type OperationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: OperationFailure }

function valueOrThrow<Value>(operation: string, result: OperationResult<Value>): Value {
  if (!result.ok) {
    throw new Error(`${operation} failed: ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

/** Register the focused standalone portal and the complete legacy Settings console. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, pt }), 'ui-customer-service-admin: dictionaries')

  const callbacks: CustomerServiceAdminInjected = {
    overview: async () => valueOrThrow(
      'customerServiceAdmin.overview',
      await ctx.remote.customerServiceAdmin.overview(),
    ),
    listDocuments: async () => valueOrThrow(
      'customerServiceAdmin.listDocuments',
      await ctx.remote.customerServiceAdmin.listDocuments(),
    ),
    listStagedDocuments: async () => valueOrThrow(
      'customerServiceAdmin.listStagedDocuments',
      await ctx.remote.customerServiceAdmin.listStagedDocuments(),
    ),
    stageTextDocument: async request => valueOrThrow(
      'customerServiceAdmin.stageTextDocument',
      await ctx.remote.customerServiceAdmin.stageTextDocument(request),
    ),
    listBadCases: async () => valueOrThrow(
      'customerServiceAdmin.listBadCases',
      await ctx.remote.customerServiceAdmin.listBadCases(),
    ),
    searchTest: async request => valueOrThrow(
      'customerServiceAdmin.searchTest',
      await ctx.remote.customerServiceAdmin.searchTest(request),
    ),
    openSession: (sessionId) => { ctx.sessions.open(sessionId) },
  }
  const t = ctx.locale.bind(NS)
  const rehearsal = createRehearsalStore()
  const qualityView = createQualityViewStore()
  const qualityCallbacks: QualityCallbacks = {
    inspectQuality: async id => valueOrThrow('inspectConversation', await ctx.remote.customerServiceAdmin.inspectConversation(id)),
    startQuality: async request => valueOrThrow('startQuality', await ctx.remote.customerServiceAdmin.startQuality(request)),
    listQuality: async () => valueOrThrow('listQuality', await ctx.remote.customerServiceAdmin.listQuality()),
    getQuality: async id => valueOrThrow('getQuality', await ctx.remote.customerServiceAdmin.getQuality(id)),
    reviewQuality: async request => valueOrThrow('reviewQuality', await ctx.remote.customerServiceAdmin.reviewQuality(request)),
  }
  const connection = ctx.get('connection') as ConnectionHandle
  const readConversation = async (id: SessionId, beforeSeq?: number) => {
    const response = await connection.api.sessions.history({ sessionId: id, maxMessages: 30,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    })
    const value = valueOrThrow('sessions.history', response.result)
    return conversationReadout(value.events, value.hasMore)
  }

  if (isCustomerAdminPath(window.location.pathname)) {
    ctx.slots.register({
      name: 'root', priority: -20, locale: NS,
      children: { 'customer-admin.page': { kind: 'keyed', scope: 'root' } },
    }, CustomerAdminPortal)
    ctx.slots.inject('customer-admin.page', function* () {
      for (const [page] of CUSTOMER_ADMIN_PAGES) {
        if (page === 'sessions') {
          yield ctx.slots.register({ name: 'customer-admin.page', key: page, locale: NS, store: qualityView,
            inject: () => qualityCallbacks }, PortalQualitySessionsPage)
          continue
        }
        if (page === 'evaluation') {
          yield ctx.slots.register({ name: 'customer-admin.page', key: page, locale: NS, store: qualityView,
            inject: () => qualityCallbacks }, QualityQueuePage)
          continue
        }
        yield ctx.slots.register({ name: 'customer-admin.page', key: page, locale: NS, store: rehearsal,
          inject: () => ({ ...callbacks, page, readConversation }) }, OperationsSection)
      }
    })
  }

  ctx.slots.inject('settings.section', function* () {
    for (const [order, [page, label]] of OPERATION_PAGES.entries()) {
      if (page === 'sessions') {
        yield ctx.slots.register({ name: 'settings.section', id: 'customer-service-sessions', order: 40 + order,
          label: () => operationsText(t, label), locale: NS, store: qualityView, children: { 'operations.trace': { kind: 'single', scope: 'root' } },
          inject: () => qualityCallbacks }, QualitySessionsPage)
        continue
      }
      if (page === 'evaluation') {
        yield ctx.slots.register({ name: 'settings.section', id: 'customer-service-evaluation', order: 40 + order,
          label: () => operationsText(t, label), locale: NS, store: qualityView, inject: () => qualityCallbacks }, QualityQueuePage)
        continue
      }
      yield ctx.slots.register({
        name: 'settings.section', id: `customer-service-${page}`, order: 40 + order,
        label: () => operationsText(t, label), locale: NS, store: rehearsal,
        inject: () => ({ ...callbacks, page, readConversation }),
      }, OperationsSection)
    }
  })
}
