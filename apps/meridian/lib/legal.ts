export type LegalDocKey = 'terms' | 'privacy';

export interface LegalDoc {
  title: string;
  updatedAt: string;
  intro: string;
  sections: Array<{
    heading: string;
    body: string[];
  }>;
}

export const LEGAL_DOCS: Record<LegalDocKey, LegalDoc> = {
  terms: {
    title: 'Terms of Service',
    updatedAt: 'March 24, 2026',
    intro:
      'These terms govern your use of Bro during this early train-first release. Bro helps you plan and secure journeys, but a journey is only confirmed once Bro shows a real booking confirmation or reference.',
    sections: [
      {
        heading: 'What Bro Does',
        body: [
          'Bro helps you search, compare, and secure train journeys in the markets currently supported by the app.',
          'Some journeys may be completed through partner services or manual fulfilment while Bro is in early release.',
        ],
      },
      {
        heading: 'Booking Confirmation',
        body: [
          'A payment confirmation is not the same as a booking confirmation.',
          'Your journey is only confirmed when Bro shows a valid receipt, booking reference, or confirmation message that the ticket has actually been secured.',
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
          'Bro is being released to a limited testing cohort and may not support every route, operator, or edge case.',
          'Bro may decline or defer requests that fall outside the current train-first scope.',
        ],
      },
      {
        heading: 'Support',
        body: [
          'If something looks wrong, stop and contact the Bro team before travelling.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    updatedAt: 'March 24, 2026',
    intro:
      'Bro is designed to keep your train booking flow calm, safe, and minimal. This screen explains what stays on your device and what is shared only when needed to complete your journey.',
    sections: [
      {
        heading: 'What Stays On Your Device',
        body: [
          'Your saved travel profile, journey history, and active trip state are stored locally on this device.',
          'Sensitive profile access is protected in-app with biometric checks where supported.',
        ],
      },
      {
        heading: 'What Bro Sends',
        body: [
          'Bro sends only the information needed to transcribe voice requests, plan journeys, check live rail data, process payment steps, and secure the booking you confirm.',
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
          'Bro may store booking references, timing, route details, and receipt metadata so your journey can reopen cleanly after you close the app.',
          'Bro does not ask you to place model, payment, or infrastructure secrets in the mobile app.',
        ],
      },
      {
        heading: 'Questions',
        body: [
          'For questions about privacy during this early release, contact the Bro team before sharing travel-critical information.',
        ],
      },
    ],
  },
};
