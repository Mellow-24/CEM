/** Session-authorized duplex recognition over an event stream and ordered PCM uploads. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ResolvedSpeechTranscription, SpeechRealtimeInput } from '@deepseek-ai/dsh-speech-transcription'

interface ActiveCall {
  agent: Agent
  token: string
  sequence: number
  uploading: boolean
  input: SpeechRealtimeInput | undefined
  abort: AbortController
  ready: Promise<SpeechRealtimeInput> | undefined
}

/**
 * Register transient call routes.
 * @param ctx - Connection owner.
 * @param authority - configured browser authority.
 * @param agentFor - exact live root authorization.
 * @param responseInstructions - model-visible speaking rules active for the call lifetime.
 */
export function registerRealtimeRoutes(
  ctx: Context,
  authority: 'loopback' | 'trusted-host',
  agentFor: (sessionId: string) => Agent,
  responseInstructions: string,
): void {
  const calls = new Map<string, ActiveCall>()
  ctx.systemPrompt.context({
    name: 'speech-web:active-call',
    order: 0,
    text: context => context.agent !== undefined
      && calls.get(context.agent.id)?.agent === context.agent
      ? responseInstructions
      : '',
  })
  ctx.effect(() => async () => {
    const active = [...calls.values()]
    for (const call of active) call.abort.abort()
    await Promise.all(active.map(async (call) => {
      const input = await call.ready?.catch(() => undefined)
      await input?.close()
    }))
    calls.clear()
  })
  const connect = (request: Request): Response => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const params = new URL(request.url).searchParams
    const sessionId = params.get('sessionId') ?? ''
    const token = params.get('call') ?? ''
    if (!/^[a-f0-9-]{36}$/.test(token)) return new Response(null, { status: 400 })
    let agent: Agent
    try { agent = agentFor(sessionId) } catch { return new Response(null, { status: 403 }) }
    if (calls.has(sessionId)) return new Response('A voice call is already active', { status: 409 })
    let open: ResolvedSpeechTranscription['openRealtime']
    try {
      const resolved = ctx.get('speechTranscription')?.resolve(agent, params.get('profile') ?? undefined)
      open = resolved?.openRealtime?.bind(resolved)
    } catch { return new Response(null, { status: 403 }) }
    if (open === undefined) return new Response(null, { status: 404 })
    const abort = new AbortController()
    const call: ActiveCall = {
      agent, token, sequence: 0, uploading: false, abort, input: undefined,
      ready: undefined,
    }
    calls.set(sessionId, call)
    const encoder = new TextEncoder()
    let terminal = false
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const cleanup = async (): Promise<void> => {
      abort.abort()
      request.signal.removeEventListener('abort', disconnected)
      if (calls.get(sessionId) === call) calls.delete(sessionId)
      const input = await call.ready?.catch(() => undefined)
      await input?.close()
    }
    const finish = (): void => {
      if (terminal) return
      terminal = true
      controller.close()
      void cleanup()
    }
    const disconnected = (): void => { finish() }
    const emit = (event: object): void => {
      if (terminal) return
      if ((controller.desiredSize ?? 0) <= 0) { finish(); return }
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
    }
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value },
      async cancel() { terminal = true; await cleanup() },
    }, { highWaterMark: 64 })
    request.signal.addEventListener('abort', disconnected, { once: true })
    call.ready = open((event) => {
      emit(event)
      if (event.type === 'error') finish()
    }, abort.signal)
    void call.ready.then(async (input) => {
      call.input = input
      if (terminal || request.signal.aborted) { finish(); await cleanup(); return }
      emit({ type: 'ready' })
    }, () => {
      emit({ type: 'error', message: '实时语音连接失败，请检查 Qwen 接口与凭据。' })
      finish()
    })
    if (request.signal.aborted) finish()
    return new Response(stream, { headers: {
      'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no',
    } })
  }
  ctx.connection.fetch.handle('/api/speech/realtime', request => Promise.resolve(connect(request)), { authority })
  ctx.connection.fetch.handle('/api/speech/realtime/audio', async (request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    const params = new URL(request.url).searchParams
    const sessionId = params.get('sessionId') ?? ''
    const call = calls.get(sessionId)
    try {
      if (call === undefined || call.agent !== agentFor(sessionId) || call.token !== params.get('call')) return new Response(null, { status: 403 })
      if (call.abort.signal.aborted || call.input === undefined || call.uploading) return new Response(null, { status: 409 })
      const sequence = Number(params.get('sequence'))
      if (!Number.isSafeInteger(sequence) || sequence !== call.sequence) return new Response(null, { status: 409 })
      const live = (): boolean => calls.get(sessionId) === call && !call.abort.signal.aborted && !call.uploading
      const pcm = new Uint8Array(await request.arrayBuffer())
      // An ordered upload coalesces 1–20 complete 100 ms mono 16 kHz PCM16 frames.
      if (pcm.byteLength === 0 || pcm.byteLength > 64000 || pcm.byteLength % 3200 !== 0) return new Response(null, { status: 400 })
      if (!live() || sequence !== call.sequence) return new Response(null, { status: 409 })
      call.sequence++
      call.uploading = true
      try {
        // Preserve provider-sized frames and prevent concurrent batches from interleaving.
        for (let offset = 0; offset < pcm.byteLength; offset += 3200) {
          call.abort.signal.throwIfAborted()
          await call.input.send(pcm.subarray(offset, offset + 3200))
        }
      } finally { call.uploading = false }
      return new Response(null, { status: 204 })
    } catch { call?.abort.abort(); return new Response(null, { status: 502 }) }
  }, { authority, maxRequestBodyBytes: 64000 })
}
