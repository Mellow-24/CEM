/** Microphone permissions must not outlive the full-screen call. */
import { afterEach, expect, it, vi } from 'vitest'
import { capturePcm } from '../src/client/pcm.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('settles hangup during permission and stops a microphone granted afterward', async () => {
  let grant!: (stream: MediaStream) => void
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  const close = vi.fn(async () => {})
  vi.stubGlobal('AudioContext', class {
    sampleRate = 16000
    close = close
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:microphone')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const abort = new AbortController()
  const operation = capturePcm(() => {}, {
    echoCancellation: true, noiseSuppression: true, autoGainControl: false,
  }, abort.signal)
  expect(getUserMedia).toHaveBeenCalledWith({ audio: {
    channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false,
  } })
  const rejected = expect(operation).rejects.toThrow('Call ended')
  abort.abort()
  await rejected
  expect(close).toHaveBeenCalledOnce()
  const stop = vi.fn()
  grant({ getTracks: () => [{ stop, readyState: 'live' }] } as unknown as MediaStream)
  await vi.waitFor(() => { expect(stop).toHaveBeenCalledOnce() })
})
