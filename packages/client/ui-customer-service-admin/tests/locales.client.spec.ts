import { describe, expect, it } from 'vitest'
import { en, pt, zh } from '../src/client/locales.ts'

describe('customer-service admin dictionaries', () => {
  it('keeps the English and Portuguese dictionaries aligned with Chinese product copy', () => {
    expect(Object.keys(en)).toEqual(Object.keys(zh))
    expect(Object.keys(pt)).toEqual(Object.keys(zh))
    expect(zh.overviewNav).toBe('營運總覽')
    expect(en.overviewNav).toBe('Operations overview')
    expect(pt.overviewNav).toBe('Visão geral')
    expect(pt.knowledgeTitle).toBe('Conteúdos e validação da pesquisa')
  })
})
