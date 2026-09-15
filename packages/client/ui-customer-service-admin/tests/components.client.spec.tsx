// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { OverviewSection, type OverviewSectionProps } from '../src/client/OverviewSection.tsx'
import { KnowledgeSection, type KnowledgeSectionProps } from '../src/client/KnowledgeSection.tsx'
import { SessionsSection, type SessionsSectionProps } from '../src/client/SessionsSection.tsx'
import { EvaluationSection, type EvaluationSectionProps } from '../src/client/EvaluationSection.tsx'
import { zh, type CustomerServiceAdminLocaleKey } from '../src/client/locales.ts'
import { BAD_CASES, DOCUMENTS, OVERVIEW, RAG_SEARCH, SESSIONS, STAGED, WIKI_SEARCH } from './fixtures.client.ts'

afterEach(cleanup)

const t = ((key: CustomerServiceAdminLocaleKey): string => zh[key]) as OverviewSectionProps['t']
const unusedHook = (() => { throw new Error('unused standard hook') }) as never
const kit = { t, close: vi.fn(), useSessions: unusedHook, useWorkspaces: unusedHook }

function overviewProps(overview = vi.fn(async () => OVERVIEW)): OverviewSectionProps {
  return { ...kit, overview, useSessions: sessionsHook(sessionState()) }
}

function knowledgeProps(overrides: Partial<KnowledgeSectionProps> = {}): KnowledgeSectionProps {
  return {
    ...kit,
    overview: vi.fn(async () => OVERVIEW),
    listDocuments: vi.fn(async () => DOCUMENTS),
    listStagedDocuments: vi.fn(async () => STAGED),
    stageTextDocument: vi.fn(async () => ({
      ok: true as const,
      value: { document: STAGED.items[0]!, revision: STAGED.revision },
    })),
    searchTest: vi.fn(async () => RAG_SEARCH),
    ...overrides,
  }
}

