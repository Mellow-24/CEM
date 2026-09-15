/**
 * Shell chrome content registered into the trigger and header seats: the
 * sidebar trigger icon and label plus the console title. The section ledger
 * selects ordinary Settings copy or customer-service operations copy.
 */
import { IconSettingsOutline14, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import css from './chrome.module.css'

/** Reactive mode shared by the trigger and console-title contributions. */
export interface SettingsChromeInjected {
  hooks: {
    /** Whether the customer-service overview is present in the section ledger. */
    managementMode: HostObservable<boolean>
  }
}

/** Trigger content props: sidebar state, locale, and the derived console mode. */
export type TriggerContentProps =
  PropsRuntime<'settings.trigger'> & PropsLocale<'settings'> & InjectFace<SettingsChromeInjected>

/** Header content props: locale and the derived console mode. */
export type HeaderContentProps =
  PropsRuntime<'settings.header'> & PropsLocale<'settings'> & InjectFace<SettingsChromeInjected>

/**
 * Render the trigger row content (icon; label only in the wide column).
 * @param props - composed slot props.
 * @returns the trigger content fragment.
 */
export function TriggerContent({ wide, useManagementMode, t }: TriggerContentProps) {
  const managementMode = useManagementMode(value => value)
  return (
    <>
      {wide ? <IconSettingsOutline16 size={16} /> : <IconSettingsOutline14 size={18} />}
      {wide && <span className={css.triggerLabel}>{t(managementMode ? 'management.trigger' : 'trigger')}</span>}
    </>
  )
}

/**
 * Render the settings or operations-console title.
 * @param props - composed slot props.
 * @returns the title text node.
 */
export function HeaderContent({ useManagementMode, t }: HeaderContentProps) {
  const managementMode = useManagementMode(value => value)
  return <>{managementMode && <span className={css.brandMark} aria-hidden="true">深</span>}<span>{t(managementMode ? 'management.title' : 'title')}</span></>
}

/** Close-button label text props: the standard locale seat only. */
export type CloseLabelProps = PropsRuntime<'settings.close'> & PropsLocale<'settings'>

/**
 * Render the close button's visually-hidden label text.
 * @param props - composed slot props.
 * @returns the label text node.
 */
export function CloseLabel({ t }: CloseLabelProps) {
  return <>{t('close')}</>
}
