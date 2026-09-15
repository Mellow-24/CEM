import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as InvariantPlugin from '../src/invariant.ts'

describe('customer-service Wiki invariant companion', () => {
  it('registers package ownership and returns the registry disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const ctx = { invariants: { register } } as unknown as Context
    expect(InvariantPlugin.name).toBe('customer-service-wiki-invariant')
    expect(InvariantPlugin.inject).toEqual(['invariants'])
    const result = await InvariantPlugin.apply(ctx)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-customer-service-wiki', expect.any(Function))
    result()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
