/** Page-fetched mobile speech played through one gesture-unlocked media element. */

import { SILENT_WAV } from './platform.ts'
import type { VoiceAudioSource, VoicePlatform, VoicePlayback, VoicePlaybackEvents } from './contract.ts'

async function downloadAudio(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, {
    credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    const correction = response.status === 401 || response.status === 403
      ? '请刷新页面并确认本站访问权限。'
      : '请重新接通；若仍失败，请检查语音服务。'
    throw new Error(`语音下载失败（HTTP ${String(response.status)}），${correction}`)
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('audio/')) {
    await response.body?.cancel()
    throw new Error('语音接口未返回音频，请检查服务或登录状态。')
  }
  const blob = await response.blob()
  if (blob.size === 0) throw new Error('语音音频为空，请检查服务。')
  return blob
}

/**
 * Own one media element across a mobile runtime's greeting and successive replies.
 * @returns gesture unlock, cancellable sentence preparation, and message playback; prepared
 * audio is bounded by Host synthesis limits and released by its caller-owned stop or signal.
 */
export function createMobilePlayback(): Pick<VoicePlatform, 'unlock' | 'play'> & {
  prepare: NonNullable<VoicePlatform['prepare']>
} {
  let audio: HTMLAudioElement | undefined
  let active: VoicePlayback | undefined
  const element = (): HTMLAudioElement => {
    if (audio === undefined) {
      audio = document.createElement('audio')
      audio.preload = 'auto'
      audio.preservesPitch = true
    }
    return audio
  }
  const unlock = (): void => {
    if (active !== undefined) return
    const media = element()
    media.src = SILENT_WAV
    try {
      void media.play().catch(() => { /* Audible playback reports a permission failure. */ })
    } catch { /* Audible playback reports synchronous permission failures. */ }
  }
  const prepare = (source: VoiceAudioSource, signal: AbortSignal) => {
    const request = new AbortController()
    let objectUrl: string | undefined
    let events: VoicePlaybackEvents | undefined
    let failure: Error | undefined
    let attached = false
    const stop = (): void => {
      if (request.signal.aborted) return
      request.abort()
      signal.removeEventListener('abort', stop)
      if (active === owner) {
        const media = element()
        media.removeEventListener('playing', playing)
        media.removeEventListener('ended', ended)
        media.removeEventListener('error', failed)
        media.pause()
        media.removeAttribute('src')
        media.load()
        active = undefined
      }
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
    const owner = { stop }
    const fail = (message: string): void => {
      if (request.signal.aborted) return
      failure = new Error(message)
      stop()
      events?.onError(failure)
    }
    const playing = (): void => {
      if (active === owner && !request.signal.aborted) events?.onPlaying()
    }
    const ended = (): void => {
      if (active !== owner || request.signal.aborted) return
      stop()
      events?.onEnded()
    }
    const failed = (): void => {
      fail(`浏览器无法播放语音（媒体错误 ${String(element().error?.code ?? 'unknown')}），请检查浏览器音频支持。`)
    }
    const playFailed = (error: unknown): void => {
      const denied = (error instanceof Error || error instanceof DOMException) && error.name === 'NotAllowedError'
      fail(denied
        ? '浏览器阻止播放语音，请允许本站播放声音后重新接通。'
        : '语音播放失败，请重新接通或检查浏览器音频支持。')
    }
    const begin = (): void => {
      if (objectUrl === undefined || active !== owner || attached || request.signal.aborted) return
      const media = element()
      attached = true
      media.addEventListener('playing', playing)
      media.addEventListener('ended', ended)
      media.addEventListener('error', failed)
      media.defaultPlaybackRate = source.playbackRate ?? 1
      media.playbackRate = source.playbackRate ?? 1
      media.src = objectUrl
      media.load()
      try { void media.play().catch(playFailed) } catch (error) { playFailed(error) }
    }
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    else void downloadAudio(source.url, request.signal).then((blob) => {
      if (request.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      begin()
    }).catch((error: unknown) => {
      fail(error instanceof TypeError
        ? '语音下载失败或音频传输中断，请检查网络连接及 HTTPS 证书信任。'
        : error instanceof Error ? error.message : '语音下载失败，请重新接通。')
    })
    return {
      stop,
      play(observer: VoicePlaybackEvents): VoicePlayback {
        events = observer
        if (failure !== undefined) { observer.onError(failure); return owner }
        if (request.signal.aborted) return owner
        if (active !== undefined && active !== owner) {
          fail('已有语音正在播放，请停止后重试。')
          return owner
        }
        active = owner
        begin()
        return owner
      },
    }
  }
  return { unlock, prepare, play: (source, events, signal) => prepare(source, signal).play(events) }
}
