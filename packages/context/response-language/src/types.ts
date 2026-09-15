/** Pure response-language types shared by Host and Client programs. */

/** A fixed language the model can use for its response. */
export type FixedResponseLanguage =
  | 'zh-Hans'
  | 'zh-Hant'
  | 'yue-Hant-MO'
  | 'yue-Hant-HK'
  | 'en'
  | 'pt'

/** The user's session preference: automatic resolution or one fixed language. */
export type ResponseLanguagePreference = 'auto' | FixedResponseLanguage

/** Why one request resolved to its fixed response language. */
export type ResponseLanguageResolutionBasis =
  | 'fixed'
  | 'detected'
  | 'carried'
  | 'fallback'

/** The latest request resolution exposed to presentation code. */
export interface ResponseLanguageResolution {
  /** Fixed language supplied to the model. */
  language: FixedResponseLanguage
  /** Rule that selected {@link language}. */
  basis: ResponseLanguageResolutionBasis
}

/** One selectable response-language preference. */
export interface ResponseLanguageOption {
  /** Stable value written through the response-language command. */
  value: ResponseLanguagePreference
  /** Language autonym displayed by clients. */
  name: string
}

/** Whole response-language projection for one session. */
export interface ResponseLanguageProjection {
  /** Whether the session's current agent composition provides this capability. */
  available: boolean
  /** Closed preference list in display order. */
  options: ResponseLanguageOption[]
  /** User-selected automatic or fixed preference. */
  currentValue: ResponseLanguagePreference
  /** Latest request resolution, absent before the first model request. */
  resolved?: ResponseLanguageResolution
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Logged response-language preference, availability, and latest request resolution. */
    responseLanguage: ResponseLanguageProjection
  }
}
