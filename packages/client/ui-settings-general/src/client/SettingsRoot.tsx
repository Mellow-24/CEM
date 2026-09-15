/**
 * Settings shell root: the sidebar-foot trigger row plus the near-full-
 * viewport operations console with its section navigation. The shell is
 * a pure composition face — every piece of text (trigger label, console title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve to that content (trigger: its own text; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Console
 * open state and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16, IconBrowseOutline16, IconCloseOutline16,
  IconDataOutline16, IconFolderOpenOutline16, IconInspectOutline12,
  IconPersonalizationOutline16, IconSettingsOutline16, IconSparkle16, IconBranchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  CUSTOMER_SERVICE_OVERVIEW_SECTION_ID,
  type SettingsRootComponentProps,
  type SettingsSectionRow,
} from './shell-contract.ts'
import css from './SettingsRoot.module.css'

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  if (id === CUSTOMER_SERVICE_OVERVIEW_SECTION_ID) return <IconSparkle16 className={css.navIcon} size={16} />
  if (id === 'customer-service-knowledge') return <IconFolderOpenOutline16 className={css.navIcon} size={16} />
  if (id === 'customer-service-sessions') return <IconBrowseOutline16 className={css.navIcon} size={16} />
  if (id === 'customer-service-evaluation') return <IconInspectOutline12 className={css.navIcon} size={16} />
  if (id === 'customer-service-agents') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'customer-service-flows') return <IconBranchOutline16 className={css.navIcon} size={16} />
  if (id === 'customer-service-voice') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'customer-service-reports') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  maintenanceLabel: () => string
  activeId: string | undefined
  fullPage: boolean
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Render the operations view as a full page when customer-service sections
 * are present, otherwise retain the ordinary Settings dialog. Both forms
 * close from the header button and document-level Escape; the dialog also
 * closes from its backdrop.
 */
function SettingsPanel({ rows, renderSlot, maintenanceLabel, activeId, fullPage, onSelect, onClose }: PanelProps) {
  const [maintenance, setMaintenance] = useState(false)
  const businessRows = rows.filter(row => row.id.startsWith('customer-service-'))
  const technicalRows = rows.filter(row => !row.id.startsWith('customer-service-'))
  const displayedRows = fullPage ? businessRows : rows
  // An explicit selection wins. Without one, deployments that register the
  // customer-service console open on its overview; other compositions retain
  // the first-section default.
  const active = rows.find(r => r.id === activeId)
    ?? rows.find(r => r.id === CUSTOMER_SERVICE_OVERVIEW_SECTION_ID)
    ?? rows[0]
  const titleId = useId()
  const sectionTitleId = useId()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  // Baseline focus management: entering the dialog lands on the close button.
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeButton.current?.focus() }, [])

  return (
    <div className={clsx(css.overlay, fullPage && css.fullPage)} role="presentation">
      {!fullPage && <div className={css.mask} aria-hidden="true" onClick={onClose} />}
      <div
        className={css.panel}
        role={fullPage ? 'region' : 'dialog'}
        aria-modal={fullPage ? undefined : true}
        aria-labelledby={titleId}
      >
        <nav className={css.nav} aria-labelledby={titleId}>
          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
          <div className={css.navList}>
            {displayedRows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.navCell, row.id === active?.id && css.active)}
                aria-current={row.id === active?.id ? 'page' : undefined}
                onClick={() => { onSelect(row.id) }}
              >
                {navIcon(row.id)}
                <span className={css.navLabel}>{row.label}</span>
              </button>
            ))}
          </div>
          {fullPage && technicalRows.length > 0 && <details className={css.maintenance} open={maintenance}
            onToggle={(event) => { setMaintenance(event.currentTarget.open) }}>
            <summary>{maintenanceLabel()}</summary>
            {technicalRows.map(row => <button key={row.id} type="button"
              className={clsx(css.navCell, row.id === active?.id && css.active)}
              aria-current={row.id === active?.id ? 'page' : undefined}
              onClick={() => { onSelect(row.id) }}>{navIcon(row.id)}{row.label}</button>)}
          </details>}
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            {active === undefined ? null : (
              <h2 className={css.sectionTitle} id={sectionTitleId}>{active.label}</h2>
            )}
            <div className={css.actions}>{(!fullPage || !active?.id.startsWith('customer-service-')) && renderSlot('settings.action', {})}</div>
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <section
            className={css.options}
            aria-labelledby={active === undefined ? titleId : sectionTitleId}
          >
            {active !== undefined && renderSlot('settings.section', { close: onClose, navigate: onSelect }, { only: active.id })}
          </section>
        </div>
      </div>
    </div>
  )
}

/**
 * Render the settings trigger and modal console.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const { wide, useSections, useOnboardingSteps, useSessions, renderSlot } = props
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
  }, [])
  const openSection = useCallback((id: string) => {
    setActiveId(id)
    setOpen(true)
  }, [])

  // Ledger changes rebuild the rows; locale revisions re-resolve label
  // thunks. The chrome seats re-render through their own outlet subscriptions.
  const rows = useSections(s => s)
  const fullPage = rows.some(row => row.id === CUSTOMER_SERVICE_OVERVIEW_SECTION_ID)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  return (
    <>
      <button
        type="button"
        className={clsx(css.trigger, !wide && css.rail)}
        aria-haspopup={fullPage ? undefined : 'dialog'}
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        {renderSlot('settings.trigger', { wide })}
      </button>
      {open && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          maintenanceLabel={props.maintenanceLabel}
          activeId={activeId}
          fullPage={fullPage}
          onSelect={setActiveId}
          onClose={close}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
