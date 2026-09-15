/** Mobile navigation over the same resident Session, composer, and tool slots as the desktop frame. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { AppFrameProps } from './AppFrame.tsx'
import css from './MobileFrame.module.css'

/**
 * Render a single mobile panel while keeping conversation and navigation state mounted.
 * @param props - Root slot runtime, render authority, and layout store.
 * @returns Mobile application frame.
 */
export function MobileFrame({ useSessions, useStore, actions, renderSlot }: AppFrameProps) {
  const current = useSessions(s => s.current)
  const summary = useSessions(s => s.current === undefined ? undefined : s.byId[s.current])
  const panels = useStore(s => s)
  const frame = useRef<HTMLDivElement>(null)
  const previous = useRef(current)
  const [width, setWidth] = useState(window.innerWidth)
  const pane = panels.details > 0 ? 'details' : panels.narrowExpanded ? 'sessions' : 'chat'

  useLayoutEffect(() => { actions.setNarrow(true) }, [actions])
  useLayoutEffect(() => {
    if (previous.current === current) return
    previous.current = current
    actions.closeDetails()
    actions.closeSidebar()
  }, [current, actions])

  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const resize = (): void => {
      setWidth(viewport?.width ?? window.innerWidth)
      frame.current?.style.setProperty('--mobile-height', `${viewport?.height ?? window.innerHeight}px`)
      frame.current?.style.setProperty('--mobile-top', `${viewport?.offsetTop ?? 0}px`)
    }
    const source = viewport ?? window
    resize()
    source.addEventListener('resize', resize)
    source.addEventListener('scroll', resize)
    return () => {
      source.removeEventListener('resize', resize)
      source.removeEventListener('scroll', resize)
    }
  }, [])

  const showChat = (): void => {
    actions.closeDetails()
    actions.closeSidebar()
  }

  return <div ref={frame} className={css.frame} data-mobile-app>
    <header className={css.header}>
      <span className={css.brand} aria-hidden="true">深</span>
      <div className={css.heading}>
        <span>深绎未来 · 移动助手</span>
        <strong>{summary?.title || '开始一段新对话'}</strong>
      </div>
      <a href="/" className={css.desktop}>网页版</a>
    </header>
    <section className={css.panel} hidden={pane !== 'chat'} aria-label="当前对话">
      {renderSlot('conversation', {})}
    </section>
    <section className={`${css.panel} ${css.sessions}`} hidden={pane !== 'sessions'} aria-label="会话与设置">
      {renderSlot('sidebar', { collapsed: false, width })}
    </section>
    <section className={css.panel} hidden={pane !== 'details'} aria-label="执行详情">
      {renderSlot('details', {})}
    </section>
    <nav className={css.navigation} aria-label="手机导航">
      <button type="button" aria-current={pane === 'chat' ? 'page' : undefined} onClick={showChat}>对话</button>
      <button type="button" aria-current={pane === 'sessions' ? 'page' : undefined} onClick={() => {
        actions.closeDetails()
        if (!panels.narrowExpanded) actions.toggleSidebar()
      }}>会话与设置</button>
      <button type="button" disabled={summary === undefined || summary.blank} aria-current={pane === 'details' ? 'page' : undefined}
        onClick={() => { actions.openDetails() }}>执行详情</button>
    </nav>
    <div className={css.overlays}>{renderSlot('shell.overlay', {})}</div>
  </div>
}
