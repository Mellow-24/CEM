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
      return await previous(input, init)
    }
    return () => { globalThis.fetch = previous }
  })
}
