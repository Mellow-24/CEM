// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, QualityInspection, QualityRun, QualityRunId } from '@deepseek-ai/dsh-api-remotes/client'
import type { QualitySessionsProps } from '../src/client/quality-contract.ts'
import { createQualityViewStore } from '../src/client/quality-view-store.ts'
import { QualitySessionsPage, QualityQueuePage } from '../src/client/QualityPages.tsx'
import { QualityDetail } from '../src/client/QualityDetail.tsx'
import { QUALITY_LABELS, qualityTotals } from '../src/client/quality-format.ts'

afterEach(cleanup)
const id = 'customer-1' as SessionId
const inspection: QualityInspection = { sessionId: id, title: '如何繳費', preset: 'macau', capturedAt: '2026-09-09T00:00:00.000Z',
  throughSeq: 3, fingerprint: 'a'.repeat(64), turns: [1], unfinishedTurns: [], records: [
    { seq: 1, endSeq: 1, turn: 1, step: 1, kind: 'user', name: '客戶提問', input: '如何繳費', output: '', time: 0,
      durationMs: null, firstTokenMs: null, tokens: null, error: false },
    { seq: 3, endSeq: 3, turn: 1, step: 1, kind: 'assistant', name: '模型回覆', input: '', output: '使用 App 繳費。', time: 1,
      durationMs: 100, firstTokenMs: 20, tokens: 10, error: false },
  ] }
function completed(): QualityRun {
  return { id: '00000000-0000-4000-8000-000000000001' as QualityRunId, revision: 1, status: 'completed',
    createdAt: inspection.capturedAt, completedAt: inspection.capturedAt, provider: 'test', model: 'test', ruleVersion: 'quality-v1',
    weights: { intent: 20, retrieval: 20, grounding: 25, completion: 15, expression: 10, execution: 10 }, inspection,
    selectedTurn: null, result: [{ turn: 1, intent: '繳費查詢', scores: (Object.keys(QUALITY_LABELS) as (keyof typeof QUALITY_LABELS)[])
      .map(dimension => ({ dimension, status: 'scored', score: 80, reason: '依據不足需覈查', evidenceSeqs: [3], severity: 'minor', suggestion: '核對渠道' })) }],
    error: null, reviews: [] }
}
function setup() {
  const store = createQualityViewStore().create()
  const props: QualitySessionsProps = {
    t: key => key === 'localeCode' ? 'zh' : key,
    actions: store.actions,
    useStore: select => select(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    useSessions: select => select({ ids: [id], byId: { [id]: { id, displayTitle: '如何繳費', blank: false, running: false, updatedAt: 1 } },
      current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }),
    useWorkspaces: () => { throw new Error('unused') }, renderSlot: vi.fn(() => '複用軌跡表格'), close: vi.fn(), navigate: vi.fn(),
    inspectQuality: vi.fn(async () => inspection), startQuality: vi.fn(async () => completed()),
    getQuality: vi.fn(async () => completed()), listQuality: vi.fn(async () => []), reviewQuality: vi.fn(async () => completed()),
  }
  return { props, store }
}

describe('quality pages', () => {
  it('keeps unfinished evidence readable and evaluates completed turns by default', () => {
    const { props } = setup()
    render(<QualityDetail {...props} inspection={{ ...inspection, turns: [1, 2], unfinishedTurns: [2] }}
      initialRun={null} history={[]} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: '開始質檢' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('status').textContent).toContain('自動質檢會跳過')
    fireEvent.click(screen.getByRole('button', { name: '執行過程' }))
    expect(screen.getByText('複用軌跡表格')).toBeTruthy()
  })

  it('defaults to actual history and opens a full snapshot without navigating the customer session', async () => {
    const { props } = setup()
    render(<QualitySessionsPage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '查看詳情' }))
    await screen.findByRole('heading', { name: '六維質量評分' })
    expect(props.inspectQuality).toHaveBeenCalledWith(id)
    expect(props.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '開始質檢' }))
    await screen.findByText('輪 1 · 繳費查詢')
    expect(props.startQuality).toHaveBeenCalledWith(expect.objectContaining({ expectedFingerprint: inspection.fingerprint }))
    fireEvent.click(screen.getAllByRole('button', { name: '證據 #3' })[0]!)
    expect(screen.getByText('複用軌跡表格')).toBeTruthy()
    expect(props.renderSlot).toHaveBeenCalledWith('operations.trace', expect.objectContaining({ selectedSeq: 3 }))
  })

  it('retains list search after returning and makes empty filters recoverable', async () => {
    const { props } = setup()
    render(<QualitySessionsPage {...props} />)
    fireEvent.change(screen.getByLabelText('搜索歷史會話'), { target: { value: '不匹配' } })
    expect(screen.getByText('暫無符合條件的會話。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清空篩選' }))
    fireEvent.change(screen.getByLabelText('搜索歷史會話'), { target: { value: '繳費' } })
    fireEvent.click(screen.getByRole('button', { name: '查看詳情' }))
    await screen.findByRole('button', { name: '返回會話列表' })
    fireEvent.click(screen.getByRole('button', { name: '返回會話列表' }))
    expect(screen.getByLabelText<HTMLInputElement>('搜索歷史會話').value).toBe('繳費')
  })

  it('saves reasoned human review separately from the automatic result', async () => {
    const { props } = setup()
    render(<QualityDetail {...props} inspection={inspection} initialRun={completed()} history={[]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '質檢與覆核記錄' }))
    expect(screen.getByRole('button', { name: '確認並保存人工評分' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('覆核或驗收依據'), { target: { value: '核對了原始依據' } })
    fireEvent.change(screen.getByLabelText('人工總分'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: '確認並保存人工評分' }))
    await waitFor(() => { expect(props.reviewQuality).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1,
      reason: '核對了原始依據', score: 85, action: 'review' })) })
  })

  it('reports rule totals and refuses a start when weights do not total 100', async () => {
    const { props, store } = setup()
    const view = render(<QualityQueuePage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '評分規則' }))
    fireEvent.change(screen.getByLabelText('檢索質量 權重'), { target: { value: '5' } })
    expect(screen.getByRole('status').textContent).toContain('85%')
    view.unmount()
    await act(async () => { store.actions.select(id) })
    render(<QualitySessionsPage {...props} />)
    expect((await screen.findByRole('button', { name: '開始質檢' })).hasAttribute('disabled')).toBe(true)
  })

  it('does not turn missing evidence into a high score or hide critical findings', () => {
    const run = completed()
    Object.assign(run.result[0]!.scores[0]!, { status: 'insufficient-evidence', score: null, severity: 'critical' })
    expect(qualityTotals(run)).toEqual({ score: null, coverage: 80, critical: true })
  })
})
