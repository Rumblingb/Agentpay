export const metadata = { title: 'Privacy Policy - Ace by AgentPay' };

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 680,
        margin: '0 auto',
        padding: '48px 24px',
        fontFamily: 'system-ui, sans-serif',
        lineHeight: 1.7,
        color: '#111',
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>
        Last updated: March 24, 2026 · <a href="mailto:bro@agentpay.so" style={{ color: '#0066cc' }}>bro@agentpay.so</a>
      </p>

      <p>
        Ace is designed to keep your booking flow calm, private, and deliberate. This page explains what stays on your
        device and what is shared only when needed to complete your journey.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>What Stays On Your Device</h2>
      <p>
        Your saved travel profile, journey history, and active trip state are stored locally on this device. Sensitive
        profile access is protected in-app with biometric checks where supported.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>What Ace Sends</h2>
      <p>
        Ace sends only the information needed to understand voice requests, plan journeys, check live travel data,
        process payment steps, and secure the booking you confirm. Booking details may be shared with fulfilment
        services or operators when needed to secure a real ticket.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Permissions</h2>
      <p>
        Microphone access is used for voice requests. Biometric access is used to protect sensitive profile and
        confirmation actions. Notifications, if enabled, are used for booking and journey updates.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Payments and Journey Data</h2>
      <p>
        Ace may store booking references, timing, route details, and receipt metadata so your journey can reopen cleanly
        after you close the app. Ace does not store full card numbers or payment credentials - payments are processed by
        Stripe (UK) and Razorpay (India).
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Questions</h2>
      <p>
        Contact us at <a href="mailto:bro@agentpay.so" style={{ color: '#0066cc' }}>bro@agentpay.so</a> for any privacy
        questions.
      </p>
    </main>
  );
}
