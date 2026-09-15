// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { ResponseLanguageProjection } from '@deepseek-ai/dsh-response-language/client'
import {
  ResponseLanguageSelect,
  type ResponseLanguageSelectInjected,
  type ResponseLanguageSelectProps,
} from '../src/client/ResponseLanguageSelect.tsx'
import { en, zh } from '../src/client/locales.ts'

const t: ResponseLanguageSelectProps['t'] = makeTranslate(zh, commonZh)
const enT: ResponseLanguageSelectProps['t'] = makeTranslate(en, commonEn)

const options: ResponseLanguageProjection['options'] = [
  { value: 'auto', name: '自动' },
  { value: 'zh-Hans', name: '简体中文' },
  { value: 'zh-Hant', name: '繁體中文' },
  { value: 'yue-Hant-MO', name: '澳門粵語' },
  { value: 'yue-Hant-HK', name: '香港粵語' },
  { value: 'en', name: 'English' },
  { value: 'pt', name: 'Português' },
]

function projection(overrides: Partial<ResponseLanguageProjection> = {}): ResponseLanguageProjection {
  return {
    available: true,
    options,
    currentValue: 'auto',
    ...overrides,
  }
}

function props(
  value: ResponseLanguageProjection | undefined,
  select: ResponseLanguageSelectInjected['select'] = vi.fn().mockResolvedValue(null),
  owner: { removed?: boolean; phase?: 'plain' | 'claimed' | 'adjudicating' | 'submitting' } = {},
): ResponseLanguageSelectProps {
  return {
    session: { removed: owner.removed ?? false },
    input: { phase: owner.phase ?? 'plain' },
    useProjection: () => value,
    select,
    t,
  } as unknown as ResponseLanguageSelectProps
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ResponseLanguageSelect', () => {
  it('renders nothing while the capability is absent or unavailable', () => {
    const view = render(<ResponseLanguageSelect {...props(undefined)} />)
    expect(view.container.firstChild).toBeNull()

    view.rerender(<ResponseLanguageSelect {...props(projection({ available: false }))} />)
    expect(view.container.firstChild).toBeNull()
  })

  it('lists the seven advertised preferences and keeps a fixed selection independent of auto resolution', () => {
    render(<ResponseLanguageSelect {...props(projection({
      currentValue: 'en',
      resolved: { language: 'yue-Hant-MO', basis: 'detected' },
    }))} />)

    const trigger = screen.getByRole('button', { name: '回复语言：English' })
    fireEvent.click(trigger)
    expect(screen.getAllByRole('menuitem').map(item => item.textContent))
      .toEqual(['自动', '简体中文', '繁體中文', '澳門粵語', '香港粵語', 'English', 'Português'])
    expect(screen.getByRole('menuitem', { name: 'English' }).querySelector('svg')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('localizes Auto from the UI locale while fixed-language names remain autonyms', () => {
    const value = projection({ currentValue: 'auto' })
    const view = render(<ResponseLanguageSelect {...props(value)} />)
    expect(screen.getByRole('button', { name: '回复语言：自动' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '回复语言：自动' }))
    expect(screen.getByRole('menuitem', { name: '自动' })).toBeTruthy()

    view.rerender(<ResponseLanguageSelect {...{ ...props(value), t: enT }} />)
    expect(screen.getByRole('button', { name: 'Response language: Auto' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Auto' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Português' })).toBeTruthy()

    view.rerender(<ResponseLanguageSelect {...{
      ...props(projection({ currentValue: 'yue-Hant-HK' })),
      t: enT,
    }} />)
    expect(screen.getByRole('button', { name: 'Response language: 香港粵語' })).toBeTruthy()
  })

  it('optimistically shows one selection, single-flights it, and settles from the projected value', async () => {
    let resolve!: (failure: string | null) => void
    const select = vi.fn(() => new Promise<string | null>((done) => { resolve = done }))
    let value = projection({ currentValue: 'en' })
    const view = render(<ResponseLanguageSelect {...props(value, select)} />)

    fireEvent.click(screen.getByRole('button', { name: '回复语言：English' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Português' }))
    expect(select).toHaveBeenCalledOnce()
    expect(select).toHaveBeenCalledWith('pt')
    const saving = screen.getByRole<HTMLButtonElement>('button', { name: '正在切换回复语言为 Português' })
    expect(saving.disabled).toBe(true)
    fireEvent.click(saving)
    expect(select).toHaveBeenCalledOnce()

    await act(async () => { resolve(null) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在切换回复语言为 Português' }).disabled).toBe(true)

    value = projection({ currentValue: 'pt' })
    view.rerender(<ResponseLanguageSelect {...props(value, select)} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '回复语言：Português' })).toHaveProperty('disabled', false)
    })
  })

  it('does not submit the already selected preference and falls back when its advertised row is absent', () => {
    const select = vi.fn().mockResolvedValue(null)
    const current = projection({ currentValue: 'en' })
    const view = render(<ResponseLanguageSelect {...props(current, select)} />)
    fireEvent.click(screen.getByRole('button', { name: '回复语言：English' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'English' }))
    expect(select).not.toHaveBeenCalled()

    view.rerender(<ResponseLanguageSelect {...props(projection({ currentValue: 'en', options: [] }), select)} />)
    expect(screen.getByRole('button', { name: '回复语言：回复语言' })).toBeTruthy()
  })

  it('surfaces an admitted failure, restores the projected value, and dismisses the toast', async () => {
    vi.useFakeTimers()
    const select = vi.fn().mockResolvedValue('policy denied')
    render(
      <div data-composer-card>
        <ResponseLanguageSelect {...props(projection({ currentValue: 'auto' }), select)} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '回复语言：自动' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'English' }))

    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toContain('切换回复语言失败：policy denied')
    expect(screen.getByRole('button', { name: '回复语言：自动' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('normalizes Error and hostile-string rejections and ignores settlement after unmount', async () => {
    const rejected = vi.fn().mockRejectedValue('transport dropped')
    const first = render(<ResponseLanguageSelect {...props(projection(), rejected)} />)
    fireEvent.click(screen.getByRole('button', { name: '回复语言：自动' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'English' }))
    expect((await screen.findByRole('alert')).textContent)
      .toContain('切换回复语言失败：transport dropped')
    first.unmount()

    const errorRejected = vi.fn().mockRejectedValue(new Error('network down'))
    const second = render(<ResponseLanguageSelect {...props(projection(), errorRejected)} />)
    fireEvent.click(screen.getByRole('button', { name: '回复语言：自动' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'English' }))
    expect((await screen.findByRole('alert')).textContent)
      .toContain('切换回复语言失败：network down')
    second.unmount()

    let resolve!: (failure: string | null) => void
    const delayed = vi.fn(() => new Promise<string | null>((done) => { resolve = done }))
    const third = render(<ResponseLanguageSelect {...props(projection(), delayed)} />)
    fireEvent.click(screen.getByRole('button', { name: '回复语言：自动' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'English' }))
    third.unmount()
    await act(async () => { resolve(null) })
  })

  it.each([
    [{ removed: true }, true],
    [{ phase: 'adjudicating' as const }, true],
    [{ phase: 'submitting' as const }, true],
    [{ phase: 'claimed' as const }, false],
  ])('locks only for removed or submission-owned input states: %j', (owner, disabled) => {
    render(<ResponseLanguageSelect {...props(projection(), undefined, owner)} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '回复语言：自动' }).disabled)
      .toBe(disabled)
  })

  it('closes an open menu when the session becomes locked', async () => {
    const view = render(<ResponseLanguageSelect {...props(projection())} />)
    fireEvent.click(screen.getByRole('button', { name: '回复语言：自动' }))
    expect(screen.getByRole('menu')).toBeTruthy()

    view.rerender(<ResponseLanguageSelect {...props(projection(), undefined, { removed: true })} />)
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('uses the fixed preference, not a differently resolved language, after a session switch', () => {
    const view = render(<ResponseLanguageSelect {...props(projection({
      currentValue: 'zh-Hans',
      resolved: { language: 'en', basis: 'fixed' },
    }))} />)
    expect(screen.getByRole('button', { name: '回复语言：简体中文' })).toBeTruthy()

    view.rerender(<ResponseLanguageSelect {...props(projection({
      currentValue: 'yue-Hant-HK',
      resolved: { language: 'pt', basis: 'fixed' },
    }))} />)
    expect(screen.getByRole('button', { name: '回复语言：香港粵語' })).toBeTruthy()
  })
})
