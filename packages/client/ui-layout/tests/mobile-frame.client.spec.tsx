// @vitest-environment jsdom
/** Mobile panel lifetime, Session selection, and visual-viewport geometry. */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { AppFrameProps } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import { MobileFrame } from '@deepseek-ai/dsh-client-ui-layout/src/client/MobileFrame.tsx'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'

function mount() {
  const instance = createLayoutStore().create()
  let selected: string | undefined = 'first'
  let blank = false
  const useSessions: AppFrameProps['useSessions'] = selector => selector({
    current: selected,
    byId: selected === undefined ? {} : { [selected]: { title: selected, blank } },
  } as SessionListState)
  const subscribe = (listener: () => void) => instance.subscribe(listener)
  const getSnapshot = () => instance.getSnapshot()
  const useStore: AppFrameProps['useStore'] = selector =>
    selector(useSyncExternalStore(subscribe, getSnapshot))
  const renderSlot: AppFrameProps['renderSlot'] = (name, props) =>
    <div data-testid={name} data-owner={JSON.stringify(props)}><input defaultValue="draft" /></div>
  const element = <MobileFrame useSessions={useSessions} useStore={useStore} actions={instance.actions}
    renderSlot={renderSlot} useWorkspaces={() => { throw new Error('unused Workspace hook') }} SessionProvider={() => null} />
  const view = render(element)
  return { ...view, instance, select(id: string | undefined, isBlank = false) {
    selected = id
    blank = isBlank
    view.rerender(<MobileFrame {...element.props} />)
  } }
}

beforeEach(() => { vi.stubGlobal('visualViewport', null) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps panel DOM and drafts mounted and returns to chat on Session changes', () => {
  const view = mount()
  const chat = view.getByTestId('conversation')
  const input = chat.querySelector('input')!
  fireEvent.change(input, { target: { value: 'unfinished draft' } })
  fireEvent.click(view.getByRole('button', { name: '会话与设置' }))
  expect(chat.closest('section')!.hidden).toBe(true)
  expect(view.getByTestId('sidebar').closest('section')!.hidden).toBe(false)
  fireEvent.click(view.getByRole('button', { name: '对话' }))
  expect(view.getByTestId('conversation')).toBe(chat)
  expect(input.value).toBe('unfinished draft')
  fireEvent.click(view.getByRole('button', { name: '执行详情' }))
  expect(view.getByTestId('details').closest('section')!.hidden).toBe(false)
  view.select('second')
  expect(chat.closest('section')!.hidden).toBe(false)
  expect(view.instance.getSnapshot().details).toBe(0)
  fireEvent.click(view.getByRole('button', { name: '会话与设置' }))
  view.select('blank', true)
  expect(chat.closest('section')!.hidden).toBe(false)
  expect(view.getByRole('button', { name: '执行详情' }).hasAttribute('disabled')).toBe(true)
  view.select(undefined)
  expect(view.getByText('开始一段新对话')).toBeTruthy()
})

it('resizes for the keyboard and removes visual-viewport listeners on unmount', () => {
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0 })
  const remove = vi.spyOn(viewport, 'removeEventListener')
  vi.stubGlobal('visualViewport', viewport)
  const view = mount()
  const frame = view.container.firstElementChild as HTMLElement
  expect(frame.style.getPropertyValue('--mobile-height')).toBe('844px')
  act(() => {
    Object.assign(viewport, { width: 360, height: 400, offsetTop: 12 })
    viewport.dispatchEvent(new Event('resize'))
  })
  expect(frame.style.getPropertyValue('--mobile-height')).toBe('400px')
  expect(frame.style.getPropertyValue('--mobile-top')).toBe('12px')
  expect(JSON.parse(view.getByTestId('sidebar').dataset.owner!)).toEqual({ collapsed: false, width: 360 })
  view.unmount()
  expect(remove.mock.calls.map(call => call[0])).toEqual(['resize', 'scroll'])
})
