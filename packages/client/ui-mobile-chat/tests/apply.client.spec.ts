// @vitest-environment jsdom
/** Mobile Session activation and reconnect recovery through the real slot registry. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { BrowserVoiceRuntime } from '@deepseek-ai/dsh-client-ui-voice/client'
import { apply, inject } from '../src/client/index.ts'
import type { Config } from '../src/config.ts'

const CONFIG: Config = {
  entryMode: 'preview',
  defaultPreset: 'macau-customer-service',
  servicePresets: ['macau-customer-service'],
  language: 'yue',
}

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

function voiceDouble(order: string[]): BrowserVoiceRuntime {
  return {
    controller: {
      deactivate: vi.fn(() => { order.push('deactivate') }),
      refreshProfile: vi.fn(() => { order.push('refresh') }),
      cancelRecording: vi.fn(),
      stopPlayback: vi.fn(),
    } as never,
    call: {
      stop: vi.fn(async () => { order.push('stop') }),
      getSnapshot: vi.fn(() => ({ phase: 'idle', transcript: '', answer: '', messages: [] })),
    } as never,
    dispose: vi.fn(async () => {}),
  }
}

async function bench() {
  window.history.replaceState({}, '', '/mobile.html?ui=cem-chat')
  runtime = await SlotTestRuntime.create()
  await runtime.workspaces.update((draft) => {
    draft.recentWorkspaceId = 'cem' as never
    draft.items = [{ workspaceId: 'cem', title: 'CEM', path: '/srv/cem', sessionIds: [] }] as never
  })
  const create = vi.fn(async (payload: { sessionId: SessionId }) => ({
    rpcId: 'create', result: { ok: true as const, value: { sessionId: payload.sessionId } },
  }))
  const select = vi.fn(async (payload: { sessionId: SessionId; agentPreset: string }) => ({
    rpcId: 'select', result: { ok: true as const, value: { agentPreset: payload.agentPreset } },
  }))
  runtime.provide('connection', { api: { sessions: { create }, agentPresets: { select } } })
  const order: string[] = []
  const voice = voiceDouble(order)
  runtime.provide('voiceRuntime', { create: vi.fn(() => voice) })
  await runtime.mount({ inject: [...inject], apply: (ctx) => { apply(ctx, CONFIG) } })
  const root = runtime.slots.entries('root')[0]
  if (root?.inject === undefined) throw new Error('mobile root did not register its initializer')
  const rootHooks = (root.inject as () => { initialize(): Promise<void> })()
  const initialize = (): Promise<void> => rootHooks.initialize()
  return { create, initialize, order, select, voice }
}

describe('mobile chat apply', () => {
  it('creates a fresh mobile conversation instead of adopting the shared current Session', async () => {
    const b = await bench()
    await runtime!.sessions.add({ id: 'shared', summary: {
      cwd: '/srv/cem', agentPreset: 'macau-customer-service', blank: false,
    } })
    localStorage.setItem('cem.mobile.lastSession', 'shared')
    runtime!.workspaces.stub('connectWorkspace', async () => {
      await runtime!.sessions.add({ id: 'fresh', summary: {
        cwd: '/srv/cem', agentPreset: 'macau-customer-service', blank: true,
      } }, { current: false })
      return 'fresh'
    })

    await b.initialize()

    expect(runtime!.workspaces.calls).toContainEqual({ method: 'connectWorkspace', args: ['cem'] })
    expect(b.create).toHaveBeenCalledWith({
      sessionId: 'fresh', cwd: '/srv/cem', agentPreset: 'macau-customer-service',
    })
    expect(runtime!.sessions.list.getSnapshot().current).toBe('fresh')
    expect(localStorage.getItem('cem.mobile.lastSession.v2')).toBe('fresh')
  })

  it('resumes the exact mobile Session before refreshing speech after a reconnect', async () => {
    const b = await bench()
    await runtime!.sessions.add({ id: 'mobile', summary: {
      cwd: '/srv/cem', agentPreset: 'macau-customer-service', blank: false,
    } })
    localStorage.setItem('cem.mobile.lastSession.v2', 'mobile')
    b.create.mockImplementation(async (payload: { sessionId: SessionId }) => {
      b.order.push(`resume:${payload.sessionId}`)
      return { rpcId: 'create', result: { ok: true as const, value: { sessionId: payload.sessionId } } }
    })
    await b.initialize()
    b.order.splice(0)
    const conversation = runtime!.slots.entries('mobile-chat.conversation')[0]
    if (conversation?.inject === undefined) throw new Error('mobile conversation did not register its Session injection')
    ;(conversation.inject as (id: SessionId) => unknown)('mobile' as SessionId)

    runtime!.ctx.emit('connection/reset')

    await vi.waitFor(() => { expect(b.order).toContain('refresh') })
    expect(b.order).toEqual(['deactivate', 'stop', 'resume:mobile', 'refresh'])
  })
})
