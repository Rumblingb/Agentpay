'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateEmail(v: string): string {
  if (!v.trim()) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Enter a valid email address.';
  return '';
}

function validateName(v: string): string {
  if (!v.trim()) return 'Practice name is required.';
  if (v.trim().length < 2) return 'Must be at least 2 characters.';
  return '';
}

function passwordStrength(v: string): 0 | 1 | 2 | 3 {
  if (v.length < 8) return v.length > 0 ? 1 : 0;
  const hasUpper = /[A-Z]/.test(v);
  const hasNum = /[0-9]/.test(v);
  const hasSymbol = /[^A-Za-z0-9]/.test(v);
  const variety = [hasUpper, hasNum, hasSymbol].filter(Boolean).length;
  if (variety >= 2) return 3;
  if (variety === 1) return 2;
  return 1;
}

// ── Field ─────────────────────────────────────────────────────────────────────

function Field({
  label, type, value, onChange, onBlur, placeholder, autoComplete, error, hint, strength, inputRef,
}: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; onBlur?: () => void;
  placeholder: string; autoComplete?: string;
  error?: string; hint?: string;
  strength?: 0 | 1 | 2 | 3;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [focused, setFocused] = useState(false);
  const C = { border: '#1c1c1c', accentBorder: 'rgba(16,185,129,0.35)', errorBorder: 'rgba(244,63,94,0.35)' };
  const borderColor = error ? C.errorBorder : focused ? C.accentBorder : C.border;

  const strengthColors = ['transparent', '#f59e0b', '#a3e635', '#10b981'];
  const strengthLabels = ['', 'Weak', 'Fair', 'Strong'];

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
      {/* Password strength bar */}
      {strength !== undefined && value.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{ flex: 1, height: 3, borderRadius: 2, background: strength >= n ? strengthColors[strength] : '#1c1c1c', transition: 'background 0.2s' }} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: strengthColors[strength] }}>{strengthLabels[strength]}</div>
        </div>
      )}
      {error && <div style={{ marginTop: 6, fontSize: 12, color: '#fb7185' }}>{error}</div>}
      {!error && hint && <div style={{ marginTop: 6, fontSize: 12, color: '#555' }}>{hint}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RcmSignupPage() {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [errors, setErrors] = useState({ email: '', name: '', password: '' });
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [legalError, setLegalError] = useState('');

  // Autofocus email on mount
  useEffect(() => { nameRef.current?.focus(); }, []);

  function setField(field: keyof typeof form) {
    return (v: string) => {
      setForm(f => ({ ...f, [field]: v }));
      if (errors[field]) setErrors(e => ({ ...e, [field]: '' }));
      setApiError('');
    };
  }

  function blurValidate(field: 'email' | 'name') {
    if (field === 'email') setErrors(e => ({ ...e, email: validateEmail(form.email) }));
    if (field === 'name') setErrors(e => ({ ...e, name: validateName(form.name) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailErr = validateEmail(form.email);
    const nameErr = validateName(form.name);
    const passErr = form.password.length < 8 ? 'Password must be at least 8 characters.' : '';
    const lglErr = !legalAccepted ? 'You must accept the Terms, Privacy Policy, and Business Associate Agreement to continue.' : '';
    setErrors({ email: emailErr, name: nameErr, password: passErr });
    setLegalError(lglErr);
    if (emailErr || nameErr || passErr || lglErr) return;

    setLoading(true);
    setApiError('');
    try {
      const res = await fetch('/api/rcm-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          legalAccepted: true,
          legalAcceptedAt: new Date().toISOString(),
          legalVersion: 'rcm-2026-04-15',
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        router.push('/rcm-onboard');
      } else {
        const msg = data.error ?? 'Something went wrong.';
        setApiError(msg);
      }
    } catch {
      setApiError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const strength = passwordStrength(form.password);
  const isDuplicate = apiError.toLowerCase().includes('already registered') || apiError.toLowerCase().includes('already in use');

  return (
    <div style={{ background: '#050505', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="fade-up" style={{ width: '100%', maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill="black" fillOpacity={0.9}/></svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.03em', color: '#ededef' }}>Ace</span>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ width: 20, height: 4, borderRadius: 2, background: '#10b981' }} />
            <div style={{ width: 20, height: 4, borderRadius: 2, background: '#1c1c1c' }} />
          </div>
          <span style={{ fontSize: 11, color: '#555', fontWeight: 500 }}>Step 1 of 2 — Create account</span>
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: '#ededef', margin: '0 0 8px' }}>
          Activate your billing agent
        </h1>
        <p style={{ fontSize: 14, color: '#737373', margin: '0 0 32px', lineHeight: 1.6 }}>
          {"You'll"} have an AI agent working your revenue cycle in 10 minutes. No credit card, no IT setup.
        </p>

        {/* API error banner */}
        {apiError && (
          <div style={{ background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.18)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#fb7185', marginBottom: 20, lineHeight: 1.5 }}>
            {apiError}
            {isDuplicate && (
              <> · <Link href="/login" style={{ color: '#fca5a5', fontWeight: 600, textDecoration: 'none' }}>Sign in instead →</Link></>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Field
            label="Your email"
            type="email"
            value={form.email}
            onChange={setField('email')}
            onBlur={() => blurValidate('email')}
            placeholder="you@yourpractice.com"
            autoComplete="email"
            error={errors.email}
            inputRef={nameRef}
          />
          <Field
            label="Practice or billing company name"
            type="text"
            value={form.name}
            onChange={setField('name')}
            onBlur={() => blurValidate('name')}
            placeholder="Riverside Family Medicine"
            autoComplete="organization"
            error={errors.name}
          />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={setField('password')}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            error={errors.password}
            strength={strength}
            hint={form.password.length === 0 ? 'Mix letters, numbers, and symbols for a stronger password' : undefined}
          />

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginTop: 4 }}>
            <input
              type="checkbox"
              checked={legalAccepted}
              onChange={e => { setLegalAccepted(e.target.checked); if (e.target.checked) setLegalError(''); }}
              style={{ marginTop: 2, accentColor: '#10b981', width: 16, height: 16, flexShrink: 0 }}
            />
            <span style={{ fontSize: 12, color: '#737373', lineHeight: 1.6 }}>
              I agree to the{' '}
              <Link href="/terms" target="_blank" style={{ color: '#a3e635', textDecoration: 'underline' }}>Terms of Service</Link>,{' '}
              <Link href="/privacy" target="_blank" style={{ color: '#a3e635', textDecoration: 'underline' }}>Privacy Policy</Link>, and{' '}
              <Link href="/baa" target="_blank" style={{ color: '#a3e635', textDecoration: 'underline' }}>Business Associate Agreement</Link>. I confirm I am authorized to bind this practice.
            </span>
          </label>
          {legalError && <div style={{ marginTop: -10, fontSize: 12, color: '#fb7185' }}>{legalError}</div>}

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
            {loading ? 'Activating agent\u2026' : 'Activate agent \u2192'}
          </button>
        </form>

        <div style={{ marginTop: 24, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span style={{ fontSize: 12, color: '#444', lineHeight: 1.6 }}>
            Your data is encrypted and never shared with payers. HIPAA-compliant storage.
          </span>
        </div>

        <p style={{ marginTop: 20, fontSize: 13, color: '#444' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#737373', textDecoration: 'none', fontWeight: 500 }}>Sign in →</Link>
        </p>

      </div>
    </div>
  );
}
