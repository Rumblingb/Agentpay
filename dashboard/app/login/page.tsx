'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, RefreshCw } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-emerald-400">AgentPay</h1>
          <p className="text-slate-400 text-sm mt-1">Merchant Dashboard</p>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-emerald-500/10 p-2 rounded-lg">
              <LogIn className="text-emerald-400" size={20} />
            </div>
            <h2 className="text-lg font-semibold">Sign in</h2>
          </div>

          {error && (
            <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="bg-black/40 border border-slate-700 rounded-lg px-4 py-3 text-sm w-full text-slate-300 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ap_…"
                autoComplete="current-password"
                className="bg-black/40 border border-slate-700 rounded-lg px-4 py-3 text-sm w-full font-mono text-slate-300 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-semibold transition"
            >
              {loading ? <RefreshCw className="animate-spin" size={16} /> : <LogIn size={16} />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-xs text-slate-500 text-center">
            Don&apos;t have an account? Register via the{' '}
            <a
              href="https://github.com/Rumblingb/Agentpay"
              className="text-emerald-400 hover:underline"
            >
              API
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
