// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { VoiceInputInjected } from '../src/client/slots.ts'
import { VoiceInputButton } from '../src/client/VoiceInputButton.tsx'
import { VoicePlaybackAction } from '../src/client/VoicePlaybackAction.tsx'
import { VoiceStatus } from '../src/client/VoiceStatus.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const S1 = 'voice-s1' as SessionId

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function bench() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const runtime = await SlotTestRuntime.create()
  await runtime.sessions.add({ id: S1, summary: { agentPreset: 'standard' } })
  await runtime.sessions.add({ id: 'voice-s2', summary: { agentPreset: 'standard' } }, { current: false })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({
    'conversation.input.right': { kind: 'list', scope: 'session' },
    'conversation.composer.dock': { kind: 'list', scope: 'session' },
    'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
  }, () => null)
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({
    transcription: { profile: 'asr', mediaTypes: ['audio/webm'], maxBytes: 1024 },
    synthesis: { profile: 'tts', mediaType: 'audio/mpeg', maxInputChars: 4000 },
  })))
  vi.stubGlobal('fetch', fetcher)
  const feature = await runtime.mount({ inject: [...inject], apply })
  return { feature, fetcher, runtime }
}

describe('ui-voice browser apply', () => {
  it('declares only standing Client services and keeps the Node half inert', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions'])
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers all three reversible entries', async () => {
    const b = await bench()
    expect(b.runtime.slots.entries('conversation.input.right')[0]).toMatchObject({
      component: VoiceInputButton,
      options: { id: 'voice-input', order: 50 },
      locale: 'voice',
    })
    expect(b.runtime.slots.entries('conversation.composer.dock')[0]).toMatchObject({
      component: VoiceStatus,
      options: { id: 'voice-status', order: -10 },
      locale: 'voice',
    })
    expect(b.runtime.slots.entries('conversation.chat.assistant-actions')[0]).toMatchObject({
      component: VoicePlaybackAction,
      options: { id: 'voice-playback', order: 5 },
      locale: 'voice',
    })

    await b.feature.dispose()
    expect(b.runtime.slots.entries('conversation.input.right')).toHaveLength(0)
    expect(b.runtime.slots.entries('conversation.composer.dock')).toHaveLength(0)
    expect(b.runtime.slots.entries('conversation.chat.assistant-actions')).toHaveLength(0)
    await b.runtime.dispose()
  })

  it('refreshes cached unavailable/available capability after preset summary changes', async () => {
    const b = await bench()
    const entry = b.runtime.slots.entries('conversation.input.right')[0]!
    const face = (entry.inject as unknown as (sessionId: SessionId) => VoiceInputInjected)(S1)
    await face.ensureProfile()
    expect(b.fetcher).toHaveBeenCalledOnce()

    await b.runtime.sessions.updateSummary(S1, { agentPreset: 'hk-feng-shui' })
    await vi.waitFor(() => { expect(b.fetcher).toHaveBeenCalledTimes(2) })
    expect(face.hooks.voice.getSnapshot().profileState).toBe('ready')

    face.armAutoPlayback(-1)
    expect(face.hooks.voice.getSnapshot().autoPlaybackArmed).toBe(true)
    await b.runtime.sessions.setCurrent('voice-s2')
    expect(face.hooks.voice.getSnapshot()).toMatchObject({
      autoPlaybackArmed: false,
      voiceDraft: null,
      playback: null,
    })
    await b.runtime.dispose()
  })

  it('retries one unavailable profile when the current Session becomes live', async () => {
    const b = await bench()
    b.fetcher
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        transcription: { profile: 'asr', mediaTypes: ['audio/webm'], maxBytes: 1024 },
      }))
    const entry = b.runtime.slots.entries('conversation.input.right')[0]!
    const face = (entry.inject as unknown as (sessionId: SessionId) => VoiceInputInjected)(S1)
    await face.ensureProfile()
    expect(face.hooks.voice.getSnapshot().profileState).toBe('unavailable')

    await b.runtime.sessions.updateSummary(S1, { running: true })
    await vi.waitFor(() => { expect(face.hooks.voice.getSnapshot().profileState).toBe('ready') })
    expect(b.fetcher).toHaveBeenCalledTimes(2)
    await b.runtime.sessions.updateSummary(S1, { title: 'still live' })
    expect(b.fetcher).toHaveBeenCalledTimes(2)
    await b.runtime.dispose()
  })

  it('disposes a controller with its Session scope instead of retaining removed Sessions', async () => {
    const b = await bench()
    const entry = b.runtime.slots.entries('conversation.input.right')[0]!
    const face = (entry.inject as unknown as (sessionId: SessionId) => VoiceInputInjected)(S1)
    await face.ensureProfile()
    expect(b.fetcher).toHaveBeenCalledOnce()
    await b.runtime.sessions.remove(S1)
    await expect(face.ensureProfile()).resolves.toBeUndefined()
    expect(b.fetcher).toHaveBeenCalledOnce()
    await b.runtime.dispose()
  })

  it('fails loud if a slot inject addresses a Session with no client scope', async () => {
    const b = await bench()
    const entry = b.runtime.slots.entries('conversation.input.right')[0]!
    expect(() => {
      (entry.inject as unknown as (sessionId: SessionId) => VoiceInputInjected)('unknown' as SessionId)
    }).toThrow('has no client scope')
    await b.runtime.dispose()
  })
})
