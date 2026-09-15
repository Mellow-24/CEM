/** Compact line icons and the CEM mark used by the mobile presentation. */
import type { CSSProperties } from 'react'
import css from './MobileChat.module.css'

export type IconName = 'mic' | 'phone' | 'chat' | 'send' | 'keyboard' | 'bill' | 'card' | 'bolt' | 'home' | 'chevron' | 'back' | 'close' | 'plus' | 'stop'

/** Render a decorative icon; the owning button supplies its accessible name. */
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8',
    phone: 'M7 3 4 4c-3 2 2 10 5 13s8 5 10 2l2-3-5-3-2 2c-3-1-5-3-5-5l2-2-4-5Z',
    chat: 'M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2ZM7 11h.1M12 11h.1M17 11h.1',
    send: 'm4 3 17 9-17 9 3-9-3-9Zm3 9h14',
    keyboard: 'M3 5h18v14H3V5ZM6 8h.1M10 8h.1M14 8h.1M18 8h.1M6 11h.1M10 11h.1M14 11h.1M18 11h.1M7 15h10',
    bill: 'M6 2h8l5 5v15H5V2h1Zm8 0v6h5M8 12h8M8 16h8',
    card: 'M3 4h18v16H3V4ZM3 9h18M6 15h3M12 15h2',
    bolt: 'm14 2-11 12h8l-1 8 11-13h-8l1-7Z',
    home: 'm2 11 10-9 10 9M5 9v13h14V9M10 22v-8h4v8',
    chevron: 'm9 4 8 8-8 8', back: 'm15 4-8 8 8 8', close: 'm5 5 14 14M19 5 5 19',
    plus: 'M12 4v16M4 12h16', stop: 'M6 6h12v12H6V6Z',
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

/** Original supplied emblem cropped by layout only; no generated replacement logo. */
export function Logo({ compact = false, markOnly = false }: { compact?: boolean; markOnly?: boolean }) {
  return <span className={`${css.logo} ${compact ? css.logoCompact : ''}`} role="img" aria-label="澳電 CEM">
    <span className={css.logoMark}><img src="/cem-mobile/logo.jpeg" alt="" /></span>
    {!markOnly && <span className={css.logoType} aria-hidden="true"><b><img src="/cem-mobile/logo.jpeg" alt="" /></b><i><img src="/cem-mobile/logo.jpeg" alt="" /></i></span>}
  </span>
}

/** Decorative voice activity; the readable label remains the status authority. */
export function Wave({ active = false }: { active?: boolean }) {
  return <span className={css.wave} data-active={active} aria-hidden="true">
    {[4, 9, 5, 13, 8, 18, 12, 26, 36, 44, 32, 48, 38, 29, 20, 13, 7, 11, 5, 8, 3].map((height, index) =>
      <i key={index} style={{ '--bar': `${height}px`, '--delay': `${index * 55}ms` } as CSSProperties} />)}
  </span>
}