function sessionState(
  items = SESSIONS,
  phase: SessionListState['phase'] = 'ready',
): SessionListState {
  return {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    current: undefined,
    phase,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function sessionsHook(snapshot: SessionListState): SessionsSectionProps['useSessions'] {
  return function select<Selected>(selector: (value: SessionListState) => Selected): Selected {
    return selector(snapshot)
  }
}

function sessionsProps(
  overrides: Partial<SessionsSectionProps> = {},
  snapshot: SessionListState = sessionState(),
): SessionsSectionProps {
  return {
    ...kit,
    close: vi.fn(),
    useSessions: sessionsHook(snapshot),
    openSession: vi.fn(),
    ...overrides,
  }
}

function evaluationProps(overrides: Partial<EvaluationSectionProps> = {}): EvaluationSectionProps {
  return {
    ...kit,
    listBadCases: vi.fn(async () => BAD_CASES),
    ...overrides,
  }
}

describe('OverviewSection', () => {
  it('shows unknown conversation totals while the catalog is loading', async () => {
    render(<OverviewSection {...overviewProps()} useSessions={sessionsHook(sessionState([], 'pending'))} />)
    await screen.findByText(zh.serviceCommandTitle)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getAllByText(zh.sessionsLoading).length).toBeGreaterThan(0)
  })
  it('moves from loading to real overview metrics and configuration', async () => {
    const deferred = Promise.withResolvers<typeof OVERVIEW>()
    render(<OverviewSection {...overviewProps(vi.fn(() => deferred.promise))} />)
    expect(screen.getByText(zh.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(OVERVIEW) })
    expect(screen.getByRole('heading', { name: zh.overviewTitle })).toBeTruthy()
    expect(screen.getAllByText('248')).toHaveLength(2)
    expect(screen.getAllByText(zh.indexPresent).length).toBeGreaterThan(0)
    expect(screen.getByText('deepseek-embedding')).toBeTruthy()
    expect(screen.getAllByText('release-2026-09')).toHaveLength(3)
  })

  it('hides provider identities in the standalone overview', async () => {
    render(<OverviewSection {...overviewProps()} standalone />)
    await screen.findByText(zh.serviceCommandTitle)
    expect(screen.queryByText('deepseek-embedding')).toBeNull()
    expect(screen.queryByText('deepseek-reranker')).toBeNull()
    expect(screen.getByText(zh.rerank)).toBeTruthy()
  })

  it('retries a failed overview without exposing transport details', async () => {
    const overview = vi.fn()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({
        ...OVERVIEW,
        rag: { ...OVERVIEW.rag, config: { ...OVERVIEW.rag.config, rerank: false }, index: { state: 'invalid' as const } },
      })
    render(<OverviewSection {...overviewProps(overview)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(zh.loadError)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    expect((await screen.findAllByText(zh.indexInvalid)).length).toBeGreaterThan(0)
    expect(screen.getByText(zh.disabled)).toBeTruthy()
    expect(overview).toHaveBeenCalledTimes(2)
  })

  it('flags an index built from a different configured identity', async () => {
    const overview = vi.fn(async () => ({
      ...OVERVIEW,
      rag: {
        ...OVERVIEW.rag,
        index: { ...OVERVIEW.rag.index, matchesConfiguredIdentity: false },
      },
    }))
    render(<OverviewSection {...overviewProps(overview)} />)
    expect((await screen.findAllByText(zh.identityMismatched)).length).toBeGreaterThan(0)
  })
})

describe('KnowledgeSection', () => {
  it('replaces the provider identity with current index data in the standalone portal', async () => {
    render(<KnowledgeSection {...knowledgeProps()} standalone />)
    await screen.findByText('approved/customer-faq.md')
    expect(screen.queryByText(/deepseek-embedding/u)).toBeNull()
    expect(screen.getByText(`${zh.indexedChunks} 248`)).toBeTruthy()
  })

  it('combines document-name and strategy filters and fills sample queries without running them', async () => {
    const props = knowledgeProps()
    render(<KnowledgeSection {...props} />)
    await screen.findByText('approved/customer-faq.md')
    fireEvent.change(screen.getByRole('searchbox', { name: zh.searchDocuments }), { target: { value: 'billing' } })
    expect(screen.queryByText('approved/customer-faq.md')).toBeNull()
    expect(screen.getByText('wiki/billing.md')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: zh.documentStrategy }), { target: { value: 'rag' } })
    expect(screen.getByText(zh.documentsNoMatch)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.sampleContract }))
    expect(screen.getByLabelText<HTMLInputElement>(zh.query).value).toBe(zh.sampleContract)
    expect(props.searchTest).not.toHaveBeenCalled()
  })
  it('shows active and staged assets, stages a file, and refreshes the catalogs', async () => {
    const result = {
      ok: true as const,
      value: { document: STAGED.items[0]!, revision: STAGED.revision },
    }
    const deferred = Promise.withResolvers<typeof result>()
    const props = knowledgeProps({ stageTextDocument: vi.fn(() => deferred.promise) })
    render(<KnowledgeSection {...props} />)
    expect(await screen.findByText('approved/customer-faq.md')).toBeTruthy()
    expect(screen.getByText('price-update.md')).toBeTruthy()

    const file = new File(['updated tariff'], 'tariff.md', { type: 'text/markdown' })
    Object.defineProperty(file, 'text', { value: vi.fn(async () => 'updated tariff') })
    fireEvent.change(screen.getByLabelText(zh.chooseDocument), { target: { files: [file] } })
    expect(screen.getByText('tariff.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.stageDocument }))
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(zh.chooseDocument).disabled).toBe(true)
    })
    await act(async () => { deferred.resolve(result) })
    await waitFor(() => {
      expect(props.stageTextDocument).toHaveBeenCalledWith({
        name: 'tariff.md', content: 'updated tariff', expectedRevision: STAGED.revision,
      })
      expect(props.listStagedDocuments).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByRole('status').textContent).toBe(zh.stageSuccess)
  })

  it('reports a staging business rejection and a transport failure', async () => {
    const stageTextDocument = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'document-exists', name: 'tariff.md' } })
      .mockRejectedValueOnce(new Error('offline'))
    const props = knowledgeProps({ stageTextDocument })
    render(<KnowledgeSection {...props} />)
    await screen.findByText('approved/customer-faq.md')
    const input = screen.getByLabelText(zh.chooseDocument)
    const button = screen.getByRole('button', { name: zh.stageDocument })

    const first = new File(['one'], 'tariff.md')
    Object.defineProperty(first, 'text', { value: vi.fn(async () => 'one') })
    fireEvent.change(input, { target: { files: [first] } })
    fireEvent.click(button)
    expect(await screen.findByText(zh.stageExists)).toBeTruthy()

    const second = new File(['two'], 'other.md')
    Object.defineProperty(second, 'text', { value: vi.fn(async () => 'two') })
    fireEvent.change(input, { target: { files: [second] } })
    fireEvent.click(button)
    expect(await screen.findByText(zh.stageError)).toBeTruthy()
  })

  it('refreshes a stale staging revision before the operator retries', async () => {
    const stageTextDocument = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'staging-conflict' as const,
        expectedRevision: STAGED.revision,
        actualRevision: 'staging-r2' as never,
      },
    }))
    const props = knowledgeProps({ stageTextDocument })
    render(<KnowledgeSection {...props} />)
    await screen.findByText('approved/customer-faq.md')
    const file = new File(['new tariff'], 'tariff.md')
    Object.defineProperty(file, 'text', { value: vi.fn(async () => 'new tariff') })
    fireEvent.change(screen.getByLabelText(zh.chooseDocument), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: zh.stageDocument }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh.stageConflict)
    await waitFor(() => { expect(props.listStagedDocuments).toHaveBeenCalledTimes(2) })
  })

  it('renders the page error state and retries all knowledge snapshots', async () => {
    const overview = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(OVERVIEW)
    const props = knowledgeProps({ overview })
    render(<KnowledgeSection {...props} />)
    expect((await screen.findByRole('alert')).textContent).toBe(zh.loadError)
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    expect(await screen.findByText('approved/customer-faq.md')).toBeTruthy()
    expect(overview).toHaveBeenCalledTimes(2)
    expect(props.listDocuments).toHaveBeenCalledTimes(2)
    expect(props.listStagedDocuments).toHaveBeenCalledTimes(2)
  })

  it('keeps short document checksums readable', async () => {
    const document = { ...DOCUMENTS.items[0]!, sha256: 'short-live-hash' }
    const staged = { ...STAGED.items[0]!, sha256: 'short-stage-hash', modifiedAt: 'not-a-date' }
    render(<KnowledgeSection {...knowledgeProps({
      listDocuments: vi.fn(async () => ({ items: [document] })),
      listStagedDocuments: vi.fn(async () => ({ ...STAGED, items: [staged] })),
    })} />)
    expect(await screen.findByText('short-live-hash')).toBeTruthy()
    expect(screen.getByText('short-stage-hash')).toBeTruthy()
    expect(screen.getByText(zh.unknown)).toBeTruthy()
  })

  it('runs both configured retrieval strategies and renders their evidence', async () => {
    const rag = Promise.withResolvers<Awaited<ReturnType<KnowledgeSectionProps['searchTest']>>>()
    const wiki = Promise.withResolvers<Awaited<ReturnType<KnowledgeSectionProps['searchTest']>>>()
    const searchTest = vi.fn()
      .mockReturnValueOnce(rag.promise)
      .mockReturnValueOnce(wiki.promise)
    render(<KnowledgeSection {...knowledgeProps({ searchTest })} />)
    await screen.findByText('approved/customer-faq.md')

    const query = screen.getByLabelText(zh.query)
    const retrieval = screen.getByLabelText(zh.retrieval)
    fireEvent.change(query, { target: { value: '  更改合約戶名  ' } })
    fireEvent.click(screen.getByRole('button', { name: zh.runSearch }))
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(zh.query).disabled).toBe(true)
      expect(screen.getByLabelText<HTMLSelectElement>(zh.retrieval).disabled).toBe(true)
    })
    await act(async () => { rag.resolve(RAG_SEARCH) })
    expect(await screen.findByText('客戶服務指南')).toBeTruthy()
    expect(searchTest).toHaveBeenNthCalledWith(1, { retrieval: 'rag', query: '更改合約戶名' })

    fireEvent.change(retrieval, { target: { value: 'llm-wiki' } })
    expect(screen.queryByText('客戶服務指南')).toBeNull()
    const page = screen.getByRole('combobox', { name: zh.wikiPage })
    fireEvent.change(page, { target: { value: OVERVIEW.wiki.release.pages[1]!.pageId } })
    fireEvent.click(screen.getByRole('button', { name: zh.runSearch }))
    await waitFor(() => {
      expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.wikiPage }).disabled).toBe(true)
    })
    await act(async () => { wiki.resolve(WIKI_SEARCH) })
    expect(await screen.findByText('可使用線上銀行或自助終端繳費。')).toBeTruthy()
    expect(searchTest).toHaveBeenNthCalledWith(2, {
      retrieval: 'llm-wiki', query: '更改合約戶名', pageId: OVERVIEW.wiki.release.pages[1]!.pageId,
    })
  })

  it('renders empty catalogs, no evidence, and a retriever failure', async () => {
    const searchTest = vi.fn()
      .mockResolvedValueOnce({ ...RAG_SEARCH, status: 'not-found', reranked: false, sources: [] })
      .mockRejectedValueOnce(new Error('retriever down'))
    render(<KnowledgeSection {...knowledgeProps({
      listDocuments: vi.fn(async () => ({ items: [] })),
      listStagedDocuments: vi.fn(async () => ({ ...STAGED, items: [] })),
      searchTest,
    })} />)
    expect(await screen.findByText(zh.knowledgeEmpty)).toBeTruthy()
    expect(screen.getByText(zh.stagedEmpty)).toBeTruthy()
    const query = screen.getByLabelText(zh.query)
    fireEvent.change(query, { target: { value: 'test' } })
    fireEvent.click(screen.getByRole('button', { name: zh.runSearch }))
    expect(await screen.findByText(zh.searchNotFound)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.runSearch }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh.searchError)
  })

  it('rejects empty search submissions and disables Wiki search without release pages', async () => {
    const searchTest = vi.fn(async () => RAG_SEARCH)
    const overview = vi.fn(async () => ({
      ...OVERVIEW,
      wiki: { release: { ...OVERVIEW.wiki.release, pages: [] } },
    }))
    render(<KnowledgeSection {...knowledgeProps({ overview, searchTest })} />)
    await screen.findByText('approved/customer-faq.md')
    const query = screen.getByLabelText(zh.query)
    const form = query.closest('form')!
    fireEvent.submit(form)
    expect(searchTest).not.toHaveBeenCalled()

    fireEvent.change(query, { target: { value: '賬單' } })
    fireEvent.change(screen.getByLabelText(zh.retrieval), { target: { value: 'llm-wiki' } })
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.wikiPage }).disabled).toBe(true)
    fireEvent.submit(form)
    expect(searchTest).not.toHaveBeenCalled()
  })
})

