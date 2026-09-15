// @vitest-environment jsdom
/** Mobile route isolation, draft races, and host-request responses. */
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcId } from '@deepseek-ai/dsh-api-remotes/client'
import type { VoiceCallView } from '@deepseek-ai/dsh-client-ui-voice/client'
import { mobileEntry, callLabel, duration } from '../src/client/presenter.ts'
import { createMobileStore } from '../src/client/store.ts'
import { PendingRequest } from '../src/client/PendingRequest.tsx'
import { CallScreen } from '../src/client/CallScreen.tsx'

afterEach(cleanup)

it('selects only the mobile document and retains explicit legacy selection', () => {
  for (const mode of ['preview', 'default'] as const) {
    for (const path of ['/', '/customer', '/mobile.html?ui=legacy', '/mobile.html?ui=other']) {
      expect(mobileEntry(new URL(path, 'https://example.test'), mode)).toBe(false)
    }
    expect(mobileEntry(new URL('/mobile.html?ui=cem-chat', 'https://example.test'), mode)).toBe(true)
  }
  expect(mobileEntry(new URL('https://example.test/mobile.html'), 'preview')).toBe(false)
  expect(mobileEntry(new URL('https://example.test/mobile.html'), 'default')).toBe(true)
})

it('preserves edits during admission and merges transcription into the latest draft', () => {
  const store = createMobileStore().create()
  store.actions.draft('first')
  store.actions.draft('edited while sending')
  store.actions.clearDraft('first')
  expect(store.getSnapshot().draft).toBe('edited while sending')
  store.actions.appendTranscript('voice text')
  expect(store.getSnapshot().draft).toBe('edited while sending\nvoice text')
  store.actions.clearDraft('edited while sending\nvoice text')
  store.actions.appendTranscript('new voice text')
  expect(store.getSnapshot().draft).toBe('new voice text')
})

it('submits distinct selected and typed answers in one host request', async () => {
  const wait = new PendingWait('question', 'q1' as RpcId, 's1' as SessionId, { questions: [
    { id: 'method', question: '查詢方式', options: [{ label: '網上', description: '網上查詢' }] },
    { id: 'detail', question: '補充資料' },
  ] }, async () => ({ accepted: true }))
  const respond = vi.fn().mockResolvedValue(undefined)
  render(<PendingRequest wait={wait} respond={respond} />)
  fireEvent.click(screen.getByRole('radio'))
  fireEvent.change(screen.getByRole('textbox', { name: '補充資料' }), { target: { value: '本月' } })
  fireEvent.click(screen.getByRole('button', { name: '提交回覆' }))
  await waitFor(() => { expect(respond).toHaveBeenCalledWith({ ok: true, value: { sessionId: 's1', answer: { answers: [
    { id: 'method', selected: ['網上'] }, { id: 'detail', selected: [], custom: '本月' },
  ] } } }) })
})

it('keeps request inputs after a failed receipt and allows an explicit retry', async () => {
  const wait = new PendingWait('question', 'q1' as RpcId, 's1' as SessionId,
    { questions: [{ id: 'detail', question: '補充資料' }] }, async () => ({ accepted: true }))
  const respond = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue(undefined)
  render(<PendingRequest wait={wait} respond={respond} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留答案' } })
  fireEvent.click(screen.getByRole('button', { name: '提交回覆' }))
  await screen.findByRole('alert')
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('保留答案')
  fireEvent.click(screen.getByRole('button', { name: '提交回覆' }))
  await waitFor(() => { expect(respond).toHaveBeenCalledTimes(2) })
})

it('minimizes without ending the call and routes controls to the real owner', () => {
  const expand = vi.fn(), end = vi.fn(), mute = vi.fn(), interrupt = vi.fn()
  const call = { phase: 'listening' as const, transcript: '查詢方式', answer: '', messages: [], muted: false }
  render(<CallScreen call={call} expanded expand={expand} end={end} mute={mute} interrupt={interrupt} />)
  fireEvent.click(screen.getByRole('button', { name: '返回聊天' }))
  expect(expand).toHaveBeenCalledWith(false)
  expect(end).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '靜音' }))
  expect(mute).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: '我要說話' }))
  expect(interrupt).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '結束通話' }))
  expect(end).toHaveBeenCalledOnce()
  expect(callLabel({ ...call, muted: true })).toBe('麥克風已靜音')
  expect(duration(125)).toBe('02:05')
})

