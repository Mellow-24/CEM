import { describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import { VoiceCallController } from '../src/client/call.ts'
import { createWebVoiceClient } from '../src/client/client.ts'
import type { SpeechProfile, VoiceClient, VoicePlatform, VoicePlaybackEvents } from '../src/client/contract.ts'

const profile: SpeechProfile = {
  transcription: { profile: 'asr', mediaTypes: ['audio/webm'], maxBytes: 1000 },
  synthesis: { profile: 'tts', mediaType: 'audio/mpeg', maxInputChars: 4000 },
  call: { defaultGreeting: 'yue', greetings: { yue: { text: '你好。', url: '/api/speech/greeting?language=yue' } }, playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, maxPendingAudioMs: 8000, utteranceMergeMs: 10, interruption: { confirmationMs: 420, minimumMeaningfulCharacters: 3, echoMinimumCharacters: 6, echoSimilarityThreshold: 0.82, backchannelMaximumCharacters: 6 }, sentenceMaxChars: 160, sentencePauseMinChars: 12, sentenceQueueLimit: 32, responseTimeoutMs: 1000 },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function bench() {
  const listeners = new Set<() => void>()
  let snapshot = {
    nodes: [], turnEnds: new Map(), running: false, queue: [], removed: false, subagent: null, lastAgentError: null,
  } as unknown as ConversationSnapshot
  const update = (fields: Partial<ConversationSnapshot>) => {
    snapshot = { ...snapshot, ...fields }
    for (const listener of listeners) listener()
  }
  const prompt = vi.fn<SessionFace['prompt']>(async () => {
    update({ running: true, nodes: [{ kind: 'user', seq: 1, time: 0, source: null, content: [{ type: 'text', text: '账单怎么查' }] }] })
    return { ok: true as const, value: { accepted: true as const } }
  })
  const cancel = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const session = {
    sessionId: 'call-session' as SessionId, getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    prompt, cancel,
  } as unknown as SessionFace
  const captures: ReturnType<typeof deferred<Blob>>[] = []
  let playback: VoicePlaybackEvents | undefined
  let autoPlaying = true
  const stopPlayback = vi.fn()
  const platform = {
    capture: vi.fn<NonNullable<VoicePlatform['capture']>>(async () => {
      throw new Error('continuous capture is not configured for this test')
    }),
    prepare: vi.fn<NonNullable<VoicePlatform['prepare']>>(() => {
      throw new Error('prepared playback is not configured for this test')
    }),
    unlock: vi.fn(),
    record: vi.fn<VoicePlatform['record']>(async (_types, _max, signal) => {
      const capture = deferred<Blob>()
      captures.push(capture)
      signal.addEventListener('abort', () => { capture.reject(signal.reason) }, { once: true })
      return { mediaType: 'audio/webm', completion: capture.promise,
        stop: async () => { capture.resolve(new Blob(['speech'])); return await capture.promise },
        cancel: () => { capture.reject(new Error('cancelled')) },
      }
    }),
    play: vi.fn<VoicePlatform['play']>((_source, events) => {
      playback = events
      if (autoPlaying) events.onPlaying()
      return { stop: stopPlayback }
    }),
  }
  const client = {
    profile: vi.fn(async () => profile),
    transcribe: vi.fn<VoiceClient['transcribe']>(async () => ({ text: '账单怎么查' })),
    synthesize: vi.fn(async () => ({ url: '/audio.mp3' })),
    synthesizeSentence: vi.fn<NonNullable<VoiceClient['synthesizeSentence']>>(async () => ({ url: '/sentence.mp3' })),
  }
  const call = new VoiceCallController(session, client, platform)
  const finish = () =>{  update({ running: false, turnEnds: new Map([[1, 5]]), nodes: [...snapshot.nodes, {
    kind: 'assistant', seq: 4, time: 0, turn: 1, step: 1, messageId: 'answer' as MessageId,
    blocks: [{ kind: 'text', text: '请查看账单。' }],
  }] }) }
  return { call, client, platform, prompt, cancel, update, captures, finish, listeners, stopPlayback,
    playback: () => playback, setAutoPlaying: (value: boolean) => { autoPlaying = value } }
}

describe('continuous voice calls', () => {
  function liveBench() {
    const b = bench()
    let emit!: (event: import('../src/client/contract.ts').VoiceRecognitionEvent) => void
    let frame!: (pcm: Uint8Array) => void
    const close = vi.fn(async () => {})
    const send = vi.fn(async (_pcm: Uint8Array) => {})
    const client = b.client as VoiceClient
    const platform = b.platform as VoicePlatform
    client.listen = vi.fn<NonNullable<VoiceClient['listen']>>(async (_session, _profile, events, signal) => {
      emit = events
      return { send, done: new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => { resolve() }, { once: true }) }) }
    })
    platform.capture = vi.fn<NonNullable<VoicePlatform['capture']>>(async (sink) => { frame = sink; return { close } })
    platform.prepare = vi.fn<NonNullable<VoicePlatform['prepare']>>((source, signal) => ({
      play: events => b.platform.play(source, events, signal), stop: b.stopPlayback,
    }))
    let turn = 0
    let seq = 0
    let nodes: ConversationSnapshot['nodes'] = []
    b.prompt.mockImplementation(async (...args: unknown[]) => {
      turn++
      const content = args[0] as { type: 'text'; text: string }[]
      nodes = [...nodes, { kind: 'user', seq: ++seq, time: 0, source: null, content }]
      b.update({ nodes, running: true })
      return { ok: true as const, value: { accepted: true as const } }
    })
    b.cancel.mockImplementation(async () => {
      b.update({ running: false, partial: null, turnEnds: new Map([[seq, ++seq]]) })
      return { ok: true as const, value: { accepted: true as const } }
    })
    const finish = (answer = '您好，请问有什么可以帮您？') => {
      nodes = [...nodes, { kind: 'assistant', seq: ++seq, time: 0, turn, step: 1, messageId: `answer-${seq}` as MessageId, blocks: [{ kind: 'text', text: answer }] }]
      b.update({ nodes, partial: null, running: false, turnEnds: new Map([[seq, ++seq]]) })
    }
    const liveProfile: SpeechProfile = { ...profile,
      transcription: { ...profile.transcription!, realtime: true },
      call: { ...profile.call!, defaultGreeting: 'yue', greetings: { yue: { text: '你好。', url: '/api/speech/greeting?language=yue' } } },
    }
    return { ...b, finish, liveProfile, close, send, emit: (event: import('../src/client/contract.ts').VoiceRecognitionEvent) =>{  emit(event) }, frame: (value = 0) =>{  frame(new Uint8Array(3200).fill(value)) } }
  }

  async function ask(b: ReturnType<typeof liveBench>) {
    b.call.start(b.liveProfile)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.capture).toHaveBeenCalledOnce() })
    b.platform.play.mockClear()
    b.emit({ type: 'final', text: '账单怎么查' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
  }

  function semanticBench() {
    const b = liveBench()
    const requests: { result: ReturnType<typeof deferred<{ decision: 'interrupt' | 'continue' }>>; signal: AbortSignal }[] = []
    const classify = vi.fn<NonNullable<VoiceClient['classifyInterruption']>>(async (_request, signal) => {
      const result = deferred<{ decision: 'interrupt' | 'continue' }>()
      requests.push({ result, signal })
      return await result.promise
    })
    ;(b.client as VoiceClient).classifyInterruption = classify
    b.liveProfile = { ...b.liveProfile, call: { ...b.liveProfile.call!, interruption: {
      ...b.liveProfile.call!.interruption, semantic: { timeoutMs: 1000 },
    } } }
    return { ...b, requests, classify }
  }

  it('keeps playback active during semantic classification and submits an accepted correction once', async () => {
    const b = semanticBench()
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '你可以登入網上服務繳費。' }] } })
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('playing') })
    b.emit({ type: 'speech-start' })
    b.emit({ type: 'partial', text: '我已經試過網上繳費' })
    expect(b.classify).not.toHaveBeenCalled()
    b.emit({ type: 'final', text: '我已經試過網上繳費，都係交唔到。' })
    expect(b.call.getSnapshot().phase).toBe('playing')
    expect(b.cancel).not.toHaveBeenCalled()
    expect(b.prompt).toHaveBeenCalledOnce()
    expect(b.classify.mock.calls[0]?.[0]).toEqual({ sessionId: 'call-session',
      text: '我已經試過網上繳費，都係交唔到。', question: '账单怎么查', playback: '你可以登入網上服務繳費。' })
    b.requests[0]!.result.resolve({ decision: 'interrupt' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    expect(b.cancel).toHaveBeenCalledOnce()
    expect(b.prompt.mock.calls[1]?.[0]).toEqual([{ type: 'text', text: '我已經試過網上繳費，都係交唔到。' }])
    await b.call.stop()
  })

  it('submits three successive corrections without accumulating earlier questions', async () => {
    vi.useFakeTimers()
    const b = semanticBench()
    const corrections = ['我想問個地址', '唔系啊我想問你個鋪頭嘅地址啊', '唔系我問你公司嘅地址啊你公司個地址']
    try {
      await ask(b)
      for (const [index, text] of corrections.entries()) {
        b.update({ partial: { turn: index + 1, step: 1, blocks: [{ kind: 'text', text: '請先準備最近一期帳單。' }] } })
        await vi.advanceTimersByTimeAsync(0)
        expect(b.call.getSnapshot().phase).toBe('playing')
        b.emit({ type: 'speech-start' })
        b.emit({ type: 'final', text })
        expect(b.classify).toHaveBeenCalledTimes(index + 1)
        expect(b.classify.mock.calls[index]?.[0]).toMatchObject({
          text, question: index === 0 ? '账单怎么查' : corrections[index - 1],
        })
        b.requests[index]!.result.resolve({ decision: 'interrupt' })
        await vi.advanceTimersByTimeAsync(10)
        expect(b.prompt).toHaveBeenCalledTimes(index + 2)
        expect(b.cancel).toHaveBeenCalledTimes(index + 1)
        expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text }], 'queue')
      }
      expect(b.prompt.mock.calls.map(([content]) => content)).toEqual(
        ['账单怎么查', ...corrections].map(text => [{ type: 'text', text }]),
      )
      expect(b.call.getSnapshot().messages.filter(row => row.speaker === 'user').map(row => row.text))
        .toEqual(['账单怎么查', ...corrections])
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('does not call the model or stop playback for a single character or acknowledgement', async () => {
    const b = semanticBench()
    await ask(b)
    b.finish('你可以登入網上服務繳費。')
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('playing') })
    for (const text of ['停', '嗯', '好', 'A', '好的', 'Thank you']) {
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'partial', text })
      b.emit({ type: 'final', text })
      await new Promise((resolve) => { setTimeout(resolve, 15) })
    }
    expect(b.classify).not.toHaveBeenCalled()
    expect(b.cancel).not.toHaveBeenCalled()
    expect(b.call.getSnapshot().phase).toBe('playing')
    await b.call.stop()
  })

  it('ignores a denied semantic candidate without adding a user message', async () => {
    const b = semanticBench()
    await ask(b)
    b.finish('你可以登入網上服務繳費。')
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('playing') })
    b.emit({ type: 'final', text: '你幫我關一下門。' })
    b.requests[0]!.result.resolve({ decision: 'continue' })
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(b.cancel).not.toHaveBeenCalled()
    expect(b.prompt).toHaveBeenCalledOnce()
    expect(b.call.getSnapshot().messages.some(row => row.text.includes('關一下門'))).toBe(false)
    await b.call.stop()
  })

  it.each(['onset', 'empty-partial', 'empty-final', 'repeated-onset'] as const)(
    'retains a finalized semantic candidate after noise with %s', async (noise) => {
      vi.useFakeTimers()
      const b = semanticBench()
      try {
        await ask(b)
        b.finish('你可以登入網上服務繳費。')
        await vi.advanceTimersByTimeAsync(0)
        b.stopPlayback.mockClear()
        b.emit({ type: 'final', text: '我已經試過網上繳費，都係交唔到。' })
        b.emit({ type: 'speech-start' })
        if (noise === 'empty-partial') b.emit({ type: 'partial', text: ' ' })
        if (noise === 'empty-final') b.emit({ type: 'final', text: ' ' })
        if (noise === 'repeated-onset') b.emit({ type: 'speech-start' })
        expect(b.requests[0]!.signal.aborted).toBe(false)
        expect(b.stopPlayback).not.toHaveBeenCalled()
        b.requests[0]!.result.resolve({ decision: 'interrupt' })
        await vi.advanceTimersByTimeAsync(10)
        expect(b.prompt).toHaveBeenCalledTimes(2)
        expect(b.stopPlayback).toHaveBeenCalled()
        expect(b.prompt.mock.calls[1]?.[0]).toEqual([
          { type: 'text', text: '我已經試過網上繳費，都係交唔到。' },
        ])
      } finally { await b.call.stop(); vi.useRealTimers() }
    },
  )

  it('ignores a single-character stop after a separately finalized acknowledgement', async () => {
    vi.useFakeTimers()
    const b = semanticBench()
    b.liveProfile = { ...b.liveProfile, call: { ...b.liveProfile.call!, utteranceMergeMs: 850 } }
    try {
      await ask(b)
      b.finish('你可以登入網上服務繳費。')
      await vi.advanceTimersByTimeAsync(0)
      b.stopPlayback.mockClear()
      b.emit({ type: 'final', text: '嗯' })
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'partial', text: '停' })
      await vi.advanceTimersByTimeAsync(500)
      b.emit({ type: 'final', text: '停' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(b.classify).not.toHaveBeenCalled()
      expect(b.stopPlayback).not.toHaveBeenCalled()
      expect(b.prompt).toHaveBeenCalledOnce()
      expect(b.call.getSnapshot().phase).toBe('playing')
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('joins resumed correction segments without repeating the interrupted question', async () => {
    const b = semanticBench()
    b.liveProfile = { ...b.liveProfile, call: { ...b.liveProfile.call!, utteranceMergeMs: 850 } }
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '你可以登入網上服務繳費。' }] } })
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('playing') })
    b.emit({ type: 'final', text: '我已經試過網上繳費。' })
    b.emit({ type: 'speech-start' })
    expect(b.requests[0]!.signal.aborted).toBe(false)
    b.emit({ type: 'partial', text: '但係' })
    b.requests[0]!.result.resolve({ decision: 'interrupt' })
    await Promise.resolve()
    expect(b.requests[0]!.signal.aborted).toBe(true)
    expect(b.cancel).not.toHaveBeenCalled()
    b.emit({ type: 'final', text: '但係仍然交唔到。' })
    expect(b.classify.mock.calls[1]?.[0].text).toBe('我已經試過網上繳費。\n但係仍然交唔到。')
    b.requests[1]!.result.resolve({ decision: 'interrupt' })
    await vi.waitFor(() => { expect(b.cancel).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) }, { timeout: 1500 })
    expect(b.prompt.mock.calls[1]?.[0]).toEqual([{ type: 'text', text: '我已經試過網上繳費。\n但係仍然交唔到。' }])
    await b.call.stop()
  })

  it.each(['mute', 'manual', 'hangup'] as const)('discards a late semantic acceptance after %s', async (action) => {
    const b = semanticBench()
    await ask(b)
    b.finish('你可以登入網上服務繳費。')
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('playing') })
    b.emit({ type: 'final', text: 'What if I do not have an account?' })
    let stopping: Promise<void> | undefined
    if (action === 'mute') b.call.setMuted(true)
    else if (action === 'manual') b.call.interrupt()
    else stopping = b.call.stop()
    expect(b.requests[0]!.signal.aborted).toBe(true)
    b.requests[0]!.result.resolve({ decision: 'interrupt' })
    await stopping
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(b.prompt).toHaveBeenCalledOnce()
    if (action === 'mute') expect(b.cancel).not.toHaveBeenCalled()
    await b.call.stop()
  })

  it('keeps playback on classifier timeout or transport failure', async () => {
    vi.useFakeTimers()
    const b = semanticBench()
    try {
      await ask(b)
      b.finish('你可以登入網上服務繳費。')
      await vi.advanceTimersByTimeAsync(0)
      b.emit({ type: 'final', text: '我已經試過網上繳費。' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(b.requests[0]!.signal.aborted).toBe(true)
      b.requests[0]!.result.resolve({ decision: 'interrupt' })
      await vi.advanceTimersByTimeAsync(0)
      expect(b.cancel).not.toHaveBeenCalled()
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'final', text: '但係仍然交唔到。' })
      b.requests[1]!.result.reject(new Error('network unavailable'))
      await vi.advanceTimersByTimeAsync(0)
      expect(b.cancel).not.toHaveBeenCalled()
      expect(b.call.getSnapshot().phase).toBe('playing')
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('accepts a late verdict as the next question when the old playback has finished', async () => {
    const b = semanticBench()
    await ask(b)
    b.finish('你可以登入網上服務繳費。')
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('playing') })
    b.emit({ type: 'final', text: 'What if I do not have an account?' })
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    b.cancel.mockClear()
    b.requests[0]!.result.resolve({ decision: 'interrupt' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    expect(b.cancel).not.toHaveBeenCalled()
    expect(b.prompt.mock.calls[1]?.[0]).toEqual([{ type: 'text', text: 'What if I do not have an account?' }])
    await b.call.stop()
  })

  it.each(['timeout', 'hangup'] as const)('settles the HTTP classifier through abort on %s', async (end) => {
    vi.useFakeTimers()
    const b = semanticBench()
    const aborted = vi.fn()
    const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) throw new Error('The classifier request requires cancellation')
      signal.throwIfAborted()
      signal.addEventListener('abort', () => { aborted(); reject(new DOMException('Request aborted', 'AbortError')) }, { once: true })
    }))
    const webClient = createWebVoiceClient(fetcher)
    b.classify.mockImplementation(webClient.classifyInterruption!.bind(webClient))
    try {
      await ask(b)
      b.finish('你可以登入網上服務繳費。')
      await vi.advanceTimersByTimeAsync(0)
      b.stopPlayback.mockClear()
      b.emit({ type: 'final', text: '我已經試過網上繳費。' })
      expect(fetcher).toHaveBeenCalledOnce()
      if (end === 'timeout') {
        await vi.advanceTimersByTimeAsync(1000)
        expect(aborted).toHaveBeenCalledOnce()
        expect(b.stopPlayback).not.toHaveBeenCalled()
        expect(b.call.getSnapshot().phase).toBe('playing')
      }
      await b.call.stop()
      expect(aborted).toHaveBeenCalledOnce()
      expect(b.call.getSnapshot().phase).toBe('idle')
      expect(b.close).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('compares a stop with audible sentences rather than queued answer text', async () => {
    const b = semanticBench()
    await ask(b)
    b.finish('請準備帳單。你可以先停一下再操作。')
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    b.stopPlayback.mockClear()
    b.emit({ type: 'final', text: '停一下' })
    expect(b.classify).not.toHaveBeenCalled()
    expect(b.stopPlayback).toHaveBeenCalled()
    await b.call.stop()
  })

  it('gives the classifier only the current and previous audible sentences', async () => {
    const b = semanticBench()
    await ask(b)
    b.finish('第一句已播放。第二句正在播放。第三句正在播放。第四句仍在佇列。')
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    b.emit({ type: 'final', text: '我想問另外一個繳費問題。' })
    expect(b.classify.mock.calls[0]?.[0].playback).toBe('第一句已播放。')
    b.requests[0]!.result.resolve({ decision: 'continue' })
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(2) })
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(3) })
    b.emit({ type: 'speech-start' })
    b.emit({ type: 'final', text: '但係我冇網上戶口。' })
    expect(b.classify.mock.calls[1]?.[0].playback).toBe('第二句正在播放。 第三句正在播放。')
    b.requests[1]!.result.resolve({ decision: 'continue' })
    await b.call.stop()
  })

  it('mutes outgoing PCM and discards an unfinished utterance without stopping answer playback', async () => {
    const b = liveBench()
    b.call.start(b.liveProfile)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.capture).toHaveBeenCalledOnce() })
    b.frame()
    await vi.waitFor(() => { expect(b.send).toHaveBeenCalledOnce() })
    b.emit({ type: 'partial', text: '不應提交' })
    b.call.setMuted(true)
    b.frame()
    b.emit({ type: 'final', text: '不應提交' })
    expect(b.call.getSnapshot()).toMatchObject({ muted: true, transcript: '' })
    expect(b.send).toHaveBeenCalledOnce()
    expect(b.prompt).not.toHaveBeenCalled()
    b.call.setMuted(false)
    b.emit({ type: 'final', text: '延遲的舊結果' })
    expect(b.prompt).not.toHaveBeenCalled()
    b.emit({ type: 'speech-start' })
    b.emit({ type: 'final', text: '恢復後的新問題' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    expect(b.prompt).toHaveBeenCalledWith([{ type: 'text', text: '恢復後的新問題' }], 'queue')
    await b.call.stop()
    expect(b.close).toHaveBeenCalledOnce()
  })

  it('manually interrupts an owned answer and retains the recognition connection', async () => {
    const b = liveBench()
    await ask(b)
    b.emit({ type: 'partial', text: '好的' })
    b.call.interrupt()
    await vi.waitFor(() => { expect(b.cancel).toHaveBeenCalledOnce() })
    expect(b.close).not.toHaveBeenCalled()
    expect(b.call.getSnapshot().phase).toBe('listening')
    b.emit({ type: 'final', text: '換一個問題' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    await b.call.stop()
    b.call.interrupt()
    b.call.setMuted(true)
    expect(b.call.getSnapshot().phase).toBe('idle')
  })

  it.each([
    { partial: false, text: '停一下' },
    { partial: true, text: '停一下' },
    { partial: false, text: 'Please stop.' },
    { partial: true, text: 'Please stop.' },
  ])('stops without prompting for $text (confirmed partial: $partial)', async ({ partial, text }) => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      await ask(b)
      b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '請準備最近一期帳單。' }] } })
      await vi.advanceTimersByTimeAsync(0)
      b.emit({ type: 'speech-start' })
      if (partial) {
        b.emit({ type: 'partial', text })
        await vi.advanceTimersByTimeAsync(420)
        expect(b.cancel).toHaveBeenCalledOnce()
      }
      b.emit({ type: 'final', text })
      await vi.advanceTimersByTimeAsync(20)
      expect(b.cancel).toHaveBeenCalledOnce()
      expect(b.prompt).toHaveBeenCalledOnce()
      expect(b.call.getSnapshot()).toMatchObject({ phase: 'listening', transcript: '' })
      expect(b.call.getSnapshot().messages.some(message => message.speaker === 'user' && message.text === text)).toBe(false)
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'final', text: '上個月帳單要點查' })
      await vi.advanceTimersByTimeAsync(10)
      expect(b.prompt).toHaveBeenCalledTimes(2)
      expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '上個月帳單要點查' }], 'queue')
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('clears a queued correction when a stop command arrives before cancellation settles', async () => {
    vi.useFakeTimers()
    const b = liveBench()
    const settle = b.cancel.getMockImplementation()!
    const cancelled = deferred<undefined>()
    b.cancel.mockImplementationOnce(async () => { await cancelled.promise; return await settle() })
    try {
      await ask(b)
      b.emit({ type: 'final', text: '停一下，我想查上個月帳單' })
      await vi.advanceTimersByTimeAsync(10)
      expect(b.cancel).toHaveBeenCalledOnce()
      expect(b.prompt).toHaveBeenCalledOnce()
      b.emit({ type: 'final', text: '停一下' })
      cancelled.resolve(undefined)
      await vi.advanceTimersByTimeAsync(100)
      expect(b.call.getSnapshot().phase).toBe('listening')
      expect(b.prompt).toHaveBeenCalledOnce()
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'final', text: '如何申請用電' })
      await vi.advanceTimersByTimeAsync(10)
      expect(b.prompt).toHaveBeenCalledTimes(2)
      expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '如何申請用電' }], 'queue')
    } finally { cancelled.resolve(undefined); await b.call.stop(); vi.useRealTimers() }
  })

  it('coalesces queued audio without accumulating latency when uploads take longer than a microphone frame', async () => {
    vi.useFakeTimers()
    const b = liveBench()
    b.send.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 250)) })
    try {
      b.call.start(b.liveProfile)
      b.playback()!.onEnded()
      await vi.advanceTimersByTimeAsync(0)
      for (let i = 0; i < 80; i++) {
        b.frame(i)
        await vi.advanceTimersByTimeAsync(100)
      }
      await vi.advanceTimersByTimeAsync(500)
      expect(b.call.getSnapshot().phase).not.toBe('error')
      const sizes = b.send.mock.calls.map(([pcm]) => pcm.byteLength)
      expect(sizes.reduce((total, size) => total + size, 0)).toBe(80 * 3200)
      expect(sizes.some(size => size > 3200)).toBe(true)
      expect(sizes.every(size => size <= 64000 && size % 3200 === 0)).toBe(true)
      const frames = b.send.mock.calls.flatMap(([pcm]) => Array.from({ length: pcm.byteLength / 3200 }, (_, index) => pcm[index * 3200]))
      expect(frames).toEqual(Array.from({ length: 80 }, (_, index) => index))
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('recovers from a transient upload stall while keeping each request within the two-second carrier limit', async () => {
    const b = liveBench()
    const stalled = deferred<undefined>()
    b.send.mockImplementationOnce(async () => { await stalled.promise })
    b.call.start(b.liveProfile)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.capture).toHaveBeenCalledOnce() })
    for (let i = 0; i < 40; i++) b.frame(i)
    expect(b.call.getSnapshot().phase).not.toBe('error')
    stalled.resolve(undefined)
    await vi.waitFor(() => { expect(b.send).toHaveBeenCalledTimes(3) })
    const sizes = b.send.mock.calls.map(([pcm]) => pcm.byteLength)
    expect(sizes).toEqual([3200, 64000, 60800])
    expect(b.call.getSnapshot().phase).not.toBe('error')
    await b.call.stop()
  })

  it('retains the configured total backlog bound when an audio upload stalls', async () => {
    const b = liveBench()
    const stalled = deferred<undefined>()
    b.send.mockImplementation(async () => { await stalled.promise })
    b.call.start(b.liveProfile)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.capture).toHaveBeenCalledOnce() })
    for (let i = 0; i < 81; i++) b.frame()
    stalled.resolve(undefined)
    await vi.waitFor(() => { expect(b.call.getSnapshot()).toMatchObject({ phase: 'error', error: '語音網絡連接過慢，請重新接通。' }) })
    expect(b.send).toHaveBeenCalledOnce()
    expect(b.close).toHaveBeenCalledOnce()
    await b.call.stop()
  })

  it('preloads the selected greeting and plays it synchronously without a model request', async () => {
    const b = liveBench()
    const configured = { ...b.liveProfile, call: { ...b.liveProfile.call!, greetings: {
      ...b.liveProfile.call!.greetings, en: { text: 'Hello!', url: '/api/speech/greeting?language=en' },
    } } }
    b.call.prepareGreeting(configured, 'en')
    expect(b.platform.prepare).toHaveBeenCalledOnce()
    expect(b.platform.play).not.toHaveBeenCalled()
    b.call.start(configured, 'en')
    expect(b.platform.prepare).toHaveBeenCalledOnce()
    expect(b.platform.play).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/speech/greeting?language=en', playbackRate: 1.15 }), expect.anything(), expect.any(AbortSignal))
    expect(b.call.getSnapshot()).toMatchObject({ phase: 'playing', answer: 'Hello!' })
    expect(b.prompt).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(b.platform.capture).toHaveBeenCalledOnce() })
    expect(b.prompt).not.toHaveBeenCalled()
    b.frame()
    b.emit({ type: 'speech-start' })
    b.emit({ type: 'partial', text: 'Hello' })
    b.emit({ type: 'final', text: 'Hello!' })
    expect(b.send).not.toHaveBeenCalled()
    expect(b.stopPlayback).not.toHaveBeenCalled()
    expect(b.prompt).not.toHaveBeenCalled()
    expect(b.call.getSnapshot()).toMatchObject({ phase: 'playing', transcript: '', answer: 'Hello!' })
    b.playback()!.onEnded()
    expect(b.call.getSnapshot().phase).toBe('listening')
    b.frame(7)
    await vi.waitFor(() => { expect(b.send).toHaveBeenCalledWith(new Uint8Array(3200).fill(7)) })
    b.emit({ type: 'final', text: '查电费账单' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '查电费账单' }], 'queue')
    b.finish()
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(2) })
    await b.call.stop()
    expect(b.close).toHaveBeenCalledOnce()
    expect(b.listeners.size).toBe(0)
  })

  it('admits a question arriving during microphone setup without queuing a model greeting', async () => {
    const b = liveBench()
    ;(b.platform as VoicePlatform).capture = vi.fn(async () => {
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'final', text: '我想問電費' })
      return { close: b.close }
    })
    b.call.start(b.liveProfile)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '我想問電費' }], 'queue')
    await b.call.stop()
  })

  it('keeps adjacent final segments in one visible and durable user message', async () => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      b.call.start(b.liveProfile)
      b.playback()!.onEnded()
      await vi.advanceTimersByTimeAsync(0)
      expect(b.platform.capture).toHaveBeenCalledOnce()
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'partial', text: '我想查电费' })
      b.emit({ type: 'final', text: '我想查电费' })
      expect(b.call.getSnapshot()).toMatchObject({ phase: 'transcribing', transcript: '我想查电费' })
      await vi.advanceTimersByTimeAsync(5)
      expect(b.prompt).not.toHaveBeenCalled()
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'partial', text: '还想问缴费方式' })
      expect(b.call.getSnapshot()).toMatchObject({ phase: 'listening', transcript: '我想查电费\n还想问缴费方式' })
      b.emit({ type: 'final', text: '还想问缴费方式' })
      await vi.advanceTimersByTimeAsync(9)
      expect(b.prompt).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(b.prompt).toHaveBeenCalledOnce()
      expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '我想查电费\n还想问缴费方式' }], 'queue')
    } finally {
      await b.call.stop()
      vi.useRealTimers()
    }
  })

  it('can hang up or report provider failure during the protected greeting', async () => {
    for (const failure of [false, true]) {
      const b = liveBench()
      b.call.start(b.liveProfile)
      await vi.waitFor(() => { expect(b.platform.capture).toHaveBeenCalledOnce() })
      if (failure) {
        b.emit({ type: 'error', message: 'recognizer disconnected' })
        await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('error') })
      }
      await b.call.stop()
      expect(b.stopPlayback).toHaveBeenCalled()
      expect(b.close).toHaveBeenCalledOnce()
      expect(b.prompt).not.toHaveBeenCalled()
      expect(b.call.getSnapshot().phase).toBe('idle')
    }
  })

  it('ignores wordless onset and submits a confirmed correction without repeating the interrupted question', async () => {
    const b = liveBench()
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '請準備帳單。' }] } })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    b.emit({ type: 'speech-start' })
    b.emit({ type: 'partial', text: ' ' })
    expect(b.cancel).not.toHaveBeenCalled()
    expect(b.call.getSnapshot()).toMatchObject({ phase: 'playing', answer: '請準備帳單。' })
    b.emit({ type: 'final', text: '停一下，我想查上個月帳單' })
    await vi.waitFor(() => { expect(b.cancel).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '停一下，我想查上個月帳單' }], 'queue')
    expect(b.call.getSnapshot().messages.map(({ text }) => text)).toEqual(['你好。', '账单怎么查', '請準備帳單。', '停一下，我想查上個月帳單'])
    expect(b.call.getSnapshot().messages[2]?.status).toBe('interrupted')
    b.finish('可以查詢上個月的帳單。')
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(2) })
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    b.emit({ type: 'final', text: '如何申請用電' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(3) })
    expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '如何申請用電' }], 'queue')
    await b.call.stop()
    expect(b.call.getSnapshot().messages[0]?.text).toBe('你好。')
  })

  it('keeps speaking through an initial partial and interrupts after the configured intent confirmation time', async () => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      await ask(b)
      b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '請先準備最近一期帳單。' }] } })
      await vi.advanceTimersByTimeAsync(0)
      expect(b.platform.play).toHaveBeenCalledOnce()
      b.emit({ type: 'speech-start' })
      await vi.advanceTimersByTimeAsync(300)
      b.emit({ type: 'partial', text: '停一下' })
      await vi.advanceTimersByTimeAsync(419)
      expect(b.cancel).not.toHaveBeenCalled()
      expect(b.call.getSnapshot().phase).toBe('playing')
      await vi.advanceTimersByTimeAsync(1)
      await vi.waitFor(() => { expect(b.cancel).toHaveBeenCalledOnce() })
      expect(b.call.getSnapshot().phase).toBe('listening')
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('keeps the answer playing and discards passive acknowledgements and recognized playback echo', async () => {
    const b = liveBench()
    await ask(b)
    const answer = '您可以透過澳電網上服務申請住宅供電。'
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: answer }] } })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    for (const text of ['嗯嗯', '可以透過澳電網上服務申請住宅供電']) {
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'partial', text })
      b.emit({ type: 'final', text })
      expect(b.call.getSnapshot()).toMatchObject({ phase: 'playing', transcript: '账单怎么查' })
      expect(b.call.getSnapshot().messages.some(message => message.text === text)).toBe(false)
    }
    expect(b.cancel).not.toHaveBeenCalled()
    expect(b.prompt).toHaveBeenCalledOnce()
    await b.call.stop()
  })

  it.each(['thinking', 'generating', 'playing'] as const)('ignores acknowledgements and background chatter throughout %s', async (phase) => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      await ask(b)
      if (phase === 'generating') b.setAutoPlaying(false)
      if (phase !== 'thinking') {
        b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '請準備最近一期帳單。' }] } })
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(b.call.getSnapshot().phase).toBe(phase)
      const messages = b.call.getSnapshot().messages
      for (const text of ['好的', '係呀係呀', 'Where is my phone?', '今天天氣真好', '我想查電費']) {
        b.emit({ type: 'speech-start' })
        b.emit({ type: 'partial', text })
        expect(b.call.getSnapshot().messages).toEqual(messages)
        b.emit({ type: 'final', text })
        expect(b.call.getSnapshot().phase).toBe(phase)
        expect(b.call.getSnapshot().messages).toEqual(messages)
      }
      await vi.advanceTimersByTimeAsync(500)
      expect(b.cancel).not.toHaveBeenCalled()
      expect(b.prompt).toHaveBeenCalledOnce()
      expect(b.call.getSnapshot().phase).toBe(phase)
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it.each(['thinking', 'generating'] as const)('accepts a clear stop request during %s', async (phase) => {
    const b = liveBench()
    await ask(b)
    if (phase === 'generating') {
      b.setAutoPlaying(false)
      b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '請準備帳單。' }] } })
      await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('generating') })
    }
    b.emit({ type: 'final', text: '停一下，我想查上個月帳單' })
    await vi.waitFor(() => { expect(b.cancel).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '停一下，我想查上個月帳單' }], 'queue')
    await b.call.stop()
  })

  it.each([false, true])('screens a final whose onset preceded playback completion (partial: %s)', async (partial) => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      await ask(b)
      b.finish('請準備最近一期帳單。')
      await vi.advanceTimersByTimeAsync(0)
      expect(b.call.getSnapshot().phase).toBe('playing')
      b.emit({ type: 'speech-start' })
      if (partial) b.emit({ type: 'partial', text: '好的' })
      b.playback()!.onEnded()
      await vi.advanceTimersByTimeAsync(0)
      expect(b.call.getSnapshot().phase).toBe('listening')
      b.emit({ type: 'final', text: '好的' })
      await vi.advanceTimersByTimeAsync(500)
      expect(b.prompt).toHaveBeenCalledOnce()
      expect(b.cancel).not.toHaveBeenCalled()
      expect(b.call.getSnapshot().messages.some(message => message.text === '好的')).toBe(false)
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'final', text: '如何申請用電' })
      await vi.advanceTimersByTimeAsync(10)
      expect(b.prompt).toHaveBeenCalledTimes(2)
      expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '如何申請用電' }], 'queue')
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('clears pending interruption confirmation when the microphone is muted', async () => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      await ask(b)
      b.finish('請準備最近一期帳單。')
      await vi.advanceTimersByTimeAsync(0)
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'partial', text: '停一下' })
      b.call.setMuted(true)
      b.call.setMuted(false)
      b.emit({ type: 'final', text: '停一下，我想查上個月帳單' })
      await vi.advanceTimersByTimeAsync(500)
      expect(b.call.getSnapshot()).toMatchObject({ phase: 'playing', transcript: '', muted: false })
      expect(b.call.getSnapshot().messages.some(message => message.text.includes('停一下'))).toBe(false)
      expect(b.prompt).toHaveBeenCalledOnce()
      expect(b.cancel).not.toHaveBeenCalled()
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'final', text: '好的' })
      await vi.advanceTimersByTimeAsync(500)
      expect(b.call.getSnapshot().phase).toBe('playing')
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('retains the completed answer as echo context for a late recognizer final', async () => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      await ask(b)
      b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '資料包括' }] } })
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'partial', text: '唔係' })
      b.finish('資料包括唔係，我想問繳費方式。')
      await vi.advanceTimersByTimeAsync(0)
      expect(b.platform.play).toHaveBeenCalledOnce()
      b.playback()!.onEnded()
      await vi.advanceTimersByTimeAsync(0)
      expect(b.call.getSnapshot().phase).toBe('listening')
      b.emit({ type: 'final', text: '唔係，我想問繳費方式' })
      await vi.advanceTimersByTimeAsync(500)
      expect(b.prompt).toHaveBeenCalledOnce()
      expect(b.cancel).not.toHaveBeenCalled()
      expect(b.call.getSnapshot().messages.filter(message => message.speaker === 'user')).toHaveLength(1)
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('discards an abandoned stop hypothesis when its final transcript is empty', async () => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      await ask(b)
      b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '請準備最近一期帳單。' }] } })
      await vi.advanceTimersByTimeAsync(0)
      b.emit({ type: 'speech-start' })
      b.emit({ type: 'partial', text: '停一下' })
      b.emit({ type: 'final', text: ' ' })
      await vi.advanceTimersByTimeAsync(500)
      expect(b.call.getSnapshot().phase).toBe('playing')
      expect(b.call.getSnapshot().messages.some(message => message.text === '停一下')).toBe(false)
      expect(b.cancel).not.toHaveBeenCalled()
      expect(b.prompt).toHaveBeenCalledOnce()
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('collects several supplemental segments while cancellation is settling', async () => {
    const b = liveBench()
    const settle = b.cancel.getMockImplementation()!
    const cancelled = deferred<undefined>()
    b.cancel.mockImplementationOnce(async () => { await cancelled.promise; return await settle() })
    await ask(b)
    b.emit({ type: 'final', text: '停一下，上個月的' })
    await vi.waitFor(() => { expect(b.cancel).toHaveBeenCalledOnce() })
    await new Promise(resolve => setTimeout(resolve, 20))
    b.emit({ type: 'final', text: '還有繳費方式' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(b.prompt).toHaveBeenCalledOnce()
    cancelled.resolve(undefined)
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '停一下，上個月的\n還有繳費方式' }], 'queue')
    await b.call.stop()
  })

  it('does not strand finalized words when a noise onset has no transcription', async () => {
    vi.useFakeTimers()
    const b = liveBench()
    try {
      b.call.start(b.liveProfile)
      b.playback()!.onEnded()
      await vi.advanceTimersByTimeAsync(0)
      b.emit({ type: 'final', text: '账单怎么查' })
      await vi.advanceTimersByTimeAsync(5)
      b.emit({ type: 'speech-start' })
      await vi.advanceTimersByTimeAsync(10)
      expect(b.prompt).toHaveBeenCalledOnce()
    } finally { await b.call.stop(); vi.useRealTimers() }
  })

  it('cancels an unfinished answer before admitting the interrupting question and suppresses late synthesis', async () => {
    const b = liveBench()
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '你好。' }] } })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    b.emit({ type: 'speech-start' })
    b.emit({ type: 'final', text: '停一下，我想换个问题' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    expect(b.cancel).toHaveBeenCalledOnce()
    expect(b.client.synthesizeSentence).toHaveBeenCalledOnce()
    await b.call.stop()
    expect(b.cancel).toHaveBeenCalledTimes(2)
  })

  it('terminates continuous capture on a provider error', async () => {
    const b = liveBench()
    await ask(b)
    b.emit({ type: 'error', message: 'recognizer disconnected' })
    await vi.waitFor(() => { expect(b.call.getSnapshot()).toMatchObject({ phase: 'error', error: 'recognizer disconnected' }) })
    expect(b.close).toHaveBeenCalledOnce()
    expect(b.cancel).toHaveBeenCalledOnce()
  })

  it('waits for cancellation to reach idle before submitting the interrupting question', async () => {
    const b = liveBench()
    const settle = b.cancel.getMockImplementation()!
    b.cancel.mockImplementation(async () => ({ ok: true as const, value: { accepted: true as const } }))
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '你好。' }] } })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    b.emit({ type: 'speech-start' })
    b.emit({ type: 'final', text: '停一下，我要查账单' })
    await vi.waitFor(() => { expect(b.cancel).toHaveBeenCalledOnce() })
    expect(b.prompt).toHaveBeenCalledOnce()
    await settle()
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    b.finish()
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(2) })
    await b.call.stop()
  })

  it('discards reply synthesis that arrives after hangup', async () => {
    const b = liveBench()
    const pending = deferred<{ url: string }>()
    b.client.synthesizeSentence.mockImplementation(async () => pending.promise)
    await ask(b)
    b.finish()
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledOnce() })
    const stopped = b.call.stop()
    pending.resolve({ url: '/stale.mp3' })
    await stopped
    expect(b.platform.play).not.toHaveBeenCalled()
  })

  it('leaves competing user work running when it ends the call', async () => {
    const b = liveBench()
    await ask(b)
    b.update({ nodes: [{ kind: 'user', seq: 99, time: 0, source: null, content: [{ type: 'text', text: '另一位用户的消息' }] }] })
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('error') })
    expect(b.cancel).not.toHaveBeenCalled()
    expect(b.close).toHaveBeenCalledOnce()
  })


  it('prepares one next sentence after the current sentence becomes audible without replaying it after commit', async () => {
    const b = liveBench()
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '第一句。第二句' }] } })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    expect(b.call.getSnapshot().answer).toBe('第一句。第二句')
    expect(b.client.synthesizeSentence).toHaveBeenCalledWith(expect.objectContaining({ prefix: '第一句。', start: 0 }), expect.any(AbortSignal))
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '第一句。第二句完成。' }] } })
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledTimes(2) })
    expect(b.platform.play).toHaveBeenCalledOnce()
    b.finish('第一句。第二句完成。')
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(2) })
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    expect(b.client.synthesizeSentence).toHaveBeenCalledTimes(2)
    await b.call.stop()
  })

  it('does not prepare the next sentence before the current sentence is audible', async () => {
    const b = liveBench()
    b.setAutoPlaying(false)
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '第一句。第二句。' }] } })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    expect(b.client.synthesizeSentence).toHaveBeenCalledOnce()
    b.playback()!.onPlaying()
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledTimes(2) })
    b.finish('第一句。第二句。')
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(2) })
    b.playback()!.onPlaying()
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    await b.call.stop()
  })

  it('starts synthesis at a comma-like pause only after the configured minimum', async () => {
    const b = liveBench()
    await ask(b)
    b.platform.play.mockClear()
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '你好，請先準備最近一期賬單、' }] } })
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledOnce() })
    expect(b.client.synthesizeSentence).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: '你好，請先準備最近一期賬單、', start: 0 }), expect.any(AbortSignal),
    )
    b.finish('你好，請先準備最近一期賬單、再核對合約資料。')
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledTimes(2) })
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(2) })
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    await b.call.stop()
  })

  it('keeps internal synthesis segments on one natural caption line', async () => {
    const b = liveBench()
    const answer = 'You can pay your charging fees by topping up your CEM App wallet, or by using a Visa, Mastercard or UnionPay credit card for a one-time payment'
    const configured = { ...b.liveProfile, call: {
      ...b.liveProfile.call!, sentenceMaxChars: 90, sentencePauseMinChars: 40,
    } }
    b.call.start(configured)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.capture).toHaveBeenCalledOnce() })
    b.platform.play.mockClear()
    b.emit({ type: 'final', text: 'How can I pay?' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: answer }] } })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    b.finish(answer)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(2) })
    expect(b.call.getSnapshot().answer).toBe(answer)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    await b.call.stop()
  })

  it('treats a generated newline as layout until the spoken sentence finishes', async () => {
    const b = liveBench()
    await ask(b)
    b.platform.play.mockClear()
    const answer = 'Pay through the CEM App\nwallet for a one-time payment.'
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: answer }] } })
    expect(b.client.synthesizeSentence).not.toHaveBeenCalled()
    b.finish(answer)
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    expect(b.client.synthesizeSentence).toHaveBeenCalledOnce()
    expect(b.call.getSnapshot().answer).toBe('Pay through the CEM App wallet for a one-time payment.')
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    await b.call.stop()
  })

  it('does not send a trailing emoji to sentence synthesis', async () => {
    const b = liveBench()
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '可以呀！😊' }] } })
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    b.finish('可以呀！😊')
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    expect(b.client.synthesizeSentence).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: '可以呀！', start: 0 }), expect.any(AbortSignal),
    )
    expect(b.client.synthesizeSentence).toHaveBeenCalledOnce()
    await b.call.stop()
  })

  it('keeps recognition alive when sentence synthesis fails', async () => {
    const b = liveBench()
    b.client.synthesizeSentence.mockRejectedValueOnce(new Error('TTS stream disconnected'))
    await ask(b)
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '第一句。' }] } })
    await vi.waitFor(() => {
      expect(b.call.getSnapshot()).toMatchObject({
        phase: 'generating', answer: '第一句。',
        error: '語音播報暫時失敗，通話仍可繼續。TTS stream disconnected',
      })
    })
    b.finish('第一句。')
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    expect(b.close).not.toHaveBeenCalled()
    b.emit({ type: 'final', text: '繼續查詢' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    expect(b.call.getSnapshot().error).toBeUndefined()
    await b.call.stop()
  })

  it('falls back before audio begins and keeps the working profile for the call', async () => {
    const b = liveBench()
    const configured = { ...b.liveProfile, call: {
      ...b.liveProfile.call!, fallbackSynthesisProfile: 'tts-fallback',
    } }
    b.call.start(configured)
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.platform.capture).toHaveBeenCalledOnce() })
    b.platform.play.mockClear()
    b.setAutoPlaying(false)
    b.emit({ type: 'final', text: '第一個問題' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    b.update({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: '第一句。' }] } })
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledOnce() })
    expect(b.call.getSnapshot()).toMatchObject({ phase: 'generating', answer: '第一句。' })
    b.playback()!.onError(new Error('company stream stalled'))
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledTimes(2) })
    expect(b.client.synthesizeSentence.mock.calls[0]?.[0].profile).toBe('tts')
    expect(b.client.synthesizeSentence.mock.calls[1]?.[0].profile).toBe('tts-fallback')
    b.playback()!.onPlaying()
    b.finish('第一句。')
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })

    b.emit({ type: 'final', text: '第二個問題' })
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(2) })
    b.update({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: '第二句。' }] } })
    await vi.waitFor(() => { expect(b.client.synthesizeSentence).toHaveBeenCalledTimes(3) })
    await vi.waitFor(() => { expect(b.platform.play).toHaveBeenCalledTimes(3) })
    expect(b.client.synthesizeSentence.mock.calls[2]?.[0].profile).toBe('tts-fallback')
    b.playback()!.onPlaying()
    b.finish('第二句。')
    b.playback()!.onEnded()
    await vi.waitFor(() => { expect(b.call.getSnapshot().phase).toBe('listening') })
    await b.call.stop()
  })

})