describe('SessionsSection', () => {
  it('combines live state and preset filters', () => {
    render(<SessionsSection {...sessionsProps()} />)
    const filters = screen.getByRole('group', { name: zh.sessionStatus })
    fireEvent.click(within(filters).getByRole('button', { name: zh.running }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('更改合約戶名')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: zh.filterPreset }), { target: { value: 'macau-customer-service-wiki' } })
    expect(screen.getByText(zh.sessionsNoMatch)).toBeTruthy()
    fireEvent.click(within(filters).getByRole('button', { name: zh.idle }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('線上繳費方式')).toBeTruthy()
  })
  it('filters canonical history rows and opens a selected conversation', () => {
    const props = sessionsProps()
    render(<SessionsSection {...props} />)
    expect(screen.getByText('更改合約戶名')).toBeTruthy()
    expect(screen.getAllByText(zh.running).length).toBeGreaterThan(0)
    expect(screen.getAllByText(zh.idle).length).toBeGreaterThan(0)
    expect(screen.getAllByText(zh.unknown)).toHaveLength(2)
    expect(screen.queryByText('New Session')).toBeNull()
    expect(screen.queryByText('內部資料整理')).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: zh.searchSessions }), { target: { value: 'wiki' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: `${zh.openConversation}: 線上繳費方式` }))
    expect(props.openSession).toHaveBeenCalledWith(SESSIONS[2]!.id)
    expect(props.close).toHaveBeenCalledOnce()

    fireEvent.change(screen.getByRole('searchbox', { name: zh.searchSessions }), { target: { value: 'missing' } })
    expect(screen.getByText(zh.sessionsNoMatch)).toBeTruthy()
  })

  it('reports a stale open target without closing Settings', async () => {
    const openSession = vi.fn(() => { throw new Error('unknown session') })
    const props = sessionsProps({ openSession })
    render(<SessionsSection {...props} />)
    fireEvent.click(screen.getByRole('button', { name: `${zh.openConversation}: 更改合約戶名` }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh.openConversationError)
    expect(props.close).not.toHaveBeenCalled()
  })

  it('renders pending and empty object-layer snapshots honestly', () => {
    const pending = render(<SessionsSection {...sessionsProps({}, sessionState([], 'pending'))} />)
    expect(screen.getByText(zh.sessionsLoading)).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    pending.unmount()

    render(<SessionsSection {...sessionsProps({}, sessionState([]))} />)
    expect(screen.getByText(zh.sessionsEmpty)).toBeTruthy()
  })
})

