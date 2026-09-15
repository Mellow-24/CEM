// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
  type ConversationSnapshot, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import { VoiceSessionController } from '../src/client/controller.ts'
import type {
  SpeechProfile, VoiceClient, VoicePlatform, VoicePlayback, VoicePlaybackEvents, VoiceRecording,
} from '../src/client/contract.ts'
import { VoiceInputButton } from '../src/client/VoiceInputButton.tsx'
import { VoicePlaybackAction } from '../src/client/VoicePlaybackAction.tsx'
import { VoiceStatus } from '../src/client/VoiceStatus.tsx'
import type {
  VoiceInputInjected, VoiceInputProps, VoicePlaybackProps, VoiceStatusProps,
} from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

const SID = 'voice-components' as SessionId
const MID = (value: string) => value as MessageId
const t = makeTranslate(zh, commonZh)
const PROFILE = {
  transcription: { profile: 'asr', mediaTypes: ['audio/webm'], maxBytes: 1024 },
  synthesis: { profile: 'tts', mediaType: 'audio/mpeg', maxInputChars: 4000 },
} satisfies SpeechProfile

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function snapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
    ...overrides,
  }
}

function bench(profile: SpeechProfile = PROFILE) {
  let resolveRecording!: (blob: Blob) => void
  let rejectRecording!: (error: unknown) => void
  const completion = new Promise<Blob>((resolve, reject) => {
    resolveRecording = resolve
    rejectRecording = reject
  })
  const recordedBlob = new Blob(['voice'], { type: 'audio/webm' })
  const recording: VoiceRecording = {
    mediaType: 'audio/webm',
    completion,
    stop: vi.fn(() => {
      resolveRecording(recordedBlob)
      return completion
    }),
    cancel: vi.fn(() => { rejectRecording(Object.assign(new Error('aborted'), { name: 'AbortError' })) }),
  }
  let playbackEvents: VoicePlaybackEvents | undefined
  const playStop = vi.fn<VoicePlayback['stop']>()
  const order: string[] = []
  const unlock = vi.fn<VoicePlatform['unlock']>(() => { order.push('unlock') })
  const record = vi.fn<VoicePlatform['record']>(async () => recording)
  const platformPlay = vi.fn<VoicePlatform['play']>((_source, events) => {
    playbackEvents = events
    return { stop: playStop }
  })
  const platform: VoicePlatform = {
    unlock,
    record,
    play: platformPlay,
  }
  const profileCall = vi.fn<VoiceClient['profile']>(async () => profile)
  const transcribe = vi.fn<VoiceClient['transcribe']>(async () => ({ text: '新语音' }))
  const synthesize = vi.fn<VoiceClient['synthesize']>(async () => ({ url: '/speech.mp3' }))
  const client: VoiceClient = {
    profile: profileCall,
    transcribe,
    synthesize,
  }
  const controller = new VoiceSessionController(SID, client, platform)
  const useVoice = bindSnapshotSelector(controller)
  return {
    client, controller, order, platform, playbackEvents: () => playbackEvents,
    playStop, recording, useVoice, unlock, record, platformPlay, profileCall, transcribe, synthesize,
  }
}

function inputInjected(b: ReturnType<typeof bench>): Omit<VoiceInputInjected, 'hooks'> & {
  useVoice: VoiceInputProps['useVoice']
} {
  return {
    useVoice: b.useVoice,
    ensureProfile: () => b.controller.ensureProfile(),
    startRecording: () => b.controller.startRecording(),
    stopRecording: () => b.controller.stopRecording(),
    cancelRecording: () => { b.controller.cancelRecording() },
    markVoiceDraft: (draft: string) => { b.controller.markVoiceDraft(draft) },
    clearVoiceDraft: () => { b.controller.clearVoiceDraft() },
    armAutoPlayback: (committedThroughSeq: number) => { b.controller.armAutoPlayback(committedThroughSeq) },
    clearAutoPlayback: () => { b.controller.clearAutoPlayback() },
  }
}

