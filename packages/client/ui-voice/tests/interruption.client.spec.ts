import { describe, expect, it } from 'vitest'
import { classifyInterruption, isStandaloneStopRequest } from '../src/client/interruption.ts'

const options = {
  confirmationMs: 420,
  minimumMeaningfulCharacters: 3,
  echoMinimumCharacters: 6,
  echoSimilarityThreshold: 0.82,
  backchannelMaximumCharacters: 6,
}

describe('call interruption intent screening', () => {
  it('separates stop-only controls from a stop followed by another question', () => {
    expect(isStandaloneStopRequest('唔該，停一下。')).toBe(true)
    expect(isStandaloneStopRequest('Please stop speaking.')).toBe(true)
    expect(isStandaloneStopRequest('Can you stop?')).toBe(true)
    expect(isStandaloneStopRequest('Could you pause please?')).toBe(true)
    expect(isStandaloneStopRequest('Please stop talking now.')).toBe(true)
    expect(isStandaloneStopRequest('你可唔可以停一下')).toBe(true)
    expect(isStandaloneStopRequest('停一下，我想問繳費。')).toBe(false)
    expect(isStandaloneStopRequest('Stop by the shop later.')).toBe(false)
  })
  it('requires confirmation for a partial stop command and accepts a completed stop command', () => {
    const input = { text: '停一下', answer: '您可以登入網上服務查詢帳單。', final: false }
    expect(classifyInterruption({ ...input, elapsedMs: 419 }, options)).toBe('wait')
    expect(classifyInterruption({ ...input, elapsedMs: 420 }, options)).toBe('interrupt')
    expect(classifyInterruption({ ...input, elapsedMs: 0, final: true }, options)).toBe('interrupt')
  })

  it.each(['嗯嗯', '好的', '好的。', '好啦', '係呀係呀', '嗯我知道', '明白', 'okay', 'yes yes', 'thank you', 'sim'])(
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

  it.each(['停一下', '請停一下', '唔該，等一陣', '等陣先', '停一停', '唔好講住', '先停一下', '唔好再講', 'stop', 'Please stop speaking.', 'hold on',
    'Sorry, wait a moment.', 'Could you please stop?', '你可唔可以停一下',
    '好的，停一下，我想問繳費', '停一下，我想改查上個月帳單', '停一下我想問繳費'])(
    'accepts an explicit completed stop command: %s',
    (text) => {
      expect(classifyInterruption({ text, answer: '請準備以下文件。', final: true, elapsedMs: 100 }, options))
        .toBe('interrupt')
    },
  )

  it.each(['我想查上個月帳單', '好的，我還想問繳費方式', '不要', '唔係', '帳單？', '點解',
    '喂你食咗飯未', '你幾點返屋企啊', '今晚去邊度食飯？', '其實我想飲水', '我要去買嘢',
    'Where is my phone?', 'What time is dinner?', 'Can you pass me the water?', 'Actually I want some coffee.',
    'The next stop is Macau.', 'Stop by the shop later.', 'Please wait for the bus.', '等一下車就到', '停一下車',
    '他说停一下', '佢話等一陣', '啊啊啊', ' ', '♪'])('ignores speech without an explicit assistant-directed intent: %s',
    (text) => {
      for (const elapsedMs of [0, 1000]) {
        expect(classifyInterruption({ text, answer: '請準備以下文件。', final: true, elapsedMs }, options)).toBe('ignore')
        expect(classifyInterruption({ text, answer: '請準備以下文件。', final: false, elapsedMs }, options)).toBe('wait')
      }
    },
  )

  it.each(['唔係，我想問繳費方式', '不是這個問題', '我講嘅係商業用電', '你理解錯咗',
    '可唔可以再講一次', '你可唔可以講慢啲', '講慢啲', '客服，幫我查一下繳費方式', 'Can you repeat that?',
    'Please explain that again.', 'No, that is not what I asked.', 'I meant the previous bill.'])(
    'waits for finality before accepting a directed correction or request: %s', (text) => {
      const input = { text, answer: '請準備以下文件。', elapsedMs: 1000 }
      expect(classifyInterruption({ ...input, final: false }, options)).toBe('wait')
      expect(classifyInterruption({ ...input, final: true }, options)).toBe('interrupt')
    },
  )

  it.each(['停一下', '請停一下再操作', 'Can you repeat that?', '請準備帳單'])(
    'suppresses short exact echo and echo containing stop or request wording: %s', (text) => {
      const input = { text, answer: `您剛才說${text}，我會為您處理。`, elapsedMs: 1000 }
      expect(classifyInterruption({ ...input, final: true }, options)).toBe('ignore')
      expect(classifyInterruption({ ...input, final: false }, options)).toBe('wait')
    },
  )
})
