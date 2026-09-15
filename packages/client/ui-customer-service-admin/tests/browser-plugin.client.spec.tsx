// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, CUSTOMER_ADMIN_PATH, inject, isCustomerAdminPath } from '../src/client/index.ts'
import type { CustomerServiceAdminInjected } from '../src/client/contracts.ts'
import { OperationsSection } from '../src/client/OperationsSection.tsx'
import { QualitySessionsPage, QualityQueuePage } from '../src/client/QualityPages.tsx'
import { CustomerAdminPortal } from '../src/client/CustomerAdminPortal.tsx'
import { PortalQualitySessionsPage } from '../src/client/PortalQualitySessionsPage.tsx'
import type { QualityCallbacks } from '../src/client/quality-contract.ts'
import { BAD_CASES, DOCUMENTS, OVERVIEW, RAG_SEARCH, SESSIONS, STAGED } from './fixtures.client.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

function success<Value>(value: Value): { readonly ok: true; readonly value: Value } {
  return { ok: true, value }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const remote = {
    overview: vi.fn(async () => success(OVERVIEW)),
    listDocuments: vi.fn(async () => success(DOCUMENTS)),
    listStagedDocuments: vi.fn(async () => success(STAGED)),
    stageTextDocument: vi.fn(async () => success({
      ok: true as const,
      value: { document: STAGED.items[0]!, revision: STAGED.revision },
    })),
    listBadCases: vi.fn(async () => success(BAD_CASES)),
    listQuality: vi.fn(async () => success([])),
    searchTest: vi.fn(async () => success(RAG_SEARCH)),
  }
  ctx.provide('remote.customerServiceAdmin', remote as never)
  const open = vi.fn()
  ctx.provide('sessions', { open } as never)
  ctx.provide('connection', { api: { sessions: { history: vi.fn() } } } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, remote, open }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-customer-service-admin browser plugin', () => {
  it('recognizes only the dedicated standalone administration path', () => {
    expect(CUSTOMER_ADMIN_PATH).toBe('/customer-admin')
    expect(isCustomerAdminPath('/customer-admin')).toBe(true)
    expect(isCustomerAdminPath('/customer-admin/')).toBe(true)
    expect(isCustomerAdminPath('/customer')).toBe(false)
    expect(isCustomerAdminPath('/')).toBe(false)
  })

  it('declares the services its Remote, session, and Settings registrations use', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'remote', 'remote.customerServiceAdmin', 'sessions', 'connection',
    ])
  })

  it('registers eight business pages and delegates real operations without eagerly loading data', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entries = b.slots.entries('settings.section')
    expect(entries.map(entry => ({
      id: entry.options.id,
      order: entry.options.order,
      label: resolveSlotLabel(entry.options.label),
      component: entry.component,
    }))).toEqual([
      { id: 'customer-service-overview', order: 40, label: '工作台', component: OperationsSection },
      { id: 'customer-service-agents', order: 41, label: '智能體與渠道', component: OperationsSection },
      { id: 'customer-service-flows', order: 42, label: '對話編排', component: OperationsSection },
      { id: 'customer-service-knowledge', order: 43, label: '知識與回答', component: OperationsSection },
      { id: 'customer-service-voice', order: 44, label: '模型與發音', component: OperationsSection },
      { id: 'customer-service-sessions', order: 45, label: '會話中心', component: QualitySessionsPage },
      { id: 'customer-service-evaluation', order: 46, label: '質檢與評測', component: QualityQueuePage },
      { id: 'customer-service-reports', order: 47, label: '報表與大屏', component: OperationsSection },
    ])
    for (const method of Object.values(b.remote)) expect(method).not.toHaveBeenCalled()

    const overview = (entries[0]!.inject as unknown as () => Pick<CustomerServiceAdminInjected, 'overview'>)()
    await expect(overview.overview()).resolves.toBe(OVERVIEW)
    const knowledge = (entries[3]!.inject as unknown as () => Pick<CustomerServiceAdminInjected,
      'overview' | 'listDocuments' | 'listStagedDocuments' | 'stageTextDocument' | 'searchTest'>)()
    await expect(knowledge.listDocuments()).resolves.toBe(DOCUMENTS)
    await expect(knowledge.listStagedDocuments()).resolves.toBe(STAGED)
    await expect(knowledge.searchTest({ retrieval: 'rag', query: 'billing' })).resolves.toBe(RAG_SEARCH)
    await expect(knowledge.stageTextDocument({ name: 'new.md', content: 'content' })).resolves.toMatchObject({ ok: true })
    const evaluation = (entries[6]!.inject as unknown as () => QualityCallbacks)()
    await expect(evaluation.listQuality()).resolves.toEqual([])
    const sessions = (entries[0]!.inject as unknown as () => Pick<CustomerServiceAdminInjected, 'openSession'>)()
    sessions.openSession(SESSIONS[0]!.id)
    expect(b.open).toHaveBeenCalledWith(SESSIONS[0]!.id)

    b.remote.overview.mockResolvedValueOnce({
      ok: false,
      error: { code: 'REMOTE_ERROR', message: 'unavailable', details: {} },
    } as never)
    await expect(overview.overview()).rejects.toThrow('customerServiceAdmin.overview failed: REMOTE_ERROR: unavailable')
    await b.ctx.fiber.dispose()
  })

  it('adds a focused CEM root without replacing the eight legacy registrations', async () => {
    window.history.replaceState(null, '', '/customer-admin')
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    expect(b.slots.entries('root').some(entry => entry.component === CustomerAdminPortal)).toBe(true)
    expect(b.slots.entries('settings.section')).toHaveLength(8)
    const pages = b.slots.entries('customer-admin.page')
    expect(pages.map(entry => [entry.options.key, entry.component])).toEqual([
      ['overview', OperationsSection],
      ['agents', OperationsSection],
      ['knowledge', OperationsSection],
      ['voice', OperationsSection],
      ['sessions', PortalQualitySessionsPage],
      ['evaluation', QualityQueuePage],
      ['reports', OperationsSection],
    ])
    await b.ctx.fiber.dispose()
  })

  it('follows late declaration, locale changes, redeclaration, and teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(8) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('工作台')
    b.locale.setLocale('pt')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Painel')

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(8) })
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
