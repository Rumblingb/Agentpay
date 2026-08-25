import Script from 'next/script';

/**
 * Privacy-gated GA4 loader. It is deliberately inert until both the exact
 * founder-approved measurement ID and an explicit consent flag are present in
 * the deployment environment. No user/session/payment identifiers are sent.
 */
export default function Analytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const consentGranted = process.env.NEXT_PUBLIC_ANALYTICS_CONSENT === 'granted';

  if (!measurementId || !/^G-[A-Z0-9]+$/i.test(measurementId) || !consentGranted) return null;

  const bootstrap = [
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js', new Date());",
    `gtag('config', '${measurementId}', { send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false });`,
  ].join('\n');

  return (
    <>
      <Script async src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} />
      <Script id="agentpay-ga4" strategy="afterInteractive">
        {bootstrap}
      </Script>
    </>
  );
}
