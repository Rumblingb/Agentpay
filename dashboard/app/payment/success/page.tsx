'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SuccessContent() {
  const params = useSearchParams();
  const jobId  = params.get('jobId') ?? '';

  // Deep-link back into the Bro app — scheme is "meridian" as registered in app.json
  const broDeepLink = `meridian://status/${jobId}`;

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.icon}>✓</div>
        <h1 style={styles.title}>Payment confirmed</h1>
        <p style={styles.body}>
          Your payment went through. Bro is securing your ticket — details arrive by email within 15 minutes.
        </p>
        {jobId && (
          <a href={broDeepLink} style={styles.btn}>
            Return to Bro
          </a>
        )}
        <p style={styles.hint}>
          If the app doesn&apos;t open automatically, switch back to Bro manually.
        </p>
      </div>
    </main>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense>
      <SuccessContent />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    background: '#111',
    border: '1px solid #1f2937',
    borderRadius: '16px',
    padding: '40px 32px',
    maxWidth: '420px',
    width: '100%',
    textAlign: 'center',
  },
  icon: {
    fontSize: '48px',
    color: '#4ade80',
    marginBottom: '16px',
    display: 'block',
    background: '#052e16',
    borderRadius: '50%',
    width: '72px',
    height: '72px',
    lineHeight: '72px',
    margin: '0 auto 20px',
  },
  title: {
    color: '#f9fafb',
    fontSize: '22px',
    fontWeight: '700',
    margin: '0 0 12px',
  },
  body: {
    color: '#9ca3af',
    fontSize: '15px',
    lineHeight: '1.6',
    margin: '0 0 28px',
  },
  btn: {
    display: 'block',
    background: 'linear-gradient(135deg, #052e16, #14532d)',
    color: '#4ade80',
    padding: '14px 24px',
    borderRadius: '10px',
    textDecoration: 'none',
    fontWeight: '600',
    fontSize: '15px',
    marginBottom: '16px',
  },
  hint: {
    color: '#4b5563',
    fontSize: '13px',
    margin: 0,
  },
};
