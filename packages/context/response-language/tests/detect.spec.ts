import { describe, expect, it } from 'vitest'
import {
  carriesPriorResponseLanguage,
  detectResponseLanguage,
  languageBearingText,
} from '../src/detect.ts'

describe('response-language detector', () => {
  it.each([
    ['點樣取消自動轉賬？', 'yue-Hant-MO'],
    ['有冇其他繳費方法呀？', 'yue-Hant-MO'],
    ['這個電費賬單可以網上轉賬嗎？', 'zh-Hant'],
    ['这个电费账单可以网上转账吗？', 'zh-Hans'],
    ['我现在的自动转账失败了怎么办？', 'zh-Hans'],
    ['How can I cancel automatic payment?', 'en'],
    ['Meter reading and contract number', 'en'],
    ['Power outage status', 'en'],
    ['Please reply in English', 'en'],
    ['English please', 'en'],
    ['Como posso cancelar o pagamento do cartão?', 'pt'],
    ['Yes, you can pay the electricity bill online.', 'en'],
    ['Sim, você pode pagar a fatura de eletricidade online.', 'pt'],
  ])('detects %j as %s', (text, language) => {
    expect(detectResponseLanguage(text)?.language).toBe(language)
  })

  it.each([
    '', 'OK', '你好', '12345', 'App', 'Thank you very much.', 'thank u', 'bye bye',
    '好的，非常感谢。 Thank you very much.',
  ])('leaves ambiguous or continuity-only input %j unresolved', (text) => {
    expect(detectResponseLanguage(text)).toBeUndefined()
  })

  it.each([
    'Thank you very much.',
    'thank u',
    'bye bye',
    'OK, thanks',
    '好的，非常感谢。 Thank you very much.',
    'Thanks, CEM App',
  ])('treats %j as a session-language continuation', (text) => {
    expect(carriesPriorResponseLanguage(text)).toBe(true)
  })

  it.each([
    'How can I check my electricity bill?',
    'Thank you, can I cancel automatic payment?',
    'Please reply in English',
    'Obrigado, thank you',
  ])('does not treat substantive or explicit input %j as a continuation', (text) => {
    expect(carriesPriorResponseLanguage(text)).toBe(false)
  })

  it('excludes paired quotations before mixed-language detection', () => {
    expect(detectResponseLanguage('请解释 “How are you?”')?.language).toBe('zh-Hans')
    expect(detectResponseLanguage('請解釋 "How are you?"')?.language).toBe('zh-Hant')
    expect(detectResponseLanguage('Please explain “Como pagar a fatura?”')?.language).toBe('en')
    expect(detectResponseLanguage('Pode explicar "How can I pay the bill?"')?.language).toBe('pt')
  })

  it('preserves unmatched quotation text', () => {
    expect(languageBearingText('Please explain "an unfinished quote')).toBe('Please explain "an unfinished quote')
    expect(detectResponseLanguage('Please explain "como pagar')).toBeUndefined()
  })

  it('excludes blockquotes, code, and URLs from voting', () => {
    const text = [
      '請解釋這個問題',
      '> How can I cancel automatic payment?',
      '```text',
      'Please answer in English',
      '```',
      'https://example.test/how-to-pay',
    ].join('\n')
    expect(detectResponseLanguage(text)?.language).toBe('zh-Hant')
  })

  it('prefers direct Chinese wording over embedded Latin product names', () => {
    expect(detectResponseLanguage('點樣用 CEM App cancel payment？')?.language).toBe('yue-Hant-MO')
  })

  it('keeps region-neutral Cantonese markers on the existing Macau result', () => {
    expect(detectResponseLanguage('我而家想問屋企風水有冇問題？')?.language).toBe('yue-Hant-MO')
  })

  it('lets a substantially longer Latin request win over incidental Chinese script', () => {
    expect(detectResponseLanguage('这个 Please help cancel automatic payment')?.language).toBe('en')
  })
})
