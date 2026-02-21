"use client";

import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Key,
  ShieldCheck,
  RefreshCw,
  Wand2,
  DollarSign,
  CheckCircle,
  Clock,
  XCircle,
  LogIn,
  UserPlus,
  ChevronRight,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Stats {
  totalTransactions: number;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number;
  totalConfirmedUsdc: number;
}

interface Transaction {
  id: string;
  paymentId: string;
  amountUsdc: number;
  recipientAddress: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  createdAt: string;
  transactionHash?: string;
}

type View = 'login' | 'register' | 'dashboard';

export default function MerchantDashboard() {
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [view, setView] = useState<View>('login');
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Registration form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regWallet, setRegWallet] = useState('');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        setServerStatus(res.ok ? 'online' : 'offline');
      } catch {
        setServerStatus('offline');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = useCallback(async (key: string) => {
    if (!key) return;
    setIsLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${key}` };
      const [statsRes, txRes] = await Promise.all([
        fetch(`${API_BASE}/api/merchants/stats`, { headers }),
        fetch(`${API_BASE}/api/merchants/payments?limit=10`, { headers }),
      ]);

      if (statsRes.status === 401 || txRes.status === 401) {
        setError('Invalid API key. Please check and try again.');
        setView('login');
        return;
      }

      if (!statsRes.ok) {
        setError(`Server error (${statsRes.status}): failed to load statistics.`);
        return;
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      if (txRes.ok) {
        const txData = await txRes.json();
        setTransactions(txData.transactions || []);
      }
    } catch {
      setError('Failed to load dashboard data. Is the server running?');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleLogin = async () => {
    if (!apiKey.trim()) {
      setError('Please enter your API key');
      return;
    }
    setError('');
    await fetchDashboardData(apiKey.trim());
    setView('dashboard');
  };

  const handleRegister = async () => {
    if (!regName || !regEmail || !regWallet) {
      setError('All fields are required');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/merchants/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: regName, email: regEmail, walletAddress: regWallet }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setApiKey(data.apiKey);
        setSuccessMsg(`Registration successful! Your API key is shown below. Save it — it won't be shown again.`);
        await fetchDashboardData(data.apiKey);
        setView('dashboard');
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch {
      setError('Registration failed. Is the server running?');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateKey = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/merchants/rotate-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setApiKey(data.apiKey);
        setSuccessMsg('New API key generated. Save it securely — it will not be shown again.');
      } else {
        setError(data.error || 'Failed to rotate key');
      }
    } catch {
      setError('Failed to generate API key');
    } finally {
      setIsLoading(false);
    }
  };

  const statusColor = {
    confirmed: 'text-emerald-400',
    pending: 'text-yellow-400',
    failed: 'text-red-400',
    expired: 'text-slate-400',
  };

  const StatusIcon = ({ status }: { status: Transaction['status'] }) => {
    if (status === 'confirmed') return <CheckCircle size={14} className="text-emerald-400" />;
    if (status === 'pending') return <Clock size={14} className="text-yellow-400" />;
    return <XCircle size={14} className="text-red-400" />;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 px-8 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-emerald-400">AgentPay</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`h-2 w-2 rounded-full ${serverStatus === 'online' ? 'bg-emerald-500 animate-pulse' : serverStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500'}`} />
            <p className="text-xs text-slate-400 uppercase font-semibold tracking-wider">
              Engine: {serverStatus}
            </p>
          </div>
        </div>
        {view === 'dashboard' && (
          <button
            onClick={() => { setView('login'); setApiKey(''); setStats(null); setTransactions([]); setError(''); setSuccessMsg(''); }}
            className="text-xs text-slate-400 hover:text-white transition"
          >
            Sign out
          </button>
        )}
      </header>

      <main className="p-8 max-w-5xl mx-auto">
        {/* Global messages */}
        {error && (
          <div className="mb-6 bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-6 bg-emerald-900/30 border border-emerald-700 text-emerald-300 px-4 py-3 rounded-lg text-sm">
            {successMsg}
          </div>
        )}

        {/* LOGIN VIEW */}
        {view === 'login' && (
          <div className="max-w-md mx-auto mt-16">
            <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-emerald-500/10 p-2 rounded-lg"><LogIn className="text-emerald-400" size={20} /></div>
                <h2 className="text-lg font-semibold">Sign In</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    placeholder="Paste your API key…"
                    className="bg-black/40 border border-slate-700 rounded-lg px-4 py-3 text-sm w-full font-mono text-slate-300 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <button
                  onClick={handleLogin}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-semibold transition"
                >
                  {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <ChevronRight size={16} />}
                  Access Dashboard
                </button>
                <button
                  onClick={() => { setView('register'); setError(''); }}
                  className="w-full text-center text-xs text-slate-400 hover:text-emerald-400 transition mt-2"
                >
                  No account? Register as a merchant →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* REGISTER VIEW */}
        {view === 'register' && (
          <div className="max-w-md mx-auto mt-16">
            <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-blue-500/10 p-2 rounded-lg"><UserPlus className="text-blue-400" size={20} /></div>
                <h2 className="text-lg font-semibold">Register Merchant</h2>
              </div>
              <div className="space-y-4">
                {[
                  { label: 'Business Name', value: regName, setter: setRegName, placeholder: 'Acme Corp' },
                  { label: 'Email', value: regEmail, setter: setRegEmail, placeholder: 'you@example.com' },
                  { label: 'Solana Wallet Address', value: regWallet, setter: setRegWallet, placeholder: '9B5X2FW…' },
                ].map(({ label, value, setter, placeholder }) => (
                  <div key={label}>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">{label}</label>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      placeholder={placeholder}
                      className="bg-black/40 border border-slate-700 rounded-lg px-4 py-3 text-sm w-full text-slate-300 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                ))}
                <button
                  onClick={handleRegister}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-semibold transition"
                >
                  {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <UserPlus size={16} />}
                  Create Account
                </button>
                <button
                  onClick={() => { setView('login'); setError(''); }}
                  className="w-full text-center text-xs text-slate-400 hover:text-emerald-400 transition"
                >
                  Already have an account? Sign in →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DASHBOARD VIEW */}
        {view === 'dashboard' && (
          <div className="space-y-8">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Transactions', value: stats?.totalTransactions ?? '—', icon: Activity, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                { label: 'Confirmed', value: stats?.confirmedCount ?? '—', icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                { label: 'Pending', value: stats?.pendingCount ?? '—', icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
                { label: 'Total USDC', value: stats ? `$${stats.totalConfirmedUsdc.toFixed(2)}` : '—', icon: DollarSign, color: 'text-blue-400', bg: 'bg-blue-500/10' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
                  <div className={`${bg} w-fit p-2 rounded-lg mb-3`}>
                    <Icon className={color} size={18} />
                  </div>
                  <div className="text-2xl font-bold">{isLoading ? '…' : value}</div>
                  <div className="text-xs text-slate-400 mt-1">{label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* API Key Card */}
              <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl shadow-xl">
                <div className="flex items-center gap-3 mb-5">
                  <div className="bg-blue-500/10 p-2 rounded-lg"><Key className="text-blue-400" size={18} /></div>
                  <h2 className="font-semibold">API Credentials</h2>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Secret Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      readOnly
                      className="bg-black/40 border border-slate-800 rounded-lg px-4 py-2.5 text-sm w-full font-mono text-slate-300 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleGenerateKey}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold transition"
                  >
                    {isLoading ? <RefreshCw className="animate-spin" size={14} /> : <Wand2 size={14} />}
                    Rotate Key
                  </button>
                </div>

                <div className="mt-5 pt-5 border-t border-slate-800">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="text-emerald-400" size={16} />
                    <span className="text-xs font-semibold text-emerald-400">Security</span>
                  </div>
                  <ul className="text-xs text-slate-400 space-y-1">
                    <li>✓ PBKDF2 key hashing</li>
                    <li>✓ Recipient address verified on-chain</li>
                    <li>✓ 2+ block confirmation depth</li>
                    <li>✓ Rate limiting enabled</li>
                  </ul>
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl shadow-xl">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-semibold">Recent Payments</h2>
                  <button
                    onClick={() => fetchDashboardData(apiKey)}
                    className="text-slate-400 hover:text-white transition"
                    title="Refresh"
                  >
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
                {transactions.length === 0 ? (
                  <div className="text-center text-slate-500 py-8 text-sm">
                    No transactions yet. Create your first payment request via the API.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between bg-black/30 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-3">
                          <StatusIcon status={tx.status} />
                          <div>
                            <div className="text-xs font-mono text-slate-300">{tx.paymentId.substring(0, 16)}…</div>
                            <div className="text-[10px] text-slate-500">{new Date(tx.createdAt).toLocaleString()}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">${tx.amountUsdc} USDC</div>
                          <div className={`text-[10px] capitalize ${statusColor[tx.status]}`}>{tx.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}