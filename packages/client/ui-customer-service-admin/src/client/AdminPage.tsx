/** Shared presentation primitives for customer-service administration pages. */

import type { ReactNode } from 'react'
import css from './AdminSection.module.css'

interface AdminPageHeaderProps {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly badge?: string
}

interface ResourceFeedbackProps {
  readonly status: 'loading' | 'error' | 'ready'
  readonly onRetry: () => void
  readonly t: (key: 'loading' | 'loadError' | 'retry') => string
}

/**
 * Format a persisted ISO timestamp for the operator's locale.
 * @param timestamp - persisted timestamp text.
 * @returns localized text, or `undefined` when the timestamp is invalid.
 */
export function formatTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

/**
 * Render the common heading for an administration page.
 * @param props - localized heading copy and an optional status badge.
 * @returns the page header.
 */
export function AdminPageHeader({ eyebrow, title, description, badge }: AdminPageHeaderProps): ReactNode {
  return (
    <header className={css.pageHeader}>
      <div className={css.pageHeaderText}>
        <p className={css.eyebrow}>{eyebrow}</p>
        <h2 className={css.title}>{title}</h2>
        <p className={css.description}>{description}</p>
      </div>
      {badge === undefined ? null : <span className={css.liveBadge}>{badge}</span>}
    </header>
  )
}

/**
 * Render loading and retryable error feedback for a Remote resource.
 * @param props - resource phase, localized copy, and retry callback.
 * @returns phase feedback, or nothing after the resource becomes ready.
 */
export function ResourceFeedback({ status, onRetry, t }: ResourceFeedbackProps): ReactNode {
  if (status === 'loading') return <p className={css.statusPanel}>{t('loading')}</p>
  if (status === 'error') {
    return (
      <div className={css.errorPanel}>
        <p role="alert">{t('loadError')}</p>
        <button className={css.retryButton} type="button" onClick={onRetry}>{t('retry')}</button>
      </div>
    )
  }
  return null
}