it('retains opening and interrupted text while minimizing or receiving another question', () => {
  const props = { expanded: true, expand: vi.fn(), end: vi.fn(), mute: vi.fn(), interrupt: vi.fn() }
  let call: VoiceCallView = { phase: 'connecting', transcript: '', answer: '', messages: [] }
  const view = render(<CallScreen {...props} call={call} />)
  expect(screen.getByRole('log', { name: '通話對話' }).textContent).toContain('接通後')
  expect(screen.queryByRole('heading', { name: '通話字幕' })).toBeNull()
  expect(screen.queryByText('即時顯示最新對話')).toBeNull()
  call = { phase: 'playing', transcript: '查詢方式', answer: '請準備電費單。', messages: [
    { id: 'opening', speaker: 'assistant', text: '您好。', status: 'complete' },
    { id: 'user1', speaker: 'user', text: '查詢方式', status: 'complete' },
    { id: 'answer1', speaker: 'assistant', text: '請準備電費單。', status: 'partial' },
  ] }
  view.rerender(<CallScreen {...props} call={call} />)
  call = { ...call, answer: '請準備電費單。再核對客戶編號。', messages: call.messages.map(row => row.id === 'answer1'
    ? { ...row, text: '請準備電費單。再核對客戶編號。', status: 'complete' } : row) }
  view.rerender(<CallScreen {...props} call={call} />)
  expect(screen.getAllByText('請準備電費單。再核對客戶編號。')).toHaveLength(1)
  view.rerender(<CallScreen {...props} call={{ ...call, phase: 'listening' }} />)
  expect(screen.getByRole('log').textContent).toContain(call.answer)
  view.rerender(<CallScreen {...props} call={call} expanded={false} />)
  expect(screen.queryByRole('log')).toBeNull()
  view.rerender(<CallScreen {...props} call={call} />)
  expect(screen.getByRole('log').textContent).toContain(call.answer)
  call = { phase: 'thinking', transcript: '有哪些繳費方式？', answer: '', messages: [
    ...call.messages.map(row => row.id === 'answer1' ? { ...row, status: 'interrupted' as const } : row),
    { id: 'user2', speaker: 'user', text: '有哪些繳費方式？', status: 'complete' },
  ] }
  view.rerender(<CallScreen {...props} call={call} />)
  expect(screen.getByRole('log').textContent).toContain(call.transcript)
  expect(screen.getByText('您好。')).toBeTruthy()
  expect(screen.getByText('查詢方式')).toBeTruthy()
  expect(screen.getByText('請準備電費單。再核對客戶編號。')).toBeTruthy()
  expect(screen.getByText('· 已打斷')).toBeTruthy()
  view.rerender(<CallScreen {...props} call={{ ...call, phase: 'error', error: '連線中斷，請重新通話。' }} />)
  expect(screen.getByRole('alert').textContent).toBe('連線中斷，請重新通話。')
  expect(screen.getByRole('log').textContent).toContain(call.transcript)
  expect(props.end).not.toHaveBeenCalled()
  view.rerender(<CallScreen {...props} call={{ phase: 'idle', transcript: '', answer: '', messages: [] }} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('leaves a reader in history until they choose to follow the latest text', () => {
  const props = { expanded: true, expand: vi.fn(), end: vi.fn(), mute: vi.fn(), interrupt: vi.fn() }
  const call: VoiceCallView = { phase: 'listening', transcript: '', answer: '', messages: [
    { id: 'opening', speaker: 'assistant', text: '您好。', status: 'complete' },
  ] }
  const view = render(<CallScreen {...props} call={call} />)
  const log = screen.getByRole('log')
  Object.defineProperties(log, { clientHeight: { value: 200 }, scrollHeight: { value: 1000 } })
  log.scrollTop = 80
  fireEvent.wheel(log, { deltaY: -100 })
  fireEvent.scroll(log)
  view.rerender(<CallScreen {...props} call={{ ...call, messages: [...call.messages,
    { id: 'new', speaker: 'assistant', text: '新的回答', status: 'partial' },
  ] }} />)
  expect(log.scrollTop).toBe(80)
  fireEvent.click(screen.getByRole('button', { name: '回到最新對話 ↓' }))
  expect(log.scrollTop).toBe(1000)
  expect(screen.queryByRole('button', { name: '回到最新對話 ↓' })).toBeNull()
})
