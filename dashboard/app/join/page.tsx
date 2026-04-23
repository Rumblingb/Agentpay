'use client';

import { useState } from 'react';
import Link from 'next/link';

// Update this with the real TestFlight URL once the build is live
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/agentpay';

const PROOF_POINTS = [
  { icon: '🎙️', title: 'Say the trip once', body: 'London Paddington to Bristol tomorrow morning, cheapest option. Done.' },
  { icon: '⚡', title: 'Ace books it', body: 'Route, fare, railcard discount, checkout — handled without you touching a form.' },
  { icon: '✓',  title: 'You approve in one tap', body: 'Face ID confirm. Ticket to your inbox. Ace stays watching for delays.' },
];

const SOCIAL_PROOF = [
  '"Booked in 40 seconds. Ace even applied my railcard."',
  '"I didn\'t touch a single dropdown."',
  '"It just worked. First try."',
];

export default function JoinPage() {
  const [email, setEmail]   = useState('');
  const [name, setName]     = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [tfUrl, setTfUrl]   = useState(TESTFLIGHT_URL);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      });
      const data = await res.json() as { ok?: boolean; testflightUrl?: string };
      if (res.ok && data.ok) {
        if (data.testflightUrl) setTfUrl(data.testflightUrl);
        setStatus('done');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div style={{ background: '#080808', minHeight: '100vh', color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.5s ease forwards; }
        input { outline: none; }
        input:focus { border-color: #334155 !important; }
        @media (max-width: 640px) {
          .hero-title { font-size: 36px !important; }
          .proof-grid { grid-template-columns: 1fr !important; }
          .hero-pad { padding: 48px 20px 64px !important; }
        }
      `}</style>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid #0f172a', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href="/" style={{ fontSize: 18, fontWeight: 900, color: '#f8fafc', textDecoration: 'none', letterSpacing: -0.5 }}>ACE</Link>
        <Link href="/partner" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>For operators →</Link>
      </nav>

      <main>

        {/* Hero */}
        <section className="hero-pad" style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px 72px', textAlign: 'center' }}>

          {/* No-fee badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 100, padding: '5px 14px', marginBottom: 28 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>No service fee · April 2026</span>
          </div>

          <h1 className="hero-title" style={{ fontSize: 52, fontWeight: 900, margin: '0 0 20px', lineHeight: 1.05, letterSpacing: -1.5, color: '#f8fafc' }}>
            Say the trip.<br />Ace books it.
          </h1>

          <p style={{ fontSize: 18, color: '#94a3b8', lineHeight: 1.6, margin: '0 auto 40px', maxWidth: 480 }}>
            One sentence to your AI concierge. UK and India rail, confirmed in under a minute. No forms, no tabs, no service fee this month.
          </p>

          {/* Video placeholder — swap src for the real recording */}
          <div style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 20,
            overflow: 'hidden',
            marginBottom: 48,
            aspectRatio: '16/9',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{ textAlign: 'center', color: '#334155' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>▶</div>
              <div style={{ fontSize: 13 }}>45-second real booking demo</div>
              {/* Once you have the video: */}
              {/* <video autoPlay muted loop playsInline style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }}>
                <source src="/demo.mp4" type="video/mp4" />
              </video> */}
            </div>
          </div>

          {/* Signup form or success */}
          {status === 'done' ? (
            <div className="fade-up" style={{ background: '#0a1a0f', border: '1px solid #166534', borderRadius: 16, padding: '32px 24px' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#4ade80', marginBottom: 8 }}>You're in.</div>
              <p style={{ color: '#86efac', lineHeight: 1.6, margin: '0 0 24px' }}>
                Check your inbox — we sent the TestFlight link. Open it on your iPhone to install Ace.
              </p>
              <a
                href={tfUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', background: '#f8fafc', color: '#080808', padding: '14px 28px', borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: 'none' }}
              >
                Open TestFlight now →
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420, margin: '0 auto' }}>
              <input
                type="text"
                placeholder="Your name (optional)"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid #1e293b', background: '#0f172a', color: '#f8fafc', fontSize: 15, fontFamily: 'inherit' }}
              />
              <input
                type="email"
                placeholder="Your email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid #1e293b', background: '#0f172a', color: '#f8fafc', fontSize: 15, fontFamily: 'inherit' }}
              />
              <button
                type="submit"
                disabled={status === 'sending'}
                style={{
                  padding: '15px',
                  borderRadius: 12,
                  border: 'none',
                  background: status === 'sending' ? '#1e293b' : '#f8fafc',
                  color: status === 'sending' ? '#64748b' : '#080808',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: status === 'sending' ? 'default' : 'pointer',
                }}
              >
                {status === 'sending' ? 'Sending…' : 'Get early access'}
              </button>
              {status === 'error' && (
                <p style={{ color: '#f87171', fontSize: 13, textAlign: 'center', margin: 0 }}>
                  Something went wrong.{' '}
                  <a href={TESTFLIGHT_URL} style={{ color: '#f87171' }}>Open TestFlight directly →</a>
                </p>
              )}
              <p style={{ fontSize: 12, color: '#334155', textAlign: 'center', margin: 0 }}>
                iOS only right now. Android coming soon.
              </p>
            </form>
          )}
        </section>

        {/* How it works */}
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 80px' }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: '#64748b', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', marginBottom: 32 }}>How it works</h2>
          <div className="proof-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {PROOF_POINTS.map((p, i) => (
              <div key={i} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: '24px 20px' }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{p.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>{p.title}</div>
                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>{p.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Social proof */}
        <section style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 80px', textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {SOCIAL_PROOF.map((q, i) => (
              <div key={i} style={{ color: '#94a3b8', fontSize: 16, fontStyle: 'italic', lineHeight: 1.5 }}>
                {q}
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section style={{ borderTop: '1px solid #0f172a', padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 16px' }}>No service fee until May. Cancel anytime.</p>
          <a
            href={TESTFLIGHT_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-block', background: '#f8fafc', color: '#080808', padding: '14px 32px', borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: 'none' }}
          >
            Get Ace on TestFlight →
          </a>
          <div style={{ marginTop: 24 }}>
            <Link href="/partner" style={{ fontSize: 13, color: '#334155', textDecoration: 'none' }}>
              Are you a travel operator? →
            </Link>
          </div>
        </section>

      </main>
    </div>
  );
}
