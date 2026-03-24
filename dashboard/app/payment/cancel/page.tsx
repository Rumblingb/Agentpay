'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CancelContent() {
  const params = useSearchParams();
  const jobId  = params.get('jobId') ?? '';

  // scheme is "meridian" as registered in app.json — NOT "so.agentpay.meridian"
  const broDeepLink = jobId
    ? `meridian://status/${jobId}`
    : `meridian://`;

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.icon}>✕</div>
        <h1 style={styles.title}>Payment cancelled</h1>
        <p style={styles.body}>
          No charge was made. Your booking request is still held — return to Bro to pay and secure your ticket.
        </p>
        <a href={broDeepLink} style={styles.btn}>
          Return to Bro
        </a>
        <p style={styles.hint}>
          If the app doesn&apos;t open automatically, switch back to Bro manually.
        </p>
      </div>
    </main>
  );
}

export default function PaymentCancelPage() {
  return (
    <Suspense>
      <CancelContent />
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
    fontSize: '32px',
    color: '#f87171',
    background: '#1c0a0a',
    borderRadius: '50%',
    width: '72px',
    height: '72px',
    lineHeight: '72px',
    margin: '0 auto 20px',
    display: 'block',
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
    background: 'linear-gradient(135deg, #1e3a5f, #1d4ed8)',
    color: '#93c5fd',
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
