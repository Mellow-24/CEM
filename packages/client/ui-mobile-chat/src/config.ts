/** Deployment options for the isolated mobile customer entry. */
import z from '@deepseek-ai/schemastery'

/** Mobile entry selection, permitted service presets, and spoken language. */
export interface Config {
  /** Whether the default mobile document also selects the CEM interface. */
  entryMode: 'preview' | 'default'
  /** Customer agent selected for a new conversation. */
  defaultPreset: string
  /** Customer agents available in service selection and history. */
  servicePresets: string[]
  /** Spoken language passed to the Host's speech configuration. */
  language: string
}

export const Config: z<Config> = z.object({
  entryMode: z.union(['preview', 'default']).default('preview'),
  defaultPreset: z.string().default('macau-customer-service'),
  servicePresets: z.array(z.string()).default(['macau-customer-service', 'macau-customer-service-wiki']),
  language: z.string().default('yue'),
})
