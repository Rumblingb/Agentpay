'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RcmSignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/rcm-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        router.push('/rcm-onboard');
      } else {
        setError(data.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#0d0d0d', border: '1px solid #1c1c1c',
    borderRadius: 8, color: '#e8e8e8', fontSize: 14, padding: '11px 14px',
    outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
  };

  return (
    <div style={{ background: '#050505', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill="black" fillOpacity={0.9}/></svg>
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.03em', color: '#fff' }}>Ace</span>
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.04em', color: '#fff', margin: '0 0 8px' }}>
          Create your free workspace
        </h1>
        <p style={{ fontSize: 14, color: '#525252', margin: '0 0 32px', lineHeight: 1.5 }}>
          Ace will walk you through setup in under 10 minutes. No credit card, no IT setup.
        </p>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
            borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f87171', marginBottom: 20,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#404040', marginBottom: 8 }}>
              Practice or billing company name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={set('name')}
              placeholder="Riverside Family Medicine"
              required
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = 'rgba(16,185,129,0.4)')}
              onBlur={e => (e.target.style.borderColor = '#1c1c1c')}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#404040', marginBottom: 8 }}>
              Your email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={set('email')}
              placeholder="you@yourpractice.com"
              required
              autoComplete="email"
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = 'rgba(16,185,129,0.4)')}
              onBlur={e => (e.target.style.borderColor = '#1c1c1c')}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#404040', marginBottom: 8 }}>
              Password
            </label>
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder="At least 8 characters"
              required
              autoComplete="new-password"
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = 'rgba(16,185,129,0.4)')}
              onBlur={e => (e.target.style.borderColor = '#1c1c1c')}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8, background: loading ? '#059669' : '#10b981', color: '#000',
              border: 'none', borderRadius: 8, padding: '13px', fontSize: 14,
              fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '-0.01em',
              opacity: loading ? 0.8 : 1,
            }}
          >
            {loading ? 'Creating workspace…' : 'Create free workspace →'}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 12, color: '#2a2a2a', lineHeight: 1.6 }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#404040', textDecoration: 'none' }}>Sign in →</Link>
        </p>
        <p style={{ marginTop: 8, fontSize: 11, color: '#1c1c1c', lineHeight: 1.5 }}>
          By creating an account you agree to our terms of service. Your data is encrypted and never shared with payers.
        </p>
      </div>
    </div>
  );
}
