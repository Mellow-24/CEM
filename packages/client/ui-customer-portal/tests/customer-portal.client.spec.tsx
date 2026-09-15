// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  customerHistory, customerHistoryPage, customerReplyWaitPhase, visibleMessages,
} from '../src/client/CustomerPortal.tsx'
import { isCustomerPortalPath } from '../src/client/index.ts'

describe('customer portal route and projections', () => {
  it('activates only the dedicated customer URL', () => {
    expect(isCustomerPortalPath('/customer')).toBe(true)
    expect(isCustomerPortalPath('/customer/')).toBe(true)
    expect(isCustomerPortalPath('/')).toBe(false)
    expect(isCustomerPortalPath('/settings')).toBe(false)
  })

  it('keeps customer prose and answer-stage streaming while hiding tool traces', () => {
    const snapshot = {
      nodes: [
        { kind: 'user', seq: 1, time: 100, content: [{ type: 'text', text: '如何查詢電費？' }] },
        { kind: 'tool-result', seq: 2, time: 110, content: [{ type: 'text', text: 'internal evidence' }] },
        { kind: 'assistant', seq: 3, time: 120, blocks: [{ kind: 'text', text: '你可以登入網上服務查詢。' }] },
      ],
      partial: { turn: 2, step: 2, blocks: [{ kind: 'text', text: '亦可以使用合約編號' }] },
    } as unknown as ConversationSnapshot

    expect(visibleMessages(snapshot)).toEqual([
      { key: 'user-1', role: 'user', text: '如何查詢電費？', time: 100 },
      { key: 'assistant-3', role: 'assistant', text: '你可以登入網上服務查詢。', time: 120 },
      { key: 'partial-2-2', role: 'assistant', text: '亦可以使用合約編號', partial: true },
    ])
  })

  it('hides the lookup announcement and exposes only the final answer', () => {
    const snapshot = {
      nodes: [
        { kind: 'user', seq: 1, time: 100, content: [{ type: 'text', text: '如何申請住宅供電服務？' }] },
        {
          kind: 'assistant', seq: 2, time: 110, turn: 1, step: 1,
          blocks: [
            { kind: 'text', text: "I'll search for the relevant information." },
            { kind: 'tool-call', callId: 'search-1', name: 'search_company_knowledge', argsRaw: '{}' },
          ],
        },
        { kind: 'tool-result', seq: 3, time: 120, content: [{ type: 'text', text: 'internal evidence' }] },
        {
          kind: 'assistant', seq: 4, time: 130, turn: 1, step: 2,
          blocks: [{ kind: 'text', text: '申請住宅供電服務，可透過澳電網上服務辦理。' }],
        },
      ],
      partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: '我先為你查詢。' }] },
    } as unknown as ConversationSnapshot

    expect(visibleMessages(snapshot)).toEqual([
      { key: 'user-1', role: 'user', text: '如何申請住宅供電服務？', time: 100 },
      { key: 'assistant-4', role: 'assistant', text: '申請住宅供電服務，可透過澳電網上服務辦理。', time: 130 },
    ])
  })

  it('keeps visible progress through submission and hidden knowledge lookup steps', () => {
    const snapshot = (overrides: Partial<ConversationSnapshot>): ConversationSnapshot => ({
      running: false,
      partial: null,
      runningCalls: [],
      ...overrides,
    } as unknown as ConversationSnapshot)

    expect(customerReplyWaitPhase(snapshot({}), true)).toBe('submitting')
    expect(customerReplyWaitPhase(snapshot({ running: true }), true)).toBe('thinking')
    expect(customerReplyWaitPhase(snapshot({
      running: true,
      partial: {
        turn: 1,
        step: 1,
        blocks: [
          { kind: 'text', text: "I'll search for the relevant information." },
          { kind: 'tool-call', callId: 'search-1', name: 'search_company_knowledge', argsRaw: '{}' },
        ],
      },
    }), true)).toBe('searching')
    expect(customerReplyWaitPhase(snapshot({
      running: true,
      runningCalls: [{
        callId: 'search-1',
        name: 'search_company_knowledge',
        argsRaw: '{}',
        turn: 1,
        step: 1,
        time: 0,
        callView: null,
        subCalls: [],
      }],
    }), true)).toBe('searching')
    expect(customerReplyWaitPhase(snapshot({
      running: true,
      partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: '申請住宅供電服務可以' }] },
    }), true)).toBeNull()
  })

  it('lists only completed customer-service root sessions by recency', () => {
    const list = {
      ids: ['older', 'blank', 'other', 'child', 'newer', 'archived'],
      byId: {
        older: { id: 'older', displayTitle: '查詢電費', agentPreset: 'macau-customer-service', blank: false, running: false, updatedAt: 100 },
        blank: { id: 'blank', displayTitle: '新對話', agentPreset: 'macau-customer-service', blank: true, running: false, updatedAt: 500 },
        other: { id: 'other', displayTitle: '其他工作', agentPreset: 'code', blank: false, running: false, updatedAt: 400 },
        child: { id: 'child', displayTitle: '內部子任務', agentPreset: 'macau-customer-service', origin: 'subagent', blank: false, running: false, updatedAt: 300 },
        newer: { id: 'newer', displayTitle: '申請供電', agentPreset: 'macau-customer-service', blank: false, running: true, updatedAt: 200 },
        archived: { id: 'archived', displayTitle: '已刪除對話', agentPreset: 'macau-customer-service', blank: false, running: false, updatedAt: 600 },
      },
    } as unknown as SessionListState

    expect(customerHistory(list, ['archived' as never])).toEqual([
      { id: 'newer', title: '申請供電', updatedAt: 200, running: true },
      { id: 'older', title: '查詢電費', updatedAt: 100, running: false },
    ])
  })

  it('bounds history rendering to eight rows and clamps stale pages', () => {
    const history = Array.from({ length: 18 }, (_, index) => ({
      id: `session-${index}` as never,
      title: `對話 ${index}`,
      updatedAt: 100 - index,
      running: false,
    }))

    expect(customerHistoryPage(history, 0)).toMatchObject({
      page: 0,
      pageCount: 3,
      items: history.slice(0, 8),
    })
    expect(customerHistoryPage(history, 99)).toMatchObject({
      page: 2,
      pageCount: 3,
      items: history.slice(16, 18),
    })
  })
})
