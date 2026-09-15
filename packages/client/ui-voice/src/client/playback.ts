/** Progressive sentence playback with a bounded, preloaded next audio element. */

import type { VoiceAudioSource, VoicePlayback, VoicePlaybackEvents } from './contract.ts'

/**
 * Begin loading a progressive audio response without starting playback.
 * @param source - authorized Host audio URL.
 * @param signal - response lifetime cancellation.
 * @returns ordered play and immediate stop operations.
 */
export function prepareAudio(source: VoiceAudioSource, signal: AbortSignal): {
  play(events: VoicePlaybackEvents): VoicePlayback
  stop(): void
} {
  const audio = document.createElement('audio')
  audio.preload = 'auto'
  audio.defaultPlaybackRate = source.playbackRate ?? 1
  audio.playbackRate = source.playbackRate ?? 1
  audio.preservesPitch = true
  let live = true
  let events: VoicePlaybackEvents | undefined
  let failure: Error | undefined
  const stop = (): void => {
    if (!live) return
    live = false
    audio.removeEventListener('playing', playing)
    audio.removeEventListener('ended', ended)
    audio.removeEventListener('error', failed)
    signal.removeEventListener('abort', stop)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  const playing = (): void => { if (live) events?.onPlaying() }
  const ended = (): void => { if (live) { stop(); events?.onEnded() } }
  const failed = (): void => {
    failure = new Error(`语音音频加载失败 (${String(audio.error?.code ?? 'network')})，请检查 TTS 服务。`)
    stop()
    events?.onError(failure)
  }
  audio.addEventListener('playing', playing)
  audio.addEventListener('ended', ended)
  audio.addEventListener('error', failed)
  signal.addEventListener('abort', stop, { once: true })
  audio.src = source.url
  if (signal.aborted) stop()
  return {
    stop,
    play(observer) {
      events = observer
      if (failure) { observer.onError(failure); return { stop } }
      if (!live) return { stop }
      try {
        void audio.play().catch((error: unknown) => {
          if (!live) return
          stop()
          observer.onError(error instanceof Error ? error : new Error('浏览器无法播放语音。'))
        })
      } catch (error) { stop(); observer.onError(error) }
      return { stop }
    },
  }
}
