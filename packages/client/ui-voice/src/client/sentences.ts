/** Sentence extraction and ordered progressive playback with an optional provider fallback. */

import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SpeechCallOptions, VoiceClient, VoicePlatform, VoiceSentence } from './contract.ts'

type Prepared = ReturnType<NonNullable<VoicePlatform['prepare']>> & { dispose(): void }
interface Entry {
  request: VoiceSentence
  text: string
  abort: AbortSignal
  ready?: Promise<Prepared>
  readyProfile?: string
  audible?: boolean
}

/** Find a stable spoken-sentence boundary or a bounded prefix; layout newlines and decimal points are not endings. */
function boundary(text: string, final: boolean, limit: number, pauseMinimum: number): number {
  for (let i = 0; i < Math.min(text.length, limit); i++) {
    const char = text[i]
    if (char !== undefined && '。！？!?；;'.includes(char)) return i + 1
    if (char === '.' && /\s/.test(text[i + 1] ?? '')) return i + 1
    if (i + 1 >= pauseMinimum && char !== undefined && '，、,：:'.includes(char)) return i + 1
  }
  if (text.length >= limit) {
    const space = text.lastIndexOf(' ', limit)
    if (space > limit / 2) return space + 1
    const code = text.charCodeAt(limit - 1)
    return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit
  }
  return final ? text.length : 0
}

function hasSpeakableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Ordered sentence queue for one assistant response, including revisions and cancellation. */
export class VoiceSentenceQueue {
  private readonly states = new Map<string, { text: string; sent: number }>()
  private readonly entries: Entry[] = []
  private active: Entry | undefined
  private worker: Promise<void> | undefined
  private generation = new AbortController()
  private failure: Error | undefined

  /**
   * @param sessionId - conversation supplying authorized text.
   * @param profile - preferred synthesis profile.
   * @param fallbackProfile - alternate profile selected after a preferred-provider failure.
   * @param options - sentence and queue limits.
   * @param client - Host speech transport.
   * @param platform - progressive media operations.
   * @param signal - current response lifetime.
   * @param started - audible sentence notification.
   * @param failed - terminal playback failure notification.
   * @param selected - notification when the fallback has produced audible output.
   */
  constructor(
    private readonly sessionId: SessionId, private profile: string, private readonly fallbackProfile: string | undefined,
    private readonly options: SpeechCallOptions, private readonly client: VoiceClient,
    private readonly platform: VoicePlatform, private readonly signal: AbortSignal,
    private readonly started: (text: string) => void, private readonly failed: (error: Error) => void,
    private readonly selected: (profile: string) => void,
  ) {}

  /**
   * Add newly generated text.
   * @param turn - turn number.
   * @param step - step number.
   * @param blocks - current text blocks.
   * @param final - flush an unfinished final sentence.
   */
  update(turn: number, step: number, blocks: readonly AssistantBlock[], final: boolean): void {
    if (this.signal.aborted || this.failure) return
    blocks.forEach((block, index) => {
      if (block.kind !== 'text') return
      const key = `${turn}:${step}:${index}`
      let state = this.states.get(key)
      if (state && !block.text.startsWith(state.text)) {
        this.generation.abort()
        for (const entry of this.entries.splice(0)) void entry.ready?.then((value) => { value.dispose() }, () => {})
        this.states.delete(key)
        this.generation = new AbortController()
        state = undefined
      }
      state ??= { text: '', sent: 0 }
      state.text = block.text
      this.states.set(key, state)
      while (state.sent < state.text.length) {
        const length = boundary(
          state.text.slice(state.sent), final,
          this.options.sentenceMaxChars, this.options.sentencePauseMinChars,
        )
        if (length === 0) break
        const start = state.sent
        state.sent += length
        if (!hasSpeakableText(state.text.slice(start, state.sent))) continue
        if (this.entries.length >= this.options.sentenceQueueLimit) { this.fail(new Error('回答播报队列已满，请打断后缩短问题。')); return }
        this.entries.push({
          request: { sessionId: this.sessionId, profile: this.profile, turn, step, block: index,
            start, prefix: state.text.slice(0, state.sent) },
          text: state.text.slice(start, state.sent),
          abort: AbortSignal.any([this.signal, this.generation.signal]),
        })
        this.warm()
        this.drain()
      }
    })
  }

