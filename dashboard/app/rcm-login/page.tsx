'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ── Field ─────────────────────────────────────────────────────────────────────

function Field({
  label, type, value, onChange, onBlur, placeholder, autoComplete, error, inputRef,
}: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; onBlur?: () => void;
  placeholder: string; autoComplete?: string;
  error?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [focused, setFocused] = useState(false);
  const C = { border: '#1c1c1c', accentBorder: 'rgba(16,185,129,0.35)', errorBorder: 'rgba(244,63,94,0.35)' };
  const borderColor = error ? C.errorBorder : focused ? C.accentBorder : C.border;

  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#555', marginBottom: 8 }}>
        {label}
      </label>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{
          width: '100%', background: '#0d0d0d',
          border: `1px solid ${borderColor}`,
          borderRadius: 10, color: '#ededef', fontSize: 15,
          padding: '13px 14px', outline: 'none', boxSizing: 'border-box',
          transition: 'border-color 0.15s', fontFamily: 'Inter, system-ui, sans-serif',
        }}
      />
      {error && <div style={{ marginTop: 6, fontSize: 12, color: '#fb7185' }}>{error}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RcmLoginPage() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ email: '', apiKey: '' });
  const [errors, setErrors] = useState({ email: '', apiKey: '' });
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { emailRef.current?.focus(); }, []);

  function setField(field: keyof typeof form) {
    return (v: string) => {
      setForm(f => ({ ...f, [field]: v }));
      if (errors[field]) setErrors(e => ({ ...e, [field]: '' }));
      setApiError('');
    };
  }

  function blurValidateEmail() {
    const v = form.email.trim();
    if (!v) setErrors(e => ({ ...e, email: 'Email is required.' }));
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) setErrors(e => ({ ...e, email: 'Enter a valid email address.' }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailErr = !form.email.trim() ? 'Email is required.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? 'Enter a valid email address.' : '';
    const keyErr = !form.apiKey.trim() ? 'Access key is required.' : '';
    setErrors({ email: emailErr, apiKey: keyErr });
    if (emailErr || keyErr) return;

    setLoading(true);
    setApiError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim().toLowerCase(), apiKey: form.apiKey.trim() }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        router.push('/rcm');
      } else {
        setApiError(data.error ?? 'Invalid email or access key.');
      }
    } catch {
      setApiError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: '#050505', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="fade-up" style={{ width: '100%', maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill="black" fillOpacity={0.9}/></svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.03em', color: '#ededef' }}>Ace</span>
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: '#ededef', margin: '0 0 8px' }}>
          Sign in to Ace Billing
        </h1>
        <p style={{ fontSize: 14, color: '#737373', margin: '0 0 32px', lineHeight: 1.6 }}>
          Enter your email and the access key from your welcome email.
        </p>

        {/* API error banner */}
        {apiError && (
          <div style={{ background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.18)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#fb7185', marginBottom: 20, lineHeight: 1.5 }}>
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={setField('email')}
            onBlur={blurValidateEmail}
            placeholder="you@yourpractice.com"
            autoComplete="email"
            error={errors.email}
            inputRef={emailRef}
          />
          <Field
            label="Access key"
            type="password"
            value={form.apiKey}
            onChange={setField('apiKey')}
            placeholder="The key from your welcome email"
            autoComplete="current-password"
            error={errors.apiKey}
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: loading ? '#059669' : '#10b981', color: '#000',
              border: 'none', borderRadius: 10, padding: '14px',
              fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '-0.01em', opacity: loading ? 0.85 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {loading && (
              <svg className="spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="rgba(0,0,0,0.3)" strokeWidth="2"/>
                <path d="M8 2a6 6 0 0 1 6 6" stroke="#000" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            )}
            {loading ? 'Signing in\u2026' : 'Sign in \u2192'}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 13, color: '#444' }}>
          New to Ace?{' '}
          <Link href="/rcm-signup" style={{ color: '#737373', textDecoration: 'none', fontWeight: 500 }}>Activate your agent &rarr;</Link>
        </p>

        <p style={{ marginTop: 10, fontSize: 12, color: '#3a3a3a', lineHeight: 1.5 }}>
          Can&rsquo;t find your key? Check the welcome email from notifications@agentpay.so
        </p>

      </div>
    </div>
  );
}
