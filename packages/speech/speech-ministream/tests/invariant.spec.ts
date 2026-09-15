import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('MiniStream invariant companion', () => {
  it('reserves the package invariant slot', async () => {
    const register = vi.fn(() => vi.fn())
    const ctx = new Context()
    ctx.provide('invariants', { register } as never)
    expect(name).toBe('speech-ministream-invariant')
    expect(inject).toEqual(['invariants'])
    await expect(apply(ctx)).resolves.toEqual(expect.any(Function))
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-speech-ministream', expect.any(Function))
  })
})
