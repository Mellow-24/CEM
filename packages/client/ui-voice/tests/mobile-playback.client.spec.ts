// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createMobilePlayback } from '../src/client/mobile-playback.ts'
import { SILENT_WAV } from '../src/client/platform.ts'

const SOURCE = { url: '/api/speech/greeting?sessionId=test&language=yue', playbackRate: 1.15 }
const REPLY = { url: '/api/speech/sentence?sessionId=test&text=hello' }

function audioResponse(): Response {
  return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/wav' } })
}

function observers() {
  return { onPlaying: vi.fn(), onEnded: vi.fn(), onError: vi.fn<(error: unknown) => void>() }
}

function bench() {
  const audio = new EventTarget() as HTMLAudioElement
  const play = vi.fn<() => Promise<void>>().mockResolvedValue()
  const pause = vi.fn()
  const load = vi.fn()
  const removeAttribute = vi.fn()
  Object.assign(audio, { play, pause, load, removeAttribute, src: '' })
  const createElement = vi.spyOn(document, 'createElement').mockReturnValue(audio)
  let serial = 0
  const create = vi.fn(() => `blob:speech-${String(++serial)}`)
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = create
    static override revokeObjectURL = revoke
  })
  let resolve!: (response: Response) => void
  let reject!: (error: unknown) => void
  const response = new Promise<Response>((yes, no) => { resolve = yes; reject = no })
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(response)
  vi.stubGlobal('fetch', fetcher)
  const events = observers()
  const abort = new AbortController()
  const player = createMobilePlayback()
  const success = (): void => { resolve(audioResponse()) }
  return {
    audio, play, pause, load, removeAttribute, createElement, create, revoke,
    resolve, reject, fetcher, events, abort, player, success,
  }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function errorMessage(b: ReturnType<typeof bench>): string {
  const error = b.events.onError.mock.calls[0]?.[0]
  expect(error).toBeInstanceOf(Error)
  return (error as Error).message
}