function playbackProps(b: ReturnType<typeof bench>, messageId: MessageId, messageSeq: number): VoicePlaybackProps {
  return {
    messageId,
    messageSeq,
    useVoice: b.useVoice,
    ensureProfile: () => b.controller.ensureProfile(),
    claimAutoPlayback: (seq: number) => b.controller.claimAutoPlayback(seq),
    play: (id: MessageId) => b.controller.play(id),
    stop: (id: MessageId) => { b.controller.stopPlayback(id) },
    t,
  } as unknown as VoicePlaybackProps
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('VoiceInputButton', () => {
  it('records, appends the transcript, then arms before ordinary submission', async () => {
    const b = bench()
    const submit = vi.fn(() => { b.order.push('submit') })
    const old = MID('old')

    function Harness() {
      const [input, setInput] = useState({ draft: '已有草稿', phase: 'plain' as const })
      return (
        <>
          <output data-testid="draft">{input.draft}</output>
          <VoiceInputButton {...{
            session: snapshot({
              nodes: [{ kind: 'assistant', seq: 1, messageId: old, time: 1, turn: 1, step: 1, blocks: [] }],
            }),
            input,
            inputActions: { setDraft: (draft: string) => { setInput({ ...input, draft }) }, submit },
            t,
            ...inputInjected(b),
          } as unknown as VoiceInputProps} />
        </>
      )
    }

    render(<Harness />)
    const start = await screen.findByRole('button', { name: '开始录音' })
    fireEvent.click(start)
    await waitFor(() => { expect(screen.getByRole('button', { name: '停止录音' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '停止录音' }))
    await waitFor(() => { expect(screen.getByTestId('draft').textContent).toBe('已有草稿\n新语音') })
    const voiceSend = screen.getByRole('button', { name: '语音发送' })
    fireEvent.click(voiceSend)
    expect(b.order).toEqual(['unlock', 'submit'])
    expect(b.controller.getSnapshot().autoPlaybackArmed).toBe(true)
    expect(b.controller.claimAutoPlayback(1)).toBe(false)
    expect(submit).toHaveBeenCalledOnce()
  })

  it('returns to microphone mode when the user edits the transcript draft', async () => {
    const b = bench()
    await b.controller.ensureProfile()
    b.controller.markVoiceDraft('转写')

    function Harness() {
      const [draft, setDraft] = useState('转写')
      return (
        <>
          <button type="button" onClick={() => { setDraft('转写已编辑') }}>编辑</button>
          <VoiceInputButton {...{
            session: snapshot(), input: { draft, phase: 'plain' },
            inputActions: { setDraft, submit: vi.fn() }, t, ...inputInjected(b),
          } as unknown as VoiceInputProps} />
        </>
      )
    }
    render(<Harness />)
    expect(screen.getByRole('button', { name: '语音发送' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: '开始录音' })).toBeTruthy() })
    expect(b.controller.getSnapshot().voiceDraft).toBeNull()
  })

  it('appends a late transcript to the latest draft instead of the stop-click snapshot', async () => {
    const b = bench()
    const transcript = deferred<{ text: string }>()
    b.transcribe.mockReturnValueOnce(transcript.promise)

    function Harness() {
      const [draft, setDraft] = useState('最初')
      return (
        <>
          <output data-testid="latest-draft">{draft}</output>
          <button type="button" onClick={() => { setDraft('转写期间的编辑') }}>外部编辑</button>
          <VoiceInputButton {...{
            session: snapshot(), input: { draft, phase: 'plain' },
            inputActions: { setDraft, submit: vi.fn() }, t, ...inputInjected(b),
          } as unknown as VoiceInputProps} />
        </>
      )
    }

    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: '开始录音' }))
    fireEvent.click(await screen.findByRole('button', { name: '停止录音' }))
    fireEvent.click(screen.getByRole('button', { name: '外部编辑' }))
    transcript.resolve({ text: '迟到转写' })
    await waitFor(() => {
      expect(screen.getByTestId('latest-draft').textContent).toBe('转写期间的编辑\n迟到转写')
    })
  })

  it('lets the user cancel a pending microphone request and stops its late track', async () => {
    const b = bench()
    const pending = deferred<VoiceRecording>()
    const completion = deferred<Blob>()
    const cancelLateRecording = vi.fn(() => {
      completion.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
    const late: VoiceRecording = {
      mediaType: 'audio/webm',
      completion: completion.promise,
      stop: vi.fn(() => completion.promise),
      cancel: cancelLateRecording,
    }
    b.record.mockReturnValueOnce(pending.promise)
    render(<VoiceInputButton {...{
      session: snapshot(), input: { draft: '', phase: 'plain' },
      inputActions: { setDraft: vi.fn(), submit: vi.fn() }, t, ...inputInjected(b),
    } as unknown as VoiceInputProps} />)
    fireEvent.click(await screen.findByRole('button', { name: '开始录音' }))
    const cancel = await screen.findByRole('button', { name: '取消语音输入' })
    fireEvent.click(cancel)
    pending.resolve(late)
    await waitFor(() => { expect(cancelLateRecording).toHaveBeenCalledOnce() })
    expect(screen.getByRole('button', { name: '开始录音' })).toBeTruthy()
  })

  it('submits a transcription-only profile without arming or promising playback', async () => {
    const b = bench({ transcription: PROFILE.transcription })
    const submit = vi.fn()
    await b.controller.ensureProfile()
    b.controller.markVoiceDraft('仅转写')
    render(<VoiceInputButton {...{
      session: snapshot(), input: { draft: '仅转写', phase: 'plain' },
      inputActions: { setDraft: vi.fn(), submit }, t, ...inputInjected(b),
    } as unknown as VoiceInputProps} />)
    fireEvent.click(screen.getByRole('button', { name: '发送转写' }))
    expect(submit).toHaveBeenCalledOnce()
    expect(b.unlock).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot().autoPlaybackArmed).toBe(false)
  })

  it('never arms a slash-command draft even when synthesis is available', async () => {
    const b = bench()
    const submit = vi.fn()
    await b.controller.ensureProfile()
    b.controller.markVoiceDraft('/compact\n语音')
    render(<VoiceInputButton {...{
      session: snapshot(), input: { draft: '/compact\n语音', phase: 'plain' },
      inputActions: { setDraft: vi.fn(), submit }, t, ...inputInjected(b),
    } as unknown as VoiceInputProps} />)
    fireEvent.click(screen.getByRole('button', { name: '发送转写' }))
    expect(submit).toHaveBeenCalledOnce()
    expect(b.unlock).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot().autoPlaybackArmed).toBe(false)
  })

  it('renders no microphone without transcription and locks voice while a turn runs', async () => {
    const synthesisOnly = bench({ synthesis: PROFILE.synthesis })
    const first = render(<VoiceInputButton {...{
      session: snapshot(), input: { draft: '', phase: 'plain' },
      inputActions: { setDraft: vi.fn(), submit: vi.fn() }, t, ...inputInjected(synthesisOnly),
    } as unknown as VoiceInputProps} />)
    await act(async () => { await synthesisOnly.controller.ensureProfile() })
    expect(first.container.firstChild).toBeNull()
    first.unmount()

    const b = bench()
    await b.controller.ensureProfile()
    render(<VoiceInputButton {...{
      session: snapshot({ running: true }), input: { draft: '', phase: 'plain' },
      inputActions: { setDraft: vi.fn(), submit: vi.fn() }, t, ...inputInjected(b),
    } as unknown as VoiceInputProps} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '等待当前回复完成后再使用语音' }).disabled).toBe(true)
  })
})

