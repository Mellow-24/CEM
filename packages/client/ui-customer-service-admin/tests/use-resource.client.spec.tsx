// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useResource } from '../src/client/useResource.ts'

afterEach(cleanup)

function Probe({ load }: { load: () => Promise<string> }) {
  const resource = useResource(load)
  return <span>{resource.state.status}</span>
}

describe('useResource', () => {
  it('ignores both successful and failed attempts that settle after unmount', async () => {
    const success = Promise.withResolvers<string>()
    const loadSuccess = vi.fn(() => success.promise)
    const first = render(<Probe load={loadSuccess} />)
    expect(screen.getByText('loading')).toBeTruthy()
    await waitFor(() => { expect(loadSuccess).toHaveBeenCalledOnce() })
    first.unmount()
    await act(async () => { success.resolve('ready') })

    const failure = Promise.withResolvers<string>()
    const loadFailure = vi.fn(() => failure.promise)
    const second = render(<Probe load={loadFailure} />)
    await waitFor(() => { expect(loadFailure).toHaveBeenCalledOnce() })
    second.unmount()
    await act(async () => { failure.reject(new Error('offline')) })
  })
})
