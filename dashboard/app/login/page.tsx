'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, RefreshCw, Shield, Lock, Coins, AlertTriangle, CheckCircle2 } from 'lucide-react';

type HealthStatus = 'checking' | 'ok' | 'degraded' | 'unreachable';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthStatus>('checking');

  // Check backend health once on mount so the user knows if Render is cold-starting
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.status === 'active') setHealth('ok');
        else if (data.status === 'unreachable') setHealth('unreachable');
        else setHealth('degraded');
      })
      .catch(() => {
        if (!cancelled) setHealth('unreachable');
      });
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
        setError(data.error || 'Login failed. Check your credentials.');
      }
    } catch {
      setError('Network error. Is the server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 animate-gradient text-white flex items-center justify-center p-4">
      {/* Grid overlay */}
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl animate-orb pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl animate-orb-slow pointer-events-none" />
      <div className="absolute top-1/2 right-1/3 w-48 h-48 bg-emerald-400/5 rounded-full blur-2xl animate-orb pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              AgentPay
            </span>
          </h1>
          <p className="text-slate-400 text-sm mt-2">Operator Console — Infrastructure-first payments & proofs</p>
        </div>

        {/* Glassmorphism card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-2xl shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-emerald-500/10 p-2.5 rounded-xl">
              <LogIn className="text-emerald-400" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold">Operator Sign in</h2>
              <p className="text-xs text-slate-500">Secure access to settlement, verification, and audit controls</p>
            </div>
          </div>

        {/* Small constitutional agents mention (restrained) */}
        <div className="mt-3 text-center text-[11px] text-slate-500">
          Part of the AgentPay trust layer — settlement, AgentPassport, and verification. Constitutional agents and governance primitives supported by the platform.
        </div>

          {/* Backend health banner */}
          {health === 'checking' && (
            <div className="mb-4 bg-slate-800/60 border border-slate-700/50 text-slate-400 px-4 py-2.5 rounded-xl text-xs flex items-center gap-2">
              <RefreshCw className="shrink-0 animate-spin" size={12} />
              <span>Checking API health…</span>
            </div>
          )}
          {health === 'unreachable' && (
            <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-300 px-4 py-2.5 rounded-xl text-xs flex items-start gap-2">
              <AlertTriangle className="shrink-0 mt-0.5" size={13} />
              <span>API unreachable — try again in ~30s</span>
            </div>
          )}
          {health === 'degraded' && (
            <div className="mb-4 bg-yellow-900/30 border border-yellow-700/50 text-yellow-300 px-4 py-2.5 rounded-xl text-xs flex items-start gap-2">
              <AlertTriangle className="shrink-0 mt-0.5" size={13} />
              <span>API degraded — some features may be limited</span>
            </div>
          )}
          {health === 'ok' && (
            <div className="mb-4 bg-emerald-900/20 border border-emerald-700/30 text-emerald-400 px-4 py-2.5 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="shrink-0" size={12} />
              <span>API online — settlement available; identity services experimental</span>
            </div>
          )}

          {error && (
            <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-300 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
              <Shield className="shrink-0 mt-0.5" size={14} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wider">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm w-full text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all duration-200"
              />
            </div>
            <div>
              <label htmlFor="login-apikey" className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wider">
                API Key
              </label>
              <div className="relative">
                <input
                  id="login-apikey"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="ap_…"
                  autoComplete="current-password"
                  className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm w-full font-mono text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all duration-200"
                />
                <button
                  type="button"
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs px-2 py-1"
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 disabled:hover:from-emerald-600 disabled:hover:to-emerald-500 text-white py-3 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98]"
            >
              {loading ? <RefreshCw className="animate-spin" size={16} /> : <LogIn size={16} />}
              {loading ? 'Signing in…' : 'Access Dashboard'}
            </button>
          </form>

          {/* Demo hint */}
          <div className="mt-5 bg-emerald-500/5 border border-emerald-500/10 rounded-xl px-4 py-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              <span className="text-emerald-400 font-semibold">Demo:</span>{' '}
              Use your registered email and API key.{' '}
              <a
                href="https://github.com/Rumblingb/Agentpay#readme"
                className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                View setup docs →
              </a>
            </p>
          </div>

          {/* Compact Trust Panel (factual, infra-first) */}
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="bg-white/3 border border-white/6 rounded-xl px-3 py-2 text-xs text-slate-200">
              <div className="flex items-center gap-2">
                <Coins size={14} className="text-emerald-300" />
                <div>
                  <div className="font-semibold text-[12px]">Settlement</div>
                  <div className="text-[11px] text-slate-400">USDC — Live</div>
                </div>
              </div>
            </div>
            <div className="bg-white/3 border border-white/6 rounded-xl px-3 py-2 text-xs text-slate-200">
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-amber-300" />
                <div>
                  <div className="font-semibold text-[12px]">AgentPassport</div>
                  <div className="text-[11px] text-slate-400">Identity & standing — portable operator identity (experimental)</div>
                </div>
              </div>
            </div>
            <div className="bg-white/3 border border-white/6 rounded-xl px-3 py-2 text-xs text-slate-200">
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-slate-300" />
                <div>
                  <div className="font-semibold text-[12px]">Verification</div>
                  <div className="text-[11px] text-slate-400">Stubbed — SDK falls back conservatively</div>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-500 text-center">
            Don&apos;t have an account? Register via the{' '}
            <a
              href="https://github.com/Rumblingb/Agentpay"
              className="text-emerald-400 hover:text-emerald-300 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              API
            </a>
            .
          </p>
        </div>

        {/* Trust badges */}
        <div className="mt-6 flex items-center justify-center gap-6">
          <div className="flex items-center gap-1.5 text-slate-500">
            <Shield size={12} />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Secured</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <Lock size={12} />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Encrypted</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <Coins size={12} />
            <span className="text-[10px] uppercase tracking-wider font-semibold">USDC</span>
          </div>
        </div>
      </div>
    </div>
  );
}
