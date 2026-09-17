/** Loopback fetch fixture for the RAG preset's embedding and rerank requests. */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'customer-service-local-model'

/** Install deterministic embedding and rerank responses for one fixture process. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const previous = globalThis.fetch
    globalThis.fetch = async (input, init): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (typeof init?.body !== 'string') throw new Error(`customer-service local model: ${url} has no JSON body`)
      const body = JSON.parse(init.body) as { input?: unknown; documents?: unknown }
      if (url.endsWith('/embeddings')) {
        if (!Array.isArray(body.input) || body.input.some(value => typeof value !== 'string')) {
          throw new Error('customer-service local model: embedding input must be a string array')
        }
        return Response.json({
          data: body.input.map((_value, index) => ({ index, embedding: [1, 0] })),
        })
      }
      if (url.endsWith('/rerank')) {
        if (!Array.isArray(body.documents)) throw new Error('customer-service local model: rerank documents must be an array')
        return Response.json({
          results: body.documents.map((_value, index) => ({ index, relevance_score: 1 - index / 100 })),
        })
      }
      if (url.endsWith('/chat/completions')) {
        const answer = '張電費單唔見咗唔緊要，你可以登入澳電網上服務、澳電App或者澳電微信服務，查返當月張單。'
        return new Response([
          `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 5 } })}`,
          'data: [DONE]',
          '',
        ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
      }
      return await previous(input, init)
    }
    return () => { globalThis.fetch = previous }
  })
}
