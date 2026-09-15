/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-09-05.1'

/** The complete editable internal-testing notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '內測聲明',
    body: '深繹未來智能服務平臺現處於演示與優化階段。我們會持續完善模型服務、知識管理與會話營運能力，並歡迎業務團隊提出真實場景中的改進建議。\n\n平臺致力於為行業客戶提供可信、易用、可持續演進的智能服務體驗。',
    continueLabel: '繼續',
  },
  en: {
    title: 'Internal Testing Notice',
    body: 'Shenyi Future Intelligent Service Platform is in its demonstration and refinement phase. We are continuously improving model service, knowledge management, and conversation operations, and welcome feedback from real business scenarios.\n\nThe platform is designed to deliver a trusted, approachable, and evolving intelligent-service experience for industry teams.',
    continueLabel: 'Continue',
  },
} as const
