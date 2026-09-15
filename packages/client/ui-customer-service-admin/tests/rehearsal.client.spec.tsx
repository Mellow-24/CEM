// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { createRehearsalStore } from '../src/client/demo-store.ts'
import { demoFlows, flowPath, OPERATION_PAGES, selectedEntry, validateFlow } from '../src/client/demo-data.ts'
import { OperationsSection } from '../src/client/OperationsSection.tsx'
import { conversationReadout } from '../src/client/readout.ts'
import type { OperationsProps } from '../src/client/operations-contract.ts'
import { applyPronunciationRules, PRONUNCIATION_RULES } from '../src/client/pronunciation-rules.ts'
import { zh } from '../src/client/locales.ts'
import { BAD_CASES, DOCUMENTS, OVERVIEW, RAG_SEARCH, STAGED } from './fixtures.client.ts'

afterEach(cleanup)

function setup(page: OperationsProps['page'], standalone = false) {
  const store = createRehearsalStore().create()
  const copy: Record<string, string> = zh
  const list: SessionListState = { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
  const props: OperationsProps = {
    page, standalone, actions: store.actions,
    useStore: select => select(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    useSessions: select => select(list), useWorkspaces: (() => { throw new Error('unused') }),
    t: key => copy[key] ?? key, close: vi.fn(), navigate: vi.fn(),
    overview: vi.fn(async () => OVERVIEW), listDocuments: vi.fn(async () => DOCUMENTS),
    listStagedDocuments: vi.fn(async () => STAGED), stageTextDocument: vi.fn(),
    listBadCases: vi.fn(async () => BAD_CASES), searchTest: vi.fn(async () => RAG_SEARCH),
    openSession: vi.fn(), readConversation: vi.fn(),
  }
  return { store, props }
}

describe('operator rehearsal', () => {
  it('requires the current pronunciation version to pass before review, and resets without real writes', () => {
    const store = createRehearsalStore().create()
    store.actions.review()
    expect(store.getSnapshot().issueClosed).toBe(false)
    store.actions.createIssue()
    store.actions.runTests()
    store.actions.review()
    expect(store.getSnapshot().issueClosed).toBe(false)
    store.actions.saveTerm('氹仔', 'taam5 zai2')
    store.actions.review()
    expect(store.getSnapshot().issueClosed).toBe(false)
    store.actions.runTests()
    store.actions.review()
    expect(store.getSnapshot().issueClosed).toBe(true)
    expect(store.getSnapshot().reviewedVersion).toBe(2)
    store.actions.saveTerm('氹仔', 'taam5 zai2 updated')
    expect(store.getSnapshot().testedVersion).toBe(0)
    expect(store.getSnapshot().issueClosed).toBe(false)
    store.actions.reset()
    expect(store.getSnapshot().termVersion).toBe(1)
    expect(store.getSnapshot().issueCreated).toBe(false)
  })

  it('validates graph references, reachability and cycles before resolving simulated branches', () => {
    expect(() => { selectedEntry(undefined) }).toThrow('selected operations entry')
    expect(selectedEntry('billing')).toBe('billing')
    for (const flow of demoFlows()) {
      expect(validateFlow(flow)).toEqual([])
      expect(flowPath(flow, 'normal')).toHaveLength(5)
      expect(flowPath(flow, 'timeout').at(-1)).toBe('timeout')
      expect(flowPath(flow, 'empty').at(-1)).toBe('empty')
      flow.nodes[0]!.next = 'missing'
      expect(validateFlow(flow).join()).toContain('有效出口')
      expect(flowPath(flow, 'normal')).toEqual([])
      flow.nodes[0]!.next = 'start'
      expect(validateFlow(flow).join()).toContain('循環')
      flow.nodes[0]!.label = ''
      expect(validateFlow(flow).join()).toContain('缺少名稱')
      flow.nodes[0]!.kind = '判斷'
      expect(validateFlow(flow).join()).toContain('缺少開始節點')
    }
  })

  it('keeps document revisions isolated and invalidates processing after text edits', () => {
    const store = createRehearsalStore().create()
    store.actions.advanceDocument()
    store.actions.advanceDocument()
    expect(store.getSnapshot().chunks).toHaveLength(2)
    store.actions.editChunk(0, '已調整的片段')
    expect(store.getSnapshot().documentStep).toBe(2)
    store.actions.setDocument('new.txt', '')
    store.actions.advanceDocument()
    expect(store.getSnapshot().documentStep).toBe(0)
    store.actions.setDocument('new.txt', '氹仔供電維護')
    store.actions.advanceDocument()
    store.actions.advanceDocument()
    store.actions.advanceDocument()
    expect(store.getSnapshot().documentStep).toBe(2)
    store.actions.verifyDocument()
    store.actions.advanceDocument()
    store.actions.advanceDocument()
    store.actions.advanceDocument()
    expect(store.getSnapshot().documentStep).toBe(4)
    store.actions.approveDocument(true)
    store.actions.advanceDocument()
    expect(store.getSnapshot().documentStep).toBe(5)
    expect(store.getSnapshot().notice).toContain('尚未發佈')
    store.actions.editChunk(0, '氹仔新版')
    expect(store.getSnapshot().documentApproved).toBe(false)
    expect(store.getSnapshot().documentVerified).toBe(false)
    store.actions.setDocumentQuery(' ')
    store.actions.verifyDocument()
    expect(store.getSnapshot().documentVerified).toBe(false)
    store.actions.approveDocument(true)
    expect(store.getSnapshot().documentApproved).toBe(false)
  })

  it('rejects empty rules and missing business placeholders', () => {
    const store = createRehearsalStore().create()
    store.actions.saveTerm('氹仔', ' ')
    expect(store.getSnapshot().termVersion).toBe(1)
    store.actions.saveAnswer('B', '金額')
    expect(store.getSnapshot().answers['B']).toContain('{{amount}}')
    store.actions.saveChannel('電話', ' ', '澳門粵語', true)
    expect(store.getSnapshot().channels['電話']!.greeting).not.toBe(' ')
  })

  it('does not read real data until explicitly selected, and does not mask a live error', async () => {
    const { props } = setup('overview')
    vi.mocked(props.overview).mockRejectedValue(new Error('private host path'))
    render(<OperationsSection {...props} />)
    expect(props.overview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '運行數據' }))
    await screen.findByText('暫時無法讀取數據。')
    expect(screen.queryByText('private host path')).toBeNull()
    expect(screen.queryByText('氹仔地址讀音需要覆核')).toBeNull()
  })

  it('edits pronunciation, invalidates regression, and links to quality without touching live providers', () => {
    const { props, store } = setup('voice')
    render(<OperationsSection {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '詞條糾偏' }))
    fireEvent.click(screen.getByRole('button', { name: '使用推薦讀音' }))
    fireEvent.click(screen.getByRole('button', { name: '保存詞條糾偏' }))
    expect(store.getSnapshot().terms['氹仔']).toBe('taam5 zai2')
    fireEvent.click(screen.getByRole('button', { name: '查看會話質檢 →' }))
    expect(props.navigate).toHaveBeenCalledWith('customer-service-evaluation')
    expect(props.overview).not.toHaveBeenCalled()
    expect(props.searchTest).not.toHaveBeenCalled()
  })

  it('limits the standalone pronunciation page to rules, corrections, and Macau addresses', () => {
    const { props } = setup('voice', true)
    render(<OperationsSection {...props} />)
    expect(screen.queryByRole('button', { name: '模型配置' })).toBeNull()
    expect(screen.queryByRole('button', { name: '提示詞模板' })).toBeNull()
    expect(screen.getByRole('button', { name: '發音規則庫' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '詞條糾偏' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '澳門地址庫' })).toBeTruthy()
    expect(screen.getByText('客服回答')).toBeTruthy()
    expect(screen.queryByText('模型回答')).toBeNull()
  })

  it('opens standalone knowledge directly on the current live library', async () => {
    const { props } = setup('knowledge', true)
    render(<OperationsSection {...props} />)
    await screen.findByText('approved/customer-faq.md')
    expect(screen.queryByRole('button', { name: '營運工作區' })).toBeNull()
    expect(screen.queryByRole('button', { name: '運行數據' })).toBeNull()
    expect(props.overview).toHaveBeenCalledTimes(1)
  })

  it('shows the completed remediation only after regression and review', () => {
    const { props, store } = setup('evaluation')
    store.actions.createIssue()
    store.actions.saveTerm('氹仔', 'taam5 zai2')
    render(<OperationsSection {...props} />)
    expect(screen.getByRole('button', { name: '完成覆核' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '運行規則迴歸' }))
    fireEvent.click(screen.getByRole('button', { name: '完成覆核' }))
    expect(screen.getByText('整改覆核完成，等待發布。')).toBeTruthy()
    act(() => { store.actions.saveTerm('氹仔', 'different') })
    expect(screen.queryByText('整改覆核完成，等待發布。')).toBeNull()
  })

  it('requires explicit confirmation for resetting local rehearsal progress', () => {
    const { props, store } = setup('overview')
    store.actions.createIssue()
    render(<OperationsSection {...props} />)
    fireEvent.click(screen.getByText('工作區設定'))
    fireEvent.click(screen.getByRole('button', { name: '重置工作區' }))
    expect(store.getSnapshot().issueCreated).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '確認重置工作區' }))
    expect(store.getSnapshot().issueCreated).toBe(false)
  })

  it('preserves history page cursors and omits reasoning and injected context', () => {
    const entry = (seq: number, type: string, data: unknown) => ({ event: { seq, time: 1234, type, data } })
    const result = conversationReadout([
      entry(0, 'turn/start', {}),
      entry(1, 'user/message', { content: [{ type: 'text', text: '客戶提問' }], source: { kind: 'user' } }),
      entry(2, 'user/message', { content: [{ type: 'text', text: '隱藏上下文' }], source: { kind: 'system' } }),
      entry(3, 'assistant/message', { message: { content: [{ type: 'reasoning', text: '不展示推理' }, { type: 'text', text: '服務回答' }] } }),
    ] as never, true)
    expect(result).toEqual({ hasMore: true, beforeSeq: 0, messages: [
      { seq: 1, time: 1234, role: '客戶', text: '客戶提問' }, { seq: 3, time: 1234, role: '客服', text: '服務回答' },
    ] })
  })

  it.each(OPERATION_PAGES)('uses product copy on the %s page', (page) => {
    const { props } = setup(page)
    const { container } = render(<OperationsSection {...props} />)
    expect(container.textContent).not.toMatch(/演示|模擬|DEMO-/iu)
    expect(props.overview).not.toHaveBeenCalled()
    expect(props.stageTextDocument).not.toHaveBeenCalled()
  })

  it('paginates service records and combines case-insensitive search, channel, policy, and status', () => {
    const { props } = setup('sessions')
    render(<OperationsSection {...props} />)
    expect(screen.getAllByRole('button', { name: /^查看 CS-/u })).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }))
    expect(screen.getByRole('button', { name: '查看 CS-009' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('處理狀態'), { target: { value: '待覆核' } })
    fireEvent.change(screen.getByLabelText('會話渠道'), { target: { value: '電話' } })
    fireEvent.change(screen.getByLabelText('回答策略篩選'), { target: { value: 'C' } })
    expect(screen.getAllByRole('button', { name: /^查看 CS-/u })).toHaveLength(5)
    fireEvent.change(screen.getByLabelText('搜索服務會話'), { target: { value: '  cs-011  ' } })
    expect(screen.getAllByRole('button', { name: /^查看 CS-/u })).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('回答策略篩選'), { target: { value: 'A' } })
    expect(screen.queryAllByRole('button', { name: /^查看 CS-/u })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '清空篩選條件' }))
    expect(screen.getAllByRole('button', { name: /^查看 CS-/u })).toHaveLength(8)
  })

  it('resets private unsaved inputs together with shared drafts', () => {
    const { props } = setup('voice')
    render(<OperationsSection {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '詞條糾偏' }))
    fireEvent.change(screen.getByLabelText('粵拼讀音'), { target: { value: 'unsaved' } })
    fireEvent.click(screen.getByText('工作區設定'))
    fireEvent.click(screen.getByRole('button', { name: '重置工作區' }))
    fireEvent.click(screen.getByRole('button', { name: '確認重置工作區' }))
    fireEvent.click(screen.getByRole('button', { name: '詞條糾偏' }))
    expect(screen.getByLabelText<HTMLInputElement>('粵拼讀音').value).toBe('')
  })

  it('normalizes synthesis text by language without changing the displayed answer', () => {
    const enabled = new Set(PRONUNCIATION_RULES.map(rule => rule.id))
    const input = '請於12月18日前繳付$50，地址是123棟 R/C+S/L，也可通過BNU繳費。'
    const cantonese = applyPronunciationRules(input, '澳門粵語', enabled)
    expect(cantonese.displayText).toBe(input)
    expect(cantonese.spokenText).toBe('請於十二月十八日前繳付澳門元五十，地址是一百二十三棟 地下加閣樓，也可通過大西洋銀行繳費。')
    expect(cantonese.matches.map(match => match.ruleId)).toEqual([
      'address-alias', 'address-building', 'bank-alias', 'date', 'currency',
    ])
    expect(applyPronunciationRules('BNU', '葡語', enabled).spokenText).toBe('Banco Nacional Ultramarino')
    expect(applyPronunciationRules('123棟 R/C', '澳門粵語', new Set()).spokenText).toBe('123棟 R/C')
  })

  it('previews and versions general rules before exact term correction', () => {
    const { props, store } = setup('voice')
    render(<OperationsSection {...props} />)
    expect(screen.getByRole('heading', { name: '先按語言和場景處理通用讀法' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '運行規則試讀' }))
    expect(screen.getByText(/澳門一百二十三棟 地下加閣樓/u)).toBeTruthy()
    const checkbox = screen.getByRole('checkbox', { name: '啟用此規則: 澳門地址縮寫展開' })
    fireEvent.click(checkbox)
    expect(store.getSnapshot().pronunciationRuleVersion).toBe(2)
    expect(store.getSnapshot().pronunciationRules['address-alias']).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '澳門地址庫' }))
    expect(screen.getByText('Banco Nacional Ultramarino')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '詞條糾偏' }))
    expect(screen.getByLabelText('粵拼讀音')).toBeTruthy()
  })

  it('keeps verified pronunciation current when saving an unchanged reading', () => {
    const { store } = setup('voice')
    store.actions.saveTerm('氹仔', 'taam5 zai2')
    store.actions.runTests()
    store.actions.saveTerm('氹仔', ' taam5 zai2 ')
    expect(store.getSnapshot().termVersion).toBe(2)
    expect(store.getSnapshot().testedVersion).toBe(2)
  })

  it('preserves document verification and approval across section remounts', () => {
    const { props, store } = setup('knowledge')
    store.actions.advanceDocument()
    store.actions.advanceDocument()
    store.actions.verifyDocument()
    const view = render(<OperationsSection {...props} />)
    expect(screen.getByRole('button', { name: '確認檢索結果' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '確認檢索結果' }))
    fireEvent.click(screen.getByRole('button', { name: '提交審核' }))
    fireEvent.click(screen.getByRole('checkbox'))
    view.unmount()
    render(<OperationsSection {...props} />)
    expect(screen.getByRole('checkbox').getAttribute('checked')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '完成審核' }))
    expect(store.getSnapshot().documentStep).toBe(5)
  })
})
