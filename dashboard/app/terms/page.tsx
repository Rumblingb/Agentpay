export const metadata = { title: 'Terms of Service - Ace by AgentPay' };

export default function TermsPage() {
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
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Terms of Service</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>
        Last updated: March 24, 2026 · <a href="mailto:bro@agentpay.so" style={{ color: '#0066cc' }}>bro@agentpay.so</a>
      </p>

      <p>
        These terms govern your use of Ace during this early train-first release. Ace helps you plan and secure journeys,
        but a journey is only confirmed once Ace shows a real booking confirmation or reference.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>What Ace Does</h2>
      <p>
        Ace helps you search, compare, and secure train journeys in the markets currently supported by the app. Some
        journeys may be completed through partner services or manual fulfilment while Ace is in early release.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Booking Confirmation</h2>
      <p>
        A payment confirmation is not the same as a booking confirmation. Your journey is only confirmed when Ace shows a
        valid receipt, booking reference, or confirmation message that the ticket has actually been secured.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Your Responsibilities</h2>
      <p>
        You are responsible for providing accurate passenger, contact, and travel details. You should review the journey
        details before you confirm payment or booking.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Early Access</h2>
      <p>
        Ace is being released to a limited testing cohort and may not support every route, operator, or edge case. Ace
        may decline or defer requests that fall outside the current train-first scope.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Refunds</h2>
      <p>
        If a booking cannot be fulfilled, you will receive a full refund to your original payment method within 5-7
        business days. Contact us at <a href="mailto:bro@agentpay.so" style={{ color: '#0066cc' }}>bro@agentpay.so</a>{' '}
        immediately if something looks wrong.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Support</h2>
      <p>
        Contact <a href="mailto:bro@agentpay.so" style={{ color: '#0066cc' }}>bro@agentpay.so</a> for any issues. Stop
        and contact us before travelling if something looks wrong with your booking.
      </p>
    </main>
  );
}
