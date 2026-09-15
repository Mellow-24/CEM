/** Composer reply-language selector over the Host-computed session projection. */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, IconChevronDownOutline14, IconGlobeOutline14, IconWarningOutline16, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ResponseLanguageOption, ResponseLanguagePreference,
} from '@deepseek-ai/dsh-response-language/client'
// Type-only: pulls the conversation.input.right SlotMap member and its
// InputZone owner share into this component's compile face.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ResponseLanguageSelect.module.css'

/** Registration-side mutation face for one session's reply-language preference. */
export interface ResponseLanguageSelectInjected {
  /**
   * Persist a complete automatic or fixed preference.
   * @param preference - advertised response-language option value.
   * @returns null when admitted, otherwise a user-visible failure line.
   */
  select: (preference: ResponseLanguagePreference) => Promise<string | null>
}

/** Full component props: input-zone owner + session kit + injected mutation + locale seat. */
export type ResponseLanguageSelectProps =
  PropsRuntime<'conversation.input.right'>
  & InjectFace<ResponseLanguageSelectInjected>
  & PropsLocale<'responseLanguage'>

/** One in-flight selection, retained after admission until its projection frame lands. */
interface PendingSelection {
  value: ResponseLanguagePreference
  admitted: boolean
}

/** Auto follows the active UI locale; fixed languages keep their Host-supplied autonyms. */
function optionName(option: ResponseLanguageOption, t: ResponseLanguageSelectProps['t']): string {
  return option.value === 'auto' ? t('option.auto') : option.name
}

/** Preserve ordinary Error copy while still containing non-Error rejections. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render the response-language selector. The selected row always reflects the
 * persisted preference; the latest auto-resolution never changes this control.
 * @param props - composed slot props.
 * @returns the selector, or null while the Host does not advertise the capability.
 */
export function ResponseLanguageSelect({
  session, input, useProjection, select, t,
}: ResponseLanguageSelectProps) {
  const projection = useProjection('responseLanguage')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const aliveRef = useRef(true)
  const locked = session.removed || input.phase === 'adjudicating' || input.phase === 'submitting'

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    if (projection?.available === true && !locked) return
    setOpen(false)
  }, [locked, projection?.available])

  useEffect(() => {
    if (pending?.admitted !== true || projection?.currentValue !== pending.value) return
    setPending(null)
  }, [pending, projection?.currentValue])

  if (projection === undefined || !projection.available) return null

  const displayedValue = pending?.value ?? projection.currentValue
  const displayedOption = projection.options.find(option => option.value === displayedValue)
  const displayedName = displayedOption === undefined ? t('trigger.fallback') : optionName(displayedOption, t)
  const busy = pending !== null

  const showFailure = (message: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text: t('error.select', { message }) })
  }

  const choose = (preference: ResponseLanguagePreference): void => {
    setOpen(false)
    if (pending !== null || preference === projection.currentValue) return
    setPending({ value: preference, admitted: false })
    setToast(null)
    void (async () => {
      let failure: string | null
      try {
        failure = await select(preference)
      } catch (error: unknown) {
        failure = errorMessage(error)
      }
      if (!aliveRef.current) return
      if (failure === null) {
        setPending({ value: preference, admitted: true })
        return
      }
      setPending(null)
      showFailure(failure)
    })()
  }

  return (
    <span ref={rootRef} className={css.root}>
      <Menu
        open={open}
        items={projection.options.map(option => ({ id: option.value, label: optionName(option, t) }))}
        selectedId={displayedValue}
        onSelect={(value) => { choose(value as ResponseLanguagePreference) }}
        onClose={() => { setOpen(false) }}
        align="end"
        side="top"
        anchor={(
          <Button
            variant="ghost"
            size="sm"
            icon={<IconGlobeOutline14 />}
            className={css.trigger}
            aria-label={busy
              ? t('trigger.saving', { name: displayedName })
              : t('trigger.aria', { name: displayedName })}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-busy={busy}
            title={t('trigger.title', { name: displayedName })}
            disabled={locked || busy}
            onClick={() => { setOpen(value => !value) }}
          >
            <span className={css.label}>{displayedName}</span>
            <span className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} aria-hidden>
              <IconChevronDownOutline14 />
            </span>
          </Button>
        )}
      />
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </span>
  )
}