describe('EvaluationSection', () => {
  it('labels the recorded-case rate separately from overall answer accuracy', async () => {
    render(<EvaluationSection {...evaluationProps()} />)
    expect(await screen.findByText('50%')).toBeTruthy()
    expect(screen.getByText(zh.qualityPassRateHint)).toBeTruthy()
    expect(screen.getByText('missing-evidence · 1')).toBeTruthy()
  })
  it('filters cases and discloses acceptance details', async () => {
    render(<EvaluationSection {...evaluationProps()} />)
    expect(await screen.findByText('如何更改合約戶名？')).toBeTruthy()
    expect(screen.getByText('Como pagar a conta?')).toBeTruthy()
    const group = screen.getByRole('group', { name: zh.state })
    fireEvent.click(within(group).getByRole('button', { name: zh.open }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByText(zh.caseDetails))
    expect(screen.getByText('missing-evidence')).toBeTruthy()
    expect(screen.getByText(/\u5217\u51fa\u5fc5\u9700\u6587\u4ef6/u)).toBeTruthy()
    fireEvent.click(within(group).getByRole('button', { name: zh.closed }))
    expect(screen.getByText('Como pagar a conta?')).toBeTruthy()
  })

  it('retries failures and renders the empty ledger', async () => {
    const listBadCases = vi.fn()
      .mockRejectedValueOnce(new Error('private'))
      .mockResolvedValueOnce({ items: [] })
    render(<EvaluationSection {...evaluationProps({ listBadCases })} />)
    expect((await screen.findByRole('alert')).textContent).toBe(zh.loadError)
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    expect(await screen.findByText(zh.evaluationEmpty)).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('distinguishes an empty filter result from an empty ledger', async () => {
    const invalidTimeCase = { ...BAD_CASES.items[0]!, capturedAt: 'not-a-date' }
    const listBadCases = vi.fn(async () => ({ items: [invalidTimeCase] }))
    render(<EvaluationSection {...evaluationProps({ listBadCases })} />)
    await screen.findByText('如何更改合約戶名？')
    expect(screen.getByText(new RegExp(zh.unknown, 'u'))).toBeTruthy()
    const group = screen.getByRole('group', { name: zh.state })
    fireEvent.click(within(group).getByRole('button', { name: zh.closed }))
    expect(screen.getByText(zh.evaluationNoMatch)).toBeTruthy()
  })
})