  /** Await all sentence audio. @returns playback completion or a synthesis failure. */
  async finish(): Promise<void> {
    while (this.worker) await this.worker
    if (this.failure) throw this.failure
  }

  /** Cancel and release current and queued audio. @returns media quiescence. */
  async close(): Promise<void> {
    this.generation.abort()
    for (const entry of this.entries.splice(0)) await entry.ready?.then((value) => { value.dispose() }, () => {})
    await this.worker
  }

  private warm(): void {
    if (this.active !== undefined && this.active.audible !== true) return
    for (const entry of this.entries.slice(0, 1)) {
      if (entry.ready) continue
      entry.readyProfile = this.profile
      entry.ready = this.prepare(entry, this.profile)
      void entry.ready.catch(() => { /* The ordered worker retries or reports this failure. */ })
    }
  }

  private drain(): void {
    if (this.worker || this.signal.aborted || this.failure) return
    this.worker = (async () => {
      while (this.entries.length > 0 && !this.signal.aborted && !this.failure) {
        this.warm()
        const entry = this.entries.shift()
        if (!entry) break
        this.active = entry
        let prepared: Prepared | undefined
        try {
          prepared = await entry.ready
          if (!prepared || entry.abort.aborted) continue
          await this.play(entry, prepared)
        } catch (primaryError) {
          prepared?.dispose()
          prepared = undefined
          const fallback = this.fallbackProfile
          if (entry.abort.aborted || entry.audible === true || fallback === undefined || entry.readyProfile === fallback) {
            if (!entry.abort.aborted) this.fail(primaryError)
            continue
          }
          try {
            prepared = await this.prepare(entry, fallback)
            await this.play(entry, prepared, () => {
              this.profile = fallback
              this.selected(fallback)
            })
          } catch (fallbackError) {
            if (!isAborted(entry.abort)) this.fail(fallbackError)
          }
        }
        finally { prepared?.dispose(); this.active = undefined }
      }
    })().finally(() => {
      this.worker = undefined
      if (this.entries.length > 0 && !this.signal.aborted && !this.failure) this.drain()
    })
  }

  private prepare(entry: Entry, profile: string): Promise<Prepared> {
    const synthesize = this.client.synthesizeSentence?.bind(this.client)
    const prepare = this.platform.prepare?.bind(this.platform)
    if (!synthesize || !prepare) return Promise.reject(new Error('逐句语音播放尚未就绪，请刷新页面。'))
    return synthesize({ ...entry.request, profile }, entry.abort).then((source) => {
      if (entry.abort.aborted) { source.dispose?.(); throw new Error('Sentence cancelled') }
      const media = prepare({ ...source, playbackRate: this.options.playbackRate }, entry.abort)
      return { ...media, dispose: () => { media.stop(); source.dispose?.() } }
    })
  }

  private async play(entry: Entry, media: Prepared, onPlaying?: () => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let audible = false
      const cancel = (): void => { media.stop(); reject(new Error('Sentence cancelled')) }
      const cleanup = (): void => { entry.abort.removeEventListener('abort', cancel) }
      entry.abort.addEventListener('abort', cancel, { once: true })
      try {
        media.play({ onPlaying: () => {
          if (audible) return
          audible = true
          entry.audible = true
          onPlaying?.()
          this.warm()
          this.started(entry.text)
        },
        onEnded: () => { cleanup(); resolve() },
        onError: (error) => {
          cleanup()
          reject(audible
            ? new Error('Sentence playback stopped after audio began')
            : error instanceof Error ? error : new Error(String(error)))
        } })
      } catch (error) { cleanup(); reject(error instanceof Error ? error : new Error(String(error))) }
      if (entry.abort.aborted) { cleanup(); cancel() }
    })
  }

  private fail(error: unknown): void {
    if (this.failure || this.signal.aborted) return
    this.failure = error instanceof Error ? error : new Error(String(error))
    this.generation.abort()
    this.failed(this.failure)
  }
}
