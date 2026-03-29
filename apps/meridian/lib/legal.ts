export type LegalDocKey = 'terms' | 'privacy';

export interface LegalDoc {
  title: string;
  updatedAt: string;
  intro: string;
  supportEmail: string;
  sections: Array<{
    heading: string;
    body: string[];
  }>;
}

export const LEGAL_SUPPORT_EMAIL = 'bro@agentpay.so';

export const LEGAL_DOCS: Record<LegalDocKey, LegalDoc> = {
  terms: {
    title: 'Terms of Service',
    updatedAt: 'March 24, 2026',
    supportEmail: LEGAL_SUPPORT_EMAIL,
    intro:
      'These terms govern your use of Ace during this early outdoor AI release. Ace helps you plan and secure journeys across the transport modes currently supported by the app, but a journey is only confirmed once Ace shows a real booking confirmation or reference.',
    sections: [
      {
        heading: 'What Ace Does',
        body: [
          'Ace helps you search, compare, and secure journeys in the markets and transport modes currently supported by the app.',
          'Some journeys may be completed through partner services or manual fulfilment while Ace is in early release.',
        ],
      },
      {
        heading: 'Booking Confirmation',
        body: [
          'A payment confirmation is not the same as a booking confirmation.',
          'Your journey is only confirmed when Ace shows a valid receipt, booking reference, or confirmation message that the ticket has actually been secured.',
        ],
      },
      {
        heading: 'Your Responsibilities',
        body: [
          'You are responsible for providing accurate passenger, contact, and travel details.',
          'You should review the journey details before you confirm payment or booking.',
        ],
      },
      {
        heading: 'Early Access Limits',
        body: [
          'Ace is being released to a limited testing cohort and may not support every route, operator, or edge case.',
          'Ace may decline or defer requests that fall outside the current supported scope.',
        ],
      },
      {
        heading: 'Support',
        body: [
          'If something looks wrong, stop and contact the Ace team before travelling.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    updatedAt: 'March 24, 2026',
    supportEmail: LEGAL_SUPPORT_EMAIL,
    intro:
      'Ace is designed to keep your journey flow calm, safe, and minimal. This screen explains what stays on your device and what is shared only when needed to complete your trip.',
    sections: [
      {
        heading: 'What Stays On Your Device',
        body: [
          'Your saved travel profile, journey history, and active trip state are stored locally on this device.',
          'Sensitive profile access is protected in-app with biometric checks where supported.',
        ],
      },
      {
        heading: 'What Ace Sends',
        body: [
          'Ace sends only the information needed to transcribe voice requests, plan journeys, check live transport data, process payment steps, and secure the booking you confirm.',
          'Booking details may be shared with fulfilment services or operators when needed to secure a real ticket.',
        ],
      },
      {
        heading: 'Permissions',
        body: [
          'Microphone access is used for voice requests.',
          'Biometric access is used to protect sensitive profile and confirmation actions.',
          'Notifications, if enabled, are used for booking and journey updates.',
        ],
      },
      {
        heading: 'Payments and Journey Data',
        body: [
          'Ace may store booking references, timing, route details, and receipt metadata so your journey can reopen cleanly after you close the app.',
          'Ace does not ask you to place model, payment, or infrastructure secrets in the mobile app.',
        ],
      },
      {
        heading: 'Questions',
        body: [
          'For questions about privacy during this early release, contact the Ace team before sharing travel-critical information.',
        ],
      },
    ],
  },
};
