import { describe, expect, it } from 'vitest'
import { classifyInterruption } from '../src/client/interruption.ts'

const options = {
  confirmationMs: 420,
  minimumMeaningfulCharacters: 3,
  echoMinimumCharacters: 6,
  echoSimilarityThreshold: 0.82,
  backchannelMaximumCharacters: 6,
}

describe('call interruption intent screening', () => {
  it('requires sustained meaningful partial speech but accepts a complete turn immediately', () => {
    const input = { text: '我想查上個月帳單', answer: '您可以登入網上服務查詢帳單。', final: false }
    expect(classifyInterruption({ ...input, elapsedMs: 419 }, options)).toBe('wait')
    expect(classifyInterruption({ ...input, elapsedMs: 420 }, options)).toBe('interrupt')
    expect(classifyInterruption({ ...input, elapsedMs: 0, final: true }, options)).toBe('interrupt')
  })

  it.each(['嗯嗯', '好的', '明白', 'okay', 'sim'])(
    'treats a complete short acknowledgement as passive: %s',
    (text) => {
      expect(classifyInterruption({ text, answer: '請繼續聽取辦理方式。', final: true, elapsedMs: 800 }, options))
        .toBe('ignore')
    },
  )

  it('filters likely playback echo using the active answer rather than an interruption-word list', () => {
    const answer = '您可以透過澳電網上服務申請住宅供電。'
    expect(classifyInterruption({ text: '可以透過澳電網上服務申請住宅供電', answer, final: true, elapsedMs: 900 }, options))
      .toBe('ignore')
  })

  it.each(['不要', '唔係', '等一下', '帳單？', '點解'])(
    'lets a short correction, stop request, or question claim the turn: %s',
    (text) => {
      expect(classifyInterruption({ text, answer: '請準備以下文件。', final: true, elapsedMs: 100 }, options))
        .toBe('interrupt')
    },
  )

  it('does not mistake an acknowledgement prefix for a passive utterance', () => {
    expect(classifyInterruption({
      text: '好的，我還想問繳費方式', answer: '申請住宅供電需要身份證明。', final: true, elapsedMs: 300,
    }, options)).toBe('interrupt')
  })
})
