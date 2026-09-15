/** Continuous microphone calls with interruptible answers over the durable text Session. */

import { VoiceSentenceQueue } from './sentences.ts'
import { CallTranscript } from './call-transcript.ts'
import { classifyInterruption } from './interruption.ts'
import type { CallTranscriptEntry } from './call-transcript.ts'
import type { AssistantBlock, AssistantMessageNode, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SpeechProfile, VoiceClient, VoicePlatform } from './contract.ts'

/** Transient call presentation; transcripts themselves belong to the Session. */
export interface VoiceCallView {
  readonly phase: 'idle' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'generating' | 'playing' | 'ending' | 'error'
  readonly transcript: string
  readonly answer: string
  /** Current-call text, including the opening and interrupted replies; cleared on the next call. */
  readonly messages: readonly CallTranscriptEntry[]
  readonly error?: string
  /** True only when the caller explicitly suppresses microphone upload. */
  readonly muted?: boolean
}

type SpokenAnswer = AssistantMessageNode & { messageId: MessageId }

const PCM_FRAME_MS = 100
const PCM_FRAME_BYTES = 3200
const MAX_UPLOAD_FRAMES = 20

/** Render generated text without exposing model layout as telephone-caption pauses. */
function answerCaption(blocks: readonly AssistantBlock[]): string {
  return blocks
    .flatMap(block => block.kind === 'text' ? [block.text] : [])
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Preserve completed recognizer segments while the caller continues the same message. */
function appendUtteranceSegment(current: string, segment: string): string {
  const text = segment.trim()
  if (text === '') return current
  return current === '' ? text : `${current}\n${text}`
}

/** One microphone/playback lifetime and one submitted turn at a time. */
export class VoiceCallController implements HostObservable<VoiceCallView> {
  private view: VoiceCallView = { phase: 'idle', transcript: '', answer: '', messages: [] }
  private readonly transcript = new CallTranscript()
  private readonly listeners = new Set<() => void>()
  private operation: { abort: AbortController; done: Promise<void> } | undefined
  private ownsTurn = false
  private controls: { interrupt(): void; mute(muted: boolean): void } | undefined
  private greeting: { key: string; text: string; abort: AbortController; media: ReturnType<NonNullable<VoicePlatform['prepare']>> } | undefined

  /**
   * Preload the selected fixed greeting.
   * @param profile - authorized call options.
   * @param language - selected response language.
   */
  prepareGreeting(profile: SpeechProfile, language?: string): void {
    if (this.operation !== undefined || profile.call === undefined || this.platform.prepare === undefined) return
    const options = profile.call
    const greeting = options.greetings[language ?? ''] ?? options.greetings[options.defaultGreeting]
    if (greeting === undefined) throw new Error('Call greeting is unavailable')
    const key = JSON.stringify([greeting.url, greeting.text, options.playbackRate])
    if (this.greeting?.key === key) return
    this.greeting?.abort.abort()
    const abort = new AbortController()
    this.greeting = { key, text: greeting.text, abort,
      media: this.platform.prepare({ url: greeting.url, playbackRate: options.playbackRate }, abort.signal) }
  }

  /** @param session - ordinary conversation. @param client - speech transport. @param platform - browser media operations. */
  constructor(private readonly session: SessionFace, private readonly client: VoiceClient, private readonly platform: VoicePlatform) {}

  /** @returns identity-stable call presentation. */
  getSnapshot(): VoiceCallView { return this.view }

  /** @param listener - presentation observer. @returns subscription disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Begin only on an idle Session with no queued input.
   * @param profile - authorized speech operations and call limits.
   * @param language - selected response language; automatic selection uses the configured greeting.
   */
  start(profile: SpeechProfile, language?: string): void {
    if (this.operation !== undefined) return
    const snapshot = this.session.getSnapshot()
    if (snapshot.running || snapshot.queue.length > 0 || snapshot.removed || snapshot.subagent !== null) return
    const { transcription, synthesis, call } = profile
    if (!transcription?.realtime || synthesis === undefined || call === undefined) return
    this.platform.unlock()
    this.prepareGreeting(profile, language)
    const greeting = this.greeting
    if (greeting === undefined) return
    this.greeting = undefined
    this.transcript.start(greeting.text)
    this.publish({ phase: 'connecting', transcript: '', answer: greeting.text })
    const abort = new AbortController()
    let opening = true
    let captureReady = false
    const stopOpening = (): void => { opening = false; greeting.abort.abort(); greeting.media.stop() }
    abort.signal.addEventListener('abort', stopOpening, { once: true })
    greeting.media.play({
      onPlaying: () => { if (opening) this.publish({ ...this.view, phase: 'playing' }) },
      onEnded: () => {
        stopOpening()
        if (this.view.phase === 'playing') this.publish({ ...this.view, phase: captureReady ? 'listening' : 'connecting' })
      },
      onError: (error) => {
        if (abort.signal.aborted) return
        this.publish({ ...this.view, phase: 'error', error: error instanceof Error ? error.message : String(error) })
        abort.abort()
      },
    })
    // Queue the loop after publishing its owner so synchronous failure cannot leave a stale operation.
    const done = Promise.resolve().then(async () => {
      try {
        await this.realtime(profile, abort.signal, () => opening, stopOpening, () => { captureReady = true })
      } catch (error) {
        if (!abort.signal.aborted) this.publish({ ...this.view, phase: 'error', error: error instanceof Error ? error.message : String(error) })
      } finally {
        abort.abort()
        if (this.ownsTurn) {
          try {
            const cancelled = await this.session.cancel()
            if (!cancelled.ok) throw new Error(cancelled.error.message)
          } catch (error) {
            this.publish({ ...this.view, phase: 'error', error: error instanceof Error ? error.message : String(error) })
          }
          this.ownsTurn = false
        }
        this.operation = undefined
        if (this.view.phase !== 'error') this.publish({ phase: 'idle', transcript: '', answer: '' })
      }
    })
    this.operation = { abort, done }
  }

  /** Stop media immediately and wait for any owned submitted turn to be cancelled. @returns quiescent call lifetime. */
  async stop(): Promise<void> {
    this.greeting?.abort.abort()
    this.greeting = undefined
    const operation = this.operation
    if (operation === undefined) {
      this.publish({ phase: 'idle', transcript: '', answer: '' })
      return
    }
    this.publish({ ...this.view, phase: 'ending' })
    operation.abort.abort(new DOMException('Call ended', 'AbortError'))
    await operation.done
  }

  /** Stop the current spoken answer while leaving recognition connected. */
  interrupt(): void {
    this.controls?.interrupt()
  }

  /**
   * Suppress outgoing microphone frames and discard any unfinished utterance.
   * @param muted - Desired microphone state.
   */
  setMuted(muted: boolean): void {
    this.controls?.mute(muted)
  }

  private async realtime(
    profile: SpeechProfile, signal: AbortSignal, opening: () => boolean, stopOpening: () => void, onReady: () => void,
  ): Promise<void> {
    signal.throwIfAborted()
    const { transcription, synthesis, call } = profile
    if (!transcription || !synthesis || !call || !this.client.listen || !this.platform.capture) {
      throw new Error('实时通话尚未配置完整，请重启服务后再试。')
    }
    const lifetime = new AbortController()
    const combined = AbortSignal.any([signal, lifetime.signal])
    let replyAbort: AbortController | undefined
    let pending: string[] = []
    let worker: Promise<void> | undefined
    let upload = Promise.resolve()
    let uploading = false
    let queuedAudio: Uint8Array[] = []
    let bufferedBytes = 0
    let captureReady = false
    let utterance = ''
    let utteranceTimer: ReturnType<typeof setTimeout> | undefined
    let interruptionTimer: ReturnType<typeof setTimeout> | undefined
    let interruptionStartedAt = 0
    let interruptionDuringPlayback = false
    let interruptionConfirmed = false
    let interruptionHypothesis = ''
    let muted = false
    let awaitSpeechStart = false
    let synthesisProfile = synthesis.profile
    let activeQuestion = ''
    let continuation = ''
    let fail!: (error: unknown) => void
    const maxPendingAudioBytes = call.maxPendingAudioMs / PCM_FRAME_MS * PCM_FRAME_BYTES
    const ended = new Promise<void>((resolve, reject) => {
      fail = (error) => { if (!combined.aborted) { reject(error instanceof Error ? error : new Error(String(error))); lifetime.abort() } }
      combined.addEventListener('abort', () => { resolve() }, { once: true })
      if (combined.aborted) resolve()
    })
    void ended.catch(() => { /* Capture setup may still be pending when the provider fails. */ })
    const cancelOwned = async (): Promise<void> => {
      if (!this.ownsTurn) return
      const result = await this.session.cancel()
      this.ownsTurn = false
      if (!result.ok) throw new Error(result.error.message)
      await this.waitIdle(call.responseTimeoutMs)
    }
    const interrupt = (): void => {
      stopOpening()
      if (replyAbort !== undefined && !replyAbort.signal.aborted) {
        continuation = activeQuestion
        this.transcript.interrupt()
      }
      replyAbort?.abort()
      this.publish({ phase: 'listening', transcript: this.view.transcript, answer: this.view.answer,
        ...(this.view.muted === undefined ? {} : { muted: this.view.muted }) })
    }
    this.controls = {
      interrupt,
      mute: (value) => {
        if (combined.aborted || muted === value) return
        muted = value
        awaitSpeechStart = true
        clearTimeout(utteranceTimer)
        utteranceTimer = undefined
        clearTimeout(interruptionTimer)
        interruptionTimer = undefined
        utterance = ''
        this.transcript.finishUtterance(false)
        pending = []
        bufferedBytes -= queuedAudio.reduce((size, frame) => size + frame.byteLength, 0)
        queuedAudio = []
        this.publish({ ...this.view, muted, transcript: '' })
      },
    }
    const drain = (): void => {
      if (!captureReady || worker || combined.aborted) return
      worker = (async () => {
        while (pending.length > 0 && !combined.aborted) {
          const text = appendUtteranceSegment(continuation, pending.splice(0).join('\n'))
          continuation = ''
          activeQuestion = text
          replyAbort = new AbortController()
          this.transcript.beginReply()
          const replySignal = AbortSignal.any([combined, replyAbort.signal])
          const generatedSteps = new Map<string, string>()
          let playbackFailure: Error | undefined
          const sentences = new VoiceSentenceQueue(
            this.session.sessionId, synthesisProfile, call.fallbackSynthesisProfile, call, this.client, this.platform,
            replySignal, () => {
              if (replySignal.aborted) return
              this.publish({ ...this.view, phase: 'playing' })
            }, (error) => {
              if (replySignal.aborted) return
              playbackFailure = error
              this.publish({ ...this.view,
                error: `語音播報暫時失敗，通話仍可繼續。${error.message}` })
            }, (profile) => { synthesisProfile = profile },
          )
          try {
            this.publish({ ...this.view, phase: 'thinking', answer: '' })
            await this.submit(text, replySignal, call.responseTimeoutMs, (turn, step, blocks, final) => {
              if (replySignal.aborted) return
              const key = `${turn}:${step}`
              const caption = answerCaption(blocks)
              if (caption === '') generatedSteps.delete(key)
              else generatedSteps.set(key, caption)
              const answer = [...generatedSteps.values()].join(' ').trim()
              this.transcript.answer(`assistant:${key}`, caption, final)
              this.publish({ ...this.view,
                phase: this.view.phase === 'playing' ? 'playing' : 'generating', answer })
              sentences.update(turn, step, blocks, final)
            })
            replySignal.throwIfAborted()
            try {
              await sentences.finish()
            } catch (error) {
              if (playbackFailure === undefined) throw error
            }
          } catch (error) {
            if (!replySignal.aborted) throw error
          } finally { await sentences.close(); await cancelOwned(); replyAbort = undefined }
          if (signal.aborted || lifetime.signal.aborted) break
          this.publish({ ...this.view, phase: 'listening' })
        }
      })().catch(fail).finally(() => { worker = undefined; if (pending.length > 0 && !combined.aborted) drain() })
    }
    const scheduleUtterance = (): void => {
      clearTimeout(utteranceTimer)
      utteranceTimer = undefined
      if (utterance === '') return
      utteranceTimer = setTimeout(() => {
        utteranceTimer = undefined
        const complete = utterance
        utterance = ''
        if (pending.length >= 16) { fail(new Error('语音问题积压，请重新接通。')); return }
        this.transcript.finishUtterance(true)
        pending.push(complete)
        drain()
      }, call.utteranceMergeMs)
    }
    const beginInterruptionCandidate = (): void => {
      clearTimeout(interruptionTimer)
      interruptionTimer = undefined
      interruptionStartedAt = Date.now()
      interruptionDuringPlayback = this.view.phase === 'playing'
      interruptionConfirmed = false
      interruptionHypothesis = ''
    }
    const confirmInterruption = (text: string, final: boolean): 'accepted' | 'ignored' | 'waiting' => {
      if (!interruptionDuringPlayback || interruptionConfirmed) return 'accepted'
      interruptionHypothesis = text
      const decision = classifyInterruption({
        text,
        answer: this.view.answer,
        final,
        elapsedMs: Date.now() - interruptionStartedAt,
      }, call.interruption)
      if (decision === 'interrupt') {
        clearTimeout(interruptionTimer)
        interruptionTimer = undefined
        interruptionConfirmed = true
        interrupt()
        return 'accepted'
      }
      if (decision === 'ignore') {
        clearTimeout(interruptionTimer)
        interruptionTimer = undefined
        return 'ignored'
      }
      if (interruptionTimer === undefined) {
        const delay = Math.max(0, call.interruption.confirmationMs - (Date.now() - interruptionStartedAt))
        interruptionTimer = setTimeout(() => {
          interruptionTimer = undefined
          if (!interruptionDuringPlayback || interruptionConfirmed || interruptionHypothesis === '') return
          const delayed = classifyInterruption({
            text: interruptionHypothesis,
            answer: this.view.answer,
            final: false,
            elapsedMs: Date.now() - interruptionStartedAt,
          }, call.interruption)
          if (delayed === 'interrupt') {
            interruptionConfirmed = true
            interrupt()
          }
        }, delay)
      }
      return 'waiting'
    }
    let capture: { close(): Promise<void> } | undefined
    let downlink: Promise<void> | undefined
    try {
      const transport = await this.client.listen(this.session.sessionId, transcription.profile, (event) => {
        if (combined.aborted) return
        if (event.type !== 'error') {
          if (muted) return
          if (awaitSpeechStart && event.type !== 'speech-start') return
          if (event.type === 'speech-start') awaitSpeechStart = false
        }
        // The fixed greeting owns the opening; recognizer onset is not proof of a caller interruption.
        if (opening() && event.type !== 'error') return
        switch (event.type) {
          case 'speech-start':
            // An onset without recognized words cannot erase an answer or strand a finalized draft.
            scheduleUtterance()
            beginInterruptionCandidate()
            break
          case 'partial': {
            if (event.text.trim() === '') break
            clearTimeout(utteranceTimer)
            utteranceTimer = undefined
            if (interruptionStartedAt === 0) beginInterruptionCandidate()
            const transcript = appendUtteranceSegment(utterance, event.text)
            this.transcript.recognize(transcript)
            this.publish({ ...this.view, transcript })
            if (!interruptionDuringPlayback) interrupt()
            else confirmInterruption(transcript, false)
            break
          }
          case 'final': {
            const text = event.text.trim()
            if (text === '') break
            if (interruptionStartedAt === 0) beginInterruptionCandidate()
            const transcript = appendUtteranceSegment(utterance, text)
            const decision = confirmInterruption(transcript, true)
            interruptionStartedAt = 0
            interruptionDuringPlayback = false
            interruptionConfirmed = false
            interruptionHypothesis = ''
            if (decision === 'ignored') {
              this.transcript.discardUtterance()
              this.publish({ ...this.view, transcript: utterance })
              break
            }
            if (decision === 'accepted') interrupt()
            utterance = transcript
            this.transcript.recognize(utterance)
            this.publish({ ...this.view, phase: 'transcribing', transcript: utterance })
            scheduleUtterance()
            break
          }
          case 'error': fail(new Error(event.message)); break
        }
      }, combined)
      downlink = transport.done
      void downlink.catch(fail)
      capture = await this.platform.capture((pcm) => {
        // Keep capture warm, but do not send speaker feedback from the protected greeting to ASR.
        if (combined.aborted || opening() || muted) return
        // Count in-flight audio so a permanently stalled request cannot grow memory without bound.
        bufferedBytes += pcm.byteLength
        if (bufferedBytes > maxPendingAudioBytes) { fail(new Error('語音網絡連接過慢，請重新接通。')); return }
        queuedAudio.push(pcm)
        if (uploading) return
        uploading = true
        upload = (async () => {
          while (queuedAudio.length > 0 && !combined.aborted) {
            const batch = queuedAudio.splice(0, MAX_UPLOAD_FRAMES)
            const bytes = new Uint8Array(batch.reduce((size, frame) => size + frame.byteLength, 0))
            let offset = 0
            for (const frame of batch) { bytes.set(frame, offset); offset += frame.byteLength }
            await transport.send(bytes)
            bufferedBytes -= bytes.byteLength
          }
        })().catch(fail).finally(() => { uploading = false })
      }, call.microphone, combined)
      onReady()
      if (!opening()) this.publish({ ...this.view, phase: 'listening' })
      captureReady = true
      drain()
      await ended
    } finally {
      this.controls = undefined
      lifetime.abort()
      this.transcript.finishUtterance(false)
      if (replyAbort !== undefined && !replyAbort.signal.aborted) this.transcript.interrupt()
      this.publish({ ...this.view })
      clearTimeout(utteranceTimer)
      clearTimeout(interruptionTimer)
      queuedAudio = []
      pending = []
      replyAbort?.abort()
      await capture?.close()
      await worker
      await upload
      await downlink?.catch(() => { /* The call's terminal result already owns downlink failure. */ })
    }
  }

  private async waitIdle(timeoutMs: number): Promise<void> {
    let unsubscribe = (): void => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        const check = (): void => {
          const snapshot = this.session.getSnapshot()
          if (!snapshot.running && snapshot.queue.length === 0) resolve()
        }
        unsubscribe = this.session.subscribe(check)
        timer = setTimeout(() => { reject(new Error('取消上一轮回答超时，请重新接通。')) }, timeoutMs)
        check()
      })
    } finally { unsubscribe(); clearTimeout(timer) }
  }

  private async submit(
    text: string, signal: AbortSignal, timeoutMs: number,
    content: (turn: number, step: number, blocks: readonly AssistantBlock[], final: boolean) => void,
  ): Promise<SpokenAnswer> {
    const before = this.session.getSnapshot()
    if (before.running || before.queue.length > 0) throw new Error('The conversation is busy. End this call and wait for the reply.')
    const baseline = Math.max(-1, ...before.nodes.map(node => node.seq), ...before.turnEnds.values())
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    let observe = (): void => {}
    let unsubscribe = (): void => {}
    let accepted = false
    const reply = new Promise<SpokenAnswer>((resolve, reject) => {
      observe = () => {
        const snapshot = this.session.getSnapshot()
        const fresh = []
        for (let i = snapshot.nodes.length - 1; i >= 0; i--) {
          const node = snapshot.nodes[i]
          if (node === undefined || node.seq <= baseline) break
          fresh.unshift(node)
        }
        const users = fresh.filter(node => node.kind === 'user' || node.kind === 'steering')
        const user = users[0]
        const userText = user?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
        if (users.length > 1 || (user !== undefined && userText !== text)) {
          this.ownsTurn = false
          reject(new Error('Another message entered this conversation. The voice call has stopped.'))
          return
        }
        if (!accepted) return
        if (snapshot.removed || snapshot.lastAgentError !== null) {
          reject(new Error(snapshot.lastAgentError ?? 'The conversation was removed.'))
          return
        }
        for (const node of fresh) {
          if (node.kind === 'assistant' && !node.interrupted) content(node.turn, node.step, node.blocks, true)
        }
        if (snapshot.partial) content(snapshot.partial.turn, snapshot.partial.step, snapshot.partial.blocks, false)
        const ended = [...snapshot.turnEnds.values()].some(seq => seq > baseline)
        if (!ended || snapshot.running) return
        this.ownsTurn = false
        const answer = fresh.findLast(node => node.kind === 'assistant' && node.messageId !== undefined
          && node.blocks.some(block => block.kind === 'text' && block.text.trim() !== ''))
        if (answer?.kind === 'assistant' && answer.messageId !== undefined && users.length === 1) {
          resolve({ ...answer, messageId: answer.messageId })
        }
        else reject(new Error('The turn ended without a spoken answer. Please try again.'))
      }
      const cancel = (): void => { reject(new Error('The voice response was cancelled or timed out.')) }
      deadline.addEventListener('abort', cancel, { once: true })
      const off = this.session.subscribe(observe)
      unsubscribe = () => { off(); deadline.removeEventListener('abort', cancel) }
      if (deadline.aborted) cancel()
    })
    void reply.catch(() => { /* Awaited below after admission; events may fail before that RPC returns. */ })
    try {
      signal.throwIfAborted()
      const result = await this.session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) throw new Error(result.error.message)
      accepted = true
      this.ownsTurn = true
      observe()
      return await reply
    } finally { unsubscribe() }
  }

  private publish(view: Omit<VoiceCallView, 'messages'>): void {
    this.view = { ...view, messages: this.transcript.entries }
    for (const listener of this.listeners) {
      try { listener() } catch (error) { console.error('[ui-voice] call observer failed', error) }
    }
  }
}
