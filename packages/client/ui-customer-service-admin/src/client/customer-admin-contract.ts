/** Slot contracts for the standalone CEM operations portal. */

import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One keyed business page rendered by the standalone operations shell. */
    'customer-admin.page': {
      kind: 'keyed'
      scope: 'root'
      owner: CustomerAdminPageOwnerProps
    }
  }
}

/** Navigation supplied by the standalone shell to each business page. */
export interface CustomerAdminPageOwnerProps {
  /** Leave the operations portal for the customer-facing service. */
  close: () => void
  /** Select another operations page. */
  navigate: (id: string) => void
  /** Distinguish the standalone CEM shell from the legacy Settings host. */
  standalone: true
}

/** Root props for the standalone portal and its keyed page outlet. */
export type CustomerAdminPortalProps = PropsRuntime<'root'>
  & PropsLocale<'settings.customerServiceAdmin'>
  & PropsRenderSlots<'customer-admin.page'>
