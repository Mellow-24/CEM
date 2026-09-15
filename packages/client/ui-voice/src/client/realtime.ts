/** Continuous same-origin PCM upload and bounded recognition event decoding. */

import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { VoiceClient, VoiceRecognitionEvent } from './contract.ts'

/**
 * Open duplex recognition.
 * @param fetcher - same-origin transport.
 * @param sessionId - live conversation.
 * @param profile - authorized recognizer.
 * @param event - streaming observer.
 * @param signal - call lifetime.
 * @returns ready PCM sender and downlink completion.
 */
export async function listenRealtime(
  fetcher: typeof fetch, sessionId: SessionId, profile: string,
  event: (event: VoiceRecognitionEvent) => void, signal: AbortSignal,
): ReturnType<NonNullable<VoiceClient['listen']>> {
  const call = crypto.randomUUID()
  const params = new URLSearchParams({ sessionId, profile, call })
  const response = await fetcher(`/api/speech/realtime?${params.toString()}`, { signal })
  if (!response.ok || response.body === null) throw new Error(`实时语音连接失败 (${String(response.status)})`)
  const reader = response.body.getReader()
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  let sequence = 0
  const done = (async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let pending = ''
    try {
      while (!signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) break
        pending += decoder.decode(chunk.value, { stream: true })
        if (pending.length > 65536) throw new Error('Recognition event exceeds the protocol limit')
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          const value: unknown = JSON.parse(pending.slice(0, newline))
          pending = pending.slice(newline + 1)
          if (typeof value !== 'object' || value === null || !('type' in value)) throw new Error('Invalid recognition event')
          const row = value as Record<string, unknown>
          if (row['type'] === 'ready') resolveReady()
          else if (row['type'] === 'speech-start') event({ type: 'speech-start' })
          else if ((row['type'] === 'partial' || row['type'] === 'final') && typeof row['text'] === 'string') event({ type: row['type'], text: row['text'] })
          else if (row['type'] === 'error' && typeof row['message'] === 'string') throw new Error(row['message'])
          else throw new Error('Invalid recognition event')
        }
      }
      if (!signal.aborted) throw new Error('实时语音连接已断开')
    } catch (error) { rejectReady(error); throw error }
    finally { await reader.cancel().catch(() => { /* A disconnected response is already closed. */ }); reader.releaseLock() }
  })()
  void done.catch(() => { /* The controller observes done after setup; ready owns setup failures. */ })
  await ready
  return {
    done,
    async send(pcm) {
      const query = new URLSearchParams({ sessionId, call, sequence: String(sequence++) })
      const uploaded = await fetcher(`/api/speech/realtime/audio?${query.toString()}`, {
        method: 'POST', body: new Blob([Uint8Array.from(pcm)]), headers: { 'content-type': 'application/octet-stream' }, signal,
      })
      if (!uploaded.ok) throw new Error(`语音上传失败 (${String(uploaded.status)})`)
    },
  }
}
