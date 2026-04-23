'use client';

import { useState } from 'react';
import Link from 'next/link';

const VOLUME_OPTIONS = [
  { value: '1-50',    label: '1–50 trips/month' },
  { value: '50-500',  label: '50–500 trips/month' },
  { value: '500+',    label: '500+ trips/month' },
  { value: 'unsure',  label: 'Not sure yet' },
];

const USE_CASE_OPTIONS = [
  { value: 'embed',       label: 'Embed Ace into my product', sub: 'Your customers speak, Ace books.' },
  { value: 'white_label', label: 'White-label for my clients', sub: 'Your brand, Ace underneath.' },
  { value: 'api',         label: 'API — build on top', sub: 'Raw access to the booking engine.' },
  { value: 'other',       label: 'Not sure yet', sub: 'Tell us what you need.' },
];

export default function PartnerPage() {
  const [name, setName]       = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail]     = useState('');
  const [volume, setVolume]   = useState('');
  const [useCase, setUseCase] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus]   = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !company.trim() || !email.trim()) return;
    setStatus('sending');
    try {
      const res = await fetch('/api/partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, company, email, volume, useCase, message }),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div style={{ background: '#080808', minHeight: '100vh', color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        input, textarea, select { outline: none; }
        input:focus, textarea:focus { border-color: #334155 !important; }
        .use-case-card { cursor: pointer; transition: border-color 0.15s, background 0.15s; }
        .use-case-card:hover { border-color: #334155 !important; }
        .use-case-card.selected { border-color: #4ade80 !important; background: rgba(74,222,128,0.06) !important; }
      `}</style>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid #0f172a', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href="/" style={{ fontSize: 18, fontWeight: 900, color: '#f8fafc', textDecoration: 'none', letterSpacing: -0.5 }}>ACE</Link>
        <Link href="/join" style={{ fontSize: 13, color: '#4ade80', textDecoration: 'none' }}>Try Ace free →</Link>
      </nav>

      <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 600, letterSpacing: 1, marginBottom: 12 }}>FOR OPERATORS</div>
          <h1 style={{ fontSize: 40, fontWeight: 900, margin: '0 0 16px', lineHeight: 1.1, letterSpacing: -1 }}>
            Bring Ace to<br />your customers.
          </h1>
          <p style={{ fontSize: 16, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
            Travel agencies, corporate desks, and booking platforms use Ace as the voice booking layer. One sentence from your customer, one confirmed trip in their inbox.
          </p>
        </div>

        {/* Trust strip */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 48, flexWrap: 'wrap' }}>
          {[
            ['No service fee', 'April — zero cost to test'],
            ['UK + India rail', 'Live today, EU + flights next'],
            ['Full control', 'Your brand, your pricing'],
          ].map(([title, sub]) => (
            <div key={title} style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>{title}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Form or success */}
        {status === 'done' ? (
          <div style={{ background: '#0a1a0f', border: '1px solid #166534', borderRadius: 16, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: '#4ade80' }}>We will be in touch.</h2>
            <p style={{ color: '#86efac', margin: '0 0 24px', lineHeight: 1.6 }}>
              Check your inbox — confirmation sent. Expect a reply within 24 hours.
            </p>
            <Link href="/join" style={{ fontSize: 14, color: '#64748b', textDecoration: 'none' }}>
              Try Ace yourself while you wait →
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>

            {/* Name + company */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Your name</label>
                <input
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder="Alex Chen"
                  required
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Company</label>
                <input
                  value={company} onChange={e => setCompany(e.target.value)}
                  placeholder="Wanderlust Travel"
                  required
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Email */}
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Work email</label>
              <input
                type="email"
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="alex@wanderlust.com"
                required
                style={inputStyle}
              />
            </div>

            {/* Volume */}
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Booking volume</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {VOLUME_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVolume(opt.value)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: `1px solid ${volume === opt.value ? '#4ade80' : '#1e293b'}`,
                      background: volume === opt.value ? 'rgba(74,222,128,0.08)' : 'transparent',
                      color: volume === opt.value ? '#4ade80' : '#94a3b8',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontWeight: volume === opt.value ? 600 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Use case */}
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>What are you looking for?</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {USE_CASE_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    className={`use-case-card${useCase === opt.value ? ' selected' : ''}`}
                    onClick={() => setUseCase(opt.value)}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: `1px solid ${useCase === opt.value ? '#4ade80' : '#1e293b'}`,
                      background: useCase === opt.value ? 'rgba(74,222,128,0.06)' : 'transparent',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc', marginBottom: 2 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{opt.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Optional message */}
            <div style={{ marginBottom: 32 }}>
              <label style={labelStyle}>Anything else? <span style={{ color: '#475569' }}>(optional)</span></label>
              <textarea
                value={message} onChange={e => setMessage(e.target.value)}
                placeholder="Existing stack, timeline, specific routes you need..."
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={status === 'sending'}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: 12,
                border: 'none',
                background: status === 'sending' ? '#1e293b' : '#f8fafc',
                color: status === 'sending' ? '#64748b' : '#080808',
                fontSize: 15,
                fontWeight: 700,
                cursor: status === 'sending' ? 'default' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {status === 'sending' ? 'Sending…' : 'Request early access'}
            </button>

            {status === 'error' && (
              <p style={{ color: '#f87171', fontSize: 13, textAlign: 'center', marginTop: 12 }}>
                Something went wrong. Email us directly: <a href="mailto:hello@agentpay.so" style={{ color: '#f87171' }}>hello@agentpay.so</a>
              </p>
            )}

          </form>
        )}

        <p style={{ marginTop: 32, fontSize: 12, color: '#334155', textAlign: 'center' }}>
          Looking to use Ace yourself?{' '}
          <Link href="/join" style={{ color: '#64748b', textDecoration: 'none' }}>Get early access →</Link>
        </p>
      </main>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#64748b',
  fontWeight: 600,
  letterSpacing: 0.4,
  marginBottom: 6,
  textTransform: 'uppercase',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 10,
  padding: '12px 14px',
  color: '#f8fafc',
  fontSize: 14,
  fontFamily: 'inherit',
};
