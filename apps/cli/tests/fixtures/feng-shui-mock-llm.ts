/** Keyless adapter for the shipped Hong Kong feng shui preset transcript. */

import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** Emit one short Cantonese answer suitable for speech synthesis. */
function * answer(): Generator<StreamChunk> {
  const text = '可以。先由採光、通風同走動空間睇起。'
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 6, outputTokens: 4 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Deterministic adapter that records the preset's assembled request in the session log. */
class FengShuiMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * answer()
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'feng-shui-mock-llm'

/** LLM registry required by this fixture adapter. */
export const inject = ['llm']

/** Register the keyless feng shui adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['feng-shui-mock'], new FengShuiMockAdapter())
}
