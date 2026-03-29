'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CancelContent() {
  const params = useSearchParams();
  const jobId = params.get('jobId') ?? '';
  const aceDeepLink = jobId ? `meridian://status/${jobId}` : 'meridian://';

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.eyebrow}>ACE</div>
        <div style={styles.icon}>✕</div>
        <h1 style={styles.title}>Payment cancelled</h1>
        <p style={styles.body}>
          No charge was made. Ace is still holding your request, and you can return when you are ready to secure the journey.
        </p>
        <a href={aceDeepLink} style={styles.btn}>
          Return to Ace
        </a>
        <p style={styles.hint}>
          If Ace does not reopen automatically, switch back to the app to continue from the same trip.
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
    background:
      'radial-gradient(circle at top, rgba(212, 194, 163, 0.1), transparent 36%), linear-gradient(180deg, #070707, #0f1115)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    background: 'linear-gradient(180deg, rgba(17,17,17,0.98), rgba(10,10,10,0.98))',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '24px',
    padding: '40px 32px',
    maxWidth: '420px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 32px 80px rgba(0,0,0,0.45)',
  },
  eyebrow: {
    color: '#d4c2a3',
    fontSize: '11px',
    letterSpacing: '0.36em',
    textTransform: 'uppercase',
    marginBottom: '18px',
  },
  icon: {
    fontSize: '32px',
    color: '#f5c2c2',
    background: 'radial-gradient(circle at 30% 30%, #4a2323, #1c0a0a 72%)',
    borderRadius: '50%',
    width: '72px',
    height: '72px',
    lineHeight: '72px',
    margin: '0 auto 20px',
    display: 'block',
  },
  title: {
    color: '#f9fafb',
    fontSize: '24px',
    fontWeight: '700',
    margin: '0 0 12px',
  },
  body: {
    color: '#c8ccd2',
    fontSize: '15px',
    lineHeight: '1.6',
    margin: '0 0 28px',
  },
  btn: {
    display: 'block',
    background: 'linear-gradient(135deg, #2a3346, #415070)',
    color: '#f4f0e6',
    padding: '14px 24px',
    borderRadius: '14px',
    textDecoration: 'none',
    fontWeight: '600',
    fontSize: '15px',
    marginBottom: '16px',
  },
  hint: {
    color: '#8a8f98',
    fontSize: '13px',
    margin: 0,
  },
};