describe('VoicePlaybackAction and VoiceStatus', () => {
  it('lets only a new committed message claim the arm, then exposes manual stop', async () => {
    const b = bench()
    await b.controller.ensureProfile()
    b.controller.armAutoPlayback(10)
    const view = render(<VoicePlaybackAction {...playbackProps(b, MID('old'), 10)} />)
    await Promise.resolve()
    expect(b.synthesize).not.toHaveBeenCalled()

    view.rerender(<VoicePlaybackAction {...playbackProps(b, MID('new'), 11)} />)
    await waitFor(() => { expect(b.synthesize).toHaveBeenCalledOnce() })
    act(() => { b.playbackEvents()?.onPlaying() })
    const stop = await screen.findByRole('button', { name: '停止 AI 合成语音' })
    fireEvent.click(stop)
    expect(b.playStop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '播放 AI 合成语音' })).toBeTruthy()
  })

  it('turns autoplay rejection into an explicit AI-generated speech retry', async () => {
    const b = bench()
    await b.controller.ensureProfile()
    render(<VoicePlaybackAction {...playbackProps(b, MID('reply'), 12)} />)
    fireEvent.click(screen.getByRole('button', { name: '播放 AI 合成语音' }))
    await waitFor(() => { expect(b.synthesize).toHaveBeenCalledOnce() })
    act(() => { b.playbackEvents()?.onError(new Error('autoplay denied')) })
    expect(screen.getByRole('button', { name: 'AI 合成语音播放失败，点击重试' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('AI 合成语音播放失败')
  })

  it('announces recording and playback errors in the composer dock', async () => {
    const b = bench()
    await b.controller.ensureProfile()
    b.record.mockRejectedValueOnce(new Error('permission denied'))
    await b.controller.startRecording()
    render(<VoiceStatus {...{
      useVoice: b.useVoice,
      ensureProfile: () => b.controller.ensureProfile(),
      t,
    } as unknown as VoiceStatusProps} />)
    expect(screen.getByRole('alert').textContent).toContain('语音输入失败：permission denied')
  })
})
