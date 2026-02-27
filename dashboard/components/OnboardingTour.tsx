'use client';

import { useState } from 'react';
import { CheckCircle, Copy, Zap, PartyPopper } from 'lucide-react';

interface OnboardingTourProps {
  userName?: string;
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4;

export default function OnboardingTour({ userName, onComplete }: OnboardingTourProps) {
  const [step, setStep] = useState<Step>(1);
  const [testResult, setTestResult] = useState<{ amount: number; fee: number; botReceives: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const greeting = userName ? `Welcome, ${userName}!` : 'Welcome to AgentPay!';

  async function sendTestTip() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/test-tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1.0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test tip failed');
      setTestResult({ amount: data.amount, fee: data.fee, botReceives: data.botReceives });
      setStep(4);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Progress bar */}
        <div className="flex gap-1 p-4">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div
              key={s}
              className={`flex-1 h-1 rounded-full transition-colors ${
                s <= step ? 'bg-emerald-400' : 'bg-slate-700'
              }`}
            />
          ))}
        </div>

        <div className="p-6 pt-2">
          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">🎉</div>
              <h2 className="text-xl font-bold">{greeting}</h2>
              <p className="text-slate-400 text-sm">
                Let&apos;s get your bot earning money in under 5 minutes.
              </p>
              <div className="bg-slate-800 rounded-xl p-4 text-left text-sm text-slate-300 space-y-1">
                <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-400" /><span>API key auto-generated</span></div>
                <div className="flex items-center gap-2 text-slate-500"><CheckCircle className="w-4 h-4" /><span>Copy quickstart code</span></div>
                <div className="flex items-center gap-2 text-slate-500"><CheckCircle className="w-4 h-4" /><span>Send test transaction</span></div>
                <div className="flex items-center gap-2 text-slate-500"><CheckCircle className="w-4 h-4" /><span>See money move!</span></div>
              </div>
              <button
                onClick={() => setStep(2)}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-2.5 rounded-xl transition-colors"
              >
                Get Started →
              </button>
            </div>
          )}

          {/* Step 2: API Key */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Your API Key</h2>
              <p className="text-slate-400 text-sm">
                Your API key was auto-generated. Keep it secret — it authenticates all your requests.
              </p>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
                <p className="text-xs text-slate-400">Find your key in:</p>
                <a
                  href="/api-keys"
                  className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-mono text-sm transition-colors"
                >
                  <Copy className="w-4 h-4" />
                  Dashboard → API Keys
                </a>
              </div>
              <div className="bg-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-2">Quick install:</p>
                <code className="text-emerald-400 text-sm">npm install agentpay-sdk</code>
              </div>
              <button
                onClick={() => setStep(3)}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-2.5 rounded-xl transition-colors"
              >
                Next: Test It →
              </button>
            </div>
          )}

          {/* Step 3: Send Test Tip */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Send a Test Tip</h2>
              <p className="text-slate-400 text-sm">
                Click below to simulate a $1.00 tip and see exactly how AgentPay works.
              </p>
              <div className="bg-slate-800 rounded-xl p-4 text-sm text-slate-300">
                <p className="font-medium mb-1">What will happen:</p>
                <ul className="space-y-1 text-slate-400 text-xs">
                  <li>→ $1.00 USDC tip simulated</li>
                  <li>→ 5% platform fee applied ($0.05)</li>
                  <li>→ Bot receives $0.95</li>
                </ul>
              </div>
              {error && (
                <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">{error}</p>
              )}
              <button
                onClick={sendTestTip}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-2.5 rounded-xl transition-colors"
              >
                <Zap className="w-4 h-4" />
                {loading ? 'Sending...' : 'Send Test Tip ($1.00)'}
              </button>
              <button
                onClick={() => setStep(4)}
                className="w-full text-slate-400 hover:text-white text-sm py-1 transition-colors"
              >
                Skip →
              </button>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 4 && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">
                <PartyPopper className="w-12 h-12 text-emerald-400 mx-auto" />
              </div>
              <h2 className="text-xl font-bold">You&apos;re All Set!</h2>
              {testResult && (
                <div className="bg-slate-800 rounded-xl p-4 text-left text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-slate-400">Tip received</span><span className="text-white">${testResult.amount.toFixed(2)} USDC</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Fee (5%)</span><span className="text-slate-400">−${testResult.fee.toFixed(2)}</span></div>
                  <div className="flex justify-between font-semibold"><span className="text-emerald-400">Bot received</span><span className="text-emerald-400">${testResult.botReceives.toFixed(2)} USDC</span></div>
                </div>
              )}
              <div className="bg-slate-800 rounded-xl p-4 text-left text-sm space-y-1.5">
                <div className="flex items-center gap-2 text-emerald-400"><CheckCircle className="w-4 h-4" /><span>API Key Generated</span></div>
                <div className="flex items-center gap-2 text-emerald-400"><CheckCircle className="w-4 h-4" /><span>Test Transaction Successful</span></div>
                <div className="flex items-center gap-2 text-slate-400"><CheckCircle className="w-4 h-4" /><span className="text-slate-400">Ready for production</span></div>
              </div>
              <button
                onClick={onComplete}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-2.5 rounded-xl transition-colors"
              >
                Go to Dashboard →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
