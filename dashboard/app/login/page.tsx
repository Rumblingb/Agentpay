'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, RefreshCw, Shield, Lock, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';

type HealthStatus = 'checking' | 'ok' | 'degraded' | 'unreachable';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setHealth(data.status === 'active' ? 'ok' : data.status === 'unreachable' ? 'unreachable' : 'degraded');
      })
      .catch(() => { if (!cancelled) setHealth('unreachable'); });
    return () => { cancelled = true; };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !apiKey.trim()) {
      setError('Email and API key are required.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        router.push('/overview');
      } else {
        setError(data.error || 'Invalid credentials.');
      }
    } catch {
      setError('Network error. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ background: '#050505', color: '#e8e8e8' }}
    >
      {/* Left panel — brand */}
      <div
        className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 px-12 py-12 border-r"
        style={{ borderColor: '#141414', background: '#070707' }}
      >
        <div>
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              <Zap size={18} className="text-black" fill="currentColor" />
            </div>
            <span
              className="text-[20px] font-bold tracking-[-0.03em] text-white"
            >
              AgentPay
            </span>
          </div>

          {/* Value prop */}
          <div className="space-y-6">
            <h2
              className="text-[32px] font-semibold tracking-[-0.04em] leading-[1.1] text-white"
            >
              Payment infrastructure for autonomous agents.
            </h2>
            <p className="text-[14px] text-[#525252] leading-relaxed">
              Create payment intents, verify settlement, enforce spending policy, and build portable economic reputation — all in one API.
            </p>
          </div>

          {/* Feature list */}
          <div className="mt-10 space-y-4">
            {[
              { label: 'AgentPassport', desc: 'Portable identity & spending policy per agent' },
              { label: 'Solana USDC', desc: 'On-chain settlement, confirmed in seconds' },
              { label: 'Policy engine', desc: 'Amount caps, daily limits, allowlists' },
              { label: 'Trust graph', desc: 'Verifiable economic reputation from settlements' },
            ].map(({ label, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <div
                  className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}
                >
                  <CheckCircle2 size={11} className="text-emerald-400" />
                </div>
                <div>
                  <span className="text-[13px] font-medium text-white">{label}</span>
                  <span className="text-[12px] text-[#404040] ml-2">{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-[11px] text-[#2a2a2a]">
          AgentPay — beta · MIT licensed
        </p>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2 mb-10">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              <Zap size={14} className="text-black" fill="currentColor" />
            </div>
            <span className="text-[17px] font-bold tracking-[-0.03em] text-white">AgentPay</span>
          </div>

          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-white mb-1">
            Operator sign in
          </h1>
          <p className="text-[13px] text-[#525252] mb-8">
            Enter your email and API key to access the console.
          </p>

          {/* Health status pill */}
          <div className="mb-6">
            {health === 'checking' && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]"
                style={{ background: '#0d0d0d', border: '1px solid #1c1c1c', color: '#525252' }}
              >
                <RefreshCw size={11} className="animate-spin" />
                Checking API status…
              </div>
            )}
            {health === 'unreachable' && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]"
                style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', color: '#f87171' }}
              >
                <AlertTriangle size={11} />
                API unreachable — retry in ~30s
              </div>
            )}
            {health === 'degraded' && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]"
                style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)', color: '#fbbf24' }}
              >
                <AlertTriangle size={11} />
                API degraded — some features may be limited
              </div>
            )}
            {health === 'ok' && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]"
                style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)', color: '#34d399' }}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                API online — settlement active
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div
              className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-[12px] mb-5"
              style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', color: '#f87171' }}
            >
              <Shield size={12} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-[#404040] mb-2"
              >
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full px-4 py-2.5 rounded-lg text-[13px] text-[#d4d4d4] placeholder:text-[#2a2a2a] transition-all outline-none"
                style={{
                  background: '#0d0d0d',
                  border: '1px solid #1c1c1c',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'rgba(16,185,129,0.4)')}
                onBlur={(e) => (e.target.style.borderColor = '#1c1c1c')}
              />
            </div>
            <div>
              <label
                htmlFor="login-apikey"
                className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-[#404040] mb-2"
              >
                API Key
              </label>
              <div className="relative">
                <input
                  id="login-apikey"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="ap_live_…"
                  autoComplete="current-password"
                  className="w-full px-4 py-2.5 pr-14 rounded-lg text-[13px] font-mono text-[#d4d4d4] placeholder:text-[#2a2a2a] transition-all outline-none"
                  style={{ background: '#0d0d0d', border: '1px solid #1c1c1c' }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(16,185,129,0.4)')}
                  onBlur={(e) => (e.target.style.borderColor = '#1c1c1c')}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#404040] hover:text-[#737373] font-medium transition-colors px-1"
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold text-black transition-all duration-200 disabled:opacity-50 mt-2"
              style={{
                background: loading ? '#059669' : '#10b981',
              }}
              onMouseEnter={(e) => { if (!loading) (e.target as HTMLButtonElement).style.background = '#0d9466'; }}
              onMouseLeave={(e) => { if (!loading) (e.target as HTMLButtonElement).style.background = '#10b981'; }}
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <LogIn size={14} />}
              {loading ? 'Signing in…' : 'Access console'}
            </button>
          </form>

          {/* Trust row */}
          <div className="mt-8 flex items-center gap-5">
            {[
              { icon: Lock, label: 'PBKDF2 auth' },
              { icon: Shield, label: 'HMAC signed' },
              { icon: Zap, label: 'Solana USDC' },
            ].map(({ icon: I, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <I size={11} className="text-[#2a2a2a]" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#303030]">{label}</span>
              </div>
            ))}
          </div>

          <p className="mt-6 text-[11px] text-[#2a2a2a]">
            No account?{' '}
            <a
              href="https://github.com/Rumblingb/Agentpay#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#404040] hover:text-emerald-500 transition-colors"
            >
              Register via the API →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
