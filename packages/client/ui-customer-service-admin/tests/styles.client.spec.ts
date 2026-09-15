import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/AdminSection.module.css', import.meta.url)), 'utf8')
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

describe('customer-service admin styles', () => {
  it('uses only declared semantic alias variables and no literal colors', () => {
    const named = [...css.matchAll(/var\((--[a-z0-9-]+)/gu)].map(match => match[1])
    expect([...new Set(named)].filter(name => !String(name).startsWith('--dsw-alias-'))).toEqual([])
    expect([...new Set(named)].filter(name => !tokens.includes(`  ${String(name)}:`))).toEqual([])
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu)
  })

  it('keeps every CSS block balanced', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//gu, '')
    expect((bare.match(/\{/gu) ?? []).length).toBe((bare.match(/\}/gu) ?? []).length)
  })
})