it('fetches with page credentials, then releases local audio after playback', async () => {
  const b = bench()
  const prepared = b.player.prepare(SOURCE, b.abort.signal)
  expect(b.fetcher.mock.calls[0]?.[0]).toBe(SOURCE.url)
  expect(b.fetcher.mock.calls[0]?.[1]).toMatchObject({
    credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
  })
  expect(b.fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  b.success()
  await vi.waitFor(() => { expect(b.create).toHaveBeenCalledOnce() })
  expect(b.createElement).not.toHaveBeenCalled()
  prepared.play(b.events)
  prepared.play(b.events)
  expect(b.play).toHaveBeenCalledOnce()
  expect(b.audio.src).toBe('blob:speech-1')
  expect(b.audio.playbackRate).toBe(1.15)
  expect(b.audio.preservesPitch).toBe(true)
  b.audio.dispatchEvent(new Event('playing'))
  b.audio.dispatchEvent(new Event('ended'))
  prepared.stop()
  expect(b.events.onPlaying).toHaveBeenCalledOnce()
  expect(b.events.onEnded).toHaveBeenCalledOnce()
  expect(b.events.onError).not.toHaveBeenCalled()
  expect(b.revoke).toHaveBeenCalledExactlyOnceWith('blob:speech-1')
  expect(b.pause).toHaveBeenCalledOnce()
  expect(b.removeAttribute).toHaveBeenCalledWith('src')
})

it('keeps the gesture-unlocked element across a greeting and successive replies', async () => {
  const b = bench()
  b.player.unlock()
  expect(b.audio.src).toBe(SILENT_WAV)
  const greeting = b.player.prepare(SOURCE, b.abort.signal)
  greeting.play(b.events)
  for (const event of ['playing', 'ended', 'error']) b.audio.dispatchEvent(new Event(event))
  expect(b.events.onPlaying).not.toHaveBeenCalled()
  expect(b.events.onEnded).not.toHaveBeenCalled()
  expect(b.events.onError).not.toHaveBeenCalled()
  b.success()
  await vi.waitFor(() => { expect(b.play).toHaveBeenCalledTimes(2) })
  b.player.unlock()
  expect(b.audio.src).toBe('blob:speech-1')
  b.audio.dispatchEvent(new Event('ended'))
  for (let index = 2; index <= 3; index++) {
    b.fetcher.mockResolvedValueOnce(audioResponse())
    b.player.play(REPLY, b.events, b.abort.signal)
    await vi.waitFor(() => { expect(b.audio.src).toBe(`blob:speech-${String(index)}`) })
    expect(b.audio.playbackRate).toBe(1)
    b.audio.dispatchEvent(new Event('playing'))
    b.audio.dispatchEvent(new Event('ended'))
  }
  expect(b.createElement).toHaveBeenCalledOnce()
  expect(b.events.onPlaying).toHaveBeenCalledTimes(2)
  expect(b.events.onEnded).toHaveBeenCalledTimes(3)
  expect(b.revoke).toHaveBeenCalledTimes(3)
})

it('prefetches and cancels queued audio without changing the active source', async () => {
  const b = bench()
  b.player.play(SOURCE, b.events, b.abort.signal)
  b.success()
  await vi.waitFor(() => { expect(b.create).toHaveBeenCalledOnce() })
  b.fetcher.mockResolvedValueOnce(audioResponse())
  const queued = b.player.prepare(REPLY, b.abort.signal)
  await vi.waitFor(() => { expect(b.create).toHaveBeenCalledTimes(2) })
  expect(b.audio.src).toBe('blob:speech-1')
  queued.stop()
  expect(b.revoke).toHaveBeenCalledExactlyOnceWith('blob:speech-2')
  expect(b.pause).not.toHaveBeenCalled()
  b.audio.dispatchEvent(new Event('ended'))
  expect(b.events.onEnded).toHaveBeenCalledOnce()
})

it('refuses overlapping playback without stopping the active sentence', async () => {
  const b = bench()
  b.player.play(SOURCE, b.events, b.abort.signal)
  b.success()
  await vi.waitFor(() => { expect(b.create).toHaveBeenCalledOnce() })
  b.fetcher.mockResolvedValueOnce(audioResponse())
  const other = observers()
  b.player.play(REPLY, other, b.abort.signal)
  expect(other.onError).toHaveBeenCalledWith(expect.objectContaining({ message: '已有语音正在播放，请停止后重试。' }))
  expect(b.pause).not.toHaveBeenCalled()
  b.audio.dispatchEvent(new Event('playing'))
  expect(b.events.onPlaying).toHaveBeenCalledOnce()
  b.abort.abort()
})

it('ignores a cancelled play promise after the next sentence starts', async () => {
  const b = bench()
  let rejectPlay!: (error: Error) => void
  b.play.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectPlay = reject }))
  const first = b.player.play(SOURCE, b.events, b.abort.signal)
  b.success()
  await vi.waitFor(() => { expect(b.play).toHaveBeenCalledOnce() })
  first.stop()
  b.fetcher.mockResolvedValueOnce(audioResponse())
  const next = observers()
  b.player.play(REPLY, next, b.abort.signal)
  await vi.waitFor(() => { expect(b.play).toHaveBeenCalledTimes(2) })
  rejectPlay(new DOMException('interrupted', 'AbortError'))
  await Promise.resolve()
  expect(b.events.onError).not.toHaveBeenCalled()
  expect(next.onError).not.toHaveBeenCalled()
  expect(b.pause).toHaveBeenCalledOnce()
  b.audio.dispatchEvent(new Event('ended'))
  expect(next.onEnded).toHaveBeenCalledOnce()
})

it.each([401, 403, 404, 502])('defers HTTP %i errors until play', async (status) => {
  const b = bench()
  const prepared = b.player.prepare(REPLY, b.abort.signal)
  b.resolve(new Response('denied', { status }))
  await vi.waitFor(() => { expect(b.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true) })
  expect(b.events.onError).not.toHaveBeenCalled()
  prepared.play(b.events)
  expect(errorMessage(b)).toContain(`HTTP ${String(status)}`)
  expect(b.play).not.toHaveBeenCalled()
  expect(b.create).not.toHaveBeenCalled()
})

it.each([
  { body: '<html>login</html>', type: 'text/html', message: '接口未返回音频' },
  { body: '', type: 'audio/wav', message: '音频为空' },
  { body: null, type: null, message: '接口未返回音频' },
])('rejects unusable audio: $message ($type)', async ({ body, type, message }) => {
  const b = bench()
  b.player.play(SOURCE, b.events, b.abort.signal)
  b.resolve(new Response(body, { headers: type === null ? {} : { 'content-type': type } }))
  await vi.waitFor(() => { expect(errorMessage(b)).toContain(message) })
  expect(b.create).not.toHaveBeenCalled()
})

it.each([
  { error: new TypeError('Failed to fetch'), message: 'HTTPS 证书信任' },
  { error: 'network failed', message: '语音下载失败，请重新接通。' },
])('explains download failure: $message', async ({ error, message }) => {
  const b = bench()
  b.player.play(SOURCE, b.events, b.abort.signal)
  b.reject(error)
  await vi.waitFor(() => { expect(errorMessage(b)).toContain(message) })
})

