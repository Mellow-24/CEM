/** Deterministic DashScope SSE response for the shipped feng-shui preset. */

/** Text sent through the preset's configured synthesis provider. */
export const DASH_SCOPE_TEXT = '客廳保持光猛同通風。'

/** Decoded MP3 fixture bytes emitted by the SSE response. */
export const DASH_SCOPE_AUDIO = Uint8Array.from([0x49, 0x44, 0x33, 0x04])

/**
 * Create one successful two-event DashScope synthesis response.
 * @returns SSE response carrying one audio chunk and a successful finish event.
 */
export function dashScopeSseResponse(): Response {
  const audio = Buffer.from(DASH_SCOPE_AUDIO).toString('base64')
  const body = [
    { output: { type: 'sentence-synthesis', audio: { data: audio } } },
    { output: { finish_reason: 'stop' } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}
