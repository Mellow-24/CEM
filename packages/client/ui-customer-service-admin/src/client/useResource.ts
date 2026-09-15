/** Component-local asynchronous snapshot loading. */

import { useEffect, useState } from 'react'

/** Load lifecycle rendered by each independent Settings page. */
export type ResourceState<Value> =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly value: Value }

/**
 * Load one component-owned snapshot and expose an explicit retry action.
 * @param load - Stable callback that reads the page snapshot.
 * @returns Current load state and a callback that starts a fresh attempt.
 */
export function useResource<Value>(load: () => Promise<Value>): {
  readonly state: ResourceState<Value>
  readonly retry: () => void
} {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ResourceState<Value>>({ status: 'loading' })

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void Promise.resolve().then(load).then(
      (value) => { if (current) setState({ status: 'ready', value }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [attempt, load])

  return {
    state,
    retry: () => { setAttempt(value => value + 1) },
  }
}