it.each(['resolve', 'reject'])('ignores a download that settles after cancellation: %s', async (result) => {
  const b = bench()
  const prepared = b.player.prepare(SOURCE, b.abort.signal)
  prepared.play(b.events)
  b.abort.abort()
  expect(b.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  if (result === 'resolve') b.success()
  else b.reject(new DOMException('aborted', 'AbortError'))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(b.create).not.toHaveBeenCalled()
  expect(b.events.onError).not.toHaveBeenCalled()
  expect(b.events.onEnded).not.toHaveBeenCalled()
  prepared.play(b.events)
  expect(b.play).not.toHaveBeenCalled()
})

it('does not fetch or create media for an already cancelled preparation', () => {
  const b = bench()
  b.abort.abort()
  b.player.play(REPLY, b.events, b.abort.signal)
  expect(b.fetcher).not.toHaveBeenCalled()
  expect(b.createElement).not.toHaveBeenCalled()
})

it('releases downloaded audio on cancellation and suppresses late media events', async () => {
  const b = bench()
  const listeners = vi.spyOn(b.audio, 'addEventListener')
  b.player.play(SOURCE, b.events, b.abort.signal)
  b.success()
  await vi.waitFor(() => { expect(b.create).toHaveBeenCalledOnce() })
  b.abort.abort()
  for (const event of ['playing', 'ended', 'error']) b.audio.dispatchEvent(new Event(event))
  for (const [type, callback] of listeners.mock.calls) {
    if (typeof callback === 'function') callback.call(b.audio, new Event(type))
  }
  expect(b.revoke).toHaveBeenCalledOnce()
  expect(b.events.onEnded).not.toHaveBeenCalled()
  expect(b.events.onError).not.toHaveBeenCalled()
})

it.each([2, 3, 4, undefined])('reports media error %s and allows fallback on the same element', async (code) => {
  const b = bench()
  b.player.play(SOURCE, b.events, b.abort.signal)
  b.success()
  await vi.waitFor(() => { expect(b.create).toHaveBeenCalledOnce() })
  Object.defineProperty(b.audio, 'error', { value: code === undefined ? null : { code } })
  b.audio.dispatchEvent(new Event('error'))
  expect(errorMessage(b)).toContain(`媒体错误 ${String(code ?? 'unknown')}`)
  expect(b.revoke).toHaveBeenCalledOnce()
  b.fetcher.mockResolvedValueOnce(audioResponse())
  const fallback = observers()
  b.player.play(REPLY, fallback, b.abort.signal)
  await vi.waitFor(() => { expect(b.play).toHaveBeenCalledTimes(2) })
  expect(b.createElement).toHaveBeenCalledOnce()
  b.audio.dispatchEvent(new Event('ended'))
  expect(fallback.onEnded).toHaveBeenCalledOnce()
})

it.each(['NotAllowedError', 'NotSupportedError'])('explains playback rejection: %s', async (name) => {
  const b = bench()
  b.play.mockRejectedValue(new DOMException('blocked', name))
  b.player.play(SOURCE, b.events, b.abort.signal)
  b.success()
  await vi.waitFor(() => { expect(errorMessage(b)).toContain(name === 'NotAllowedError' ? '允许本站播放声音' : '语音播放失败') })
  expect(b.revoke).toHaveBeenCalledOnce()
})

it('contains a synchronous play failure', async () => {
  const b = bench()
  b.play.mockImplementation(() => { throw new Error('play failed') })
  b.player.play(SOURCE, b.events, b.abort.signal)
  b.success()
  await vi.waitFor(() => { expect(errorMessage(b)).toContain('语音播放失败') })
  expect(b.revoke).toHaveBeenCalledOnce()
})

it.each(['sync', 'async'])('contains %s silent unlock failure until audible playback', async (kind) => {
  const b = bench()
  if (kind === 'sync') b.play.mockImplementationOnce(() => { throw new Error('unlock failed') })
  else b.play.mockRejectedValueOnce(new Error('unlock failed'))
  b.player.unlock()
  b.player.play(SOURCE, b.events, b.abort.signal)
  await Promise.resolve()
  expect(b.events.onError).not.toHaveBeenCalled()
  b.success()
  await vi.waitFor(() => { expect(b.play).toHaveBeenCalledTimes(2) })
  b.abort.abort()
})
