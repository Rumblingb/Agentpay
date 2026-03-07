/**
 * PRODUCTION FIX — DEMO FLOW
 *
 * TrustPaymentFlow — Multi-step $1 send demo with AgentRank verification
 * and escrow locking. Replaces the simple "Send → Sent" flow with a
 * visual pipeline for investor demos.
 *
 * Steps:
 *   1. Input target wallet address
 *   2. "Checking AgentRank..." (simulated 1s delay, shows score/grade)
 *   3. Conditional logic based on score:
 *      - Score >= 700: Trust verified → Escrow locked → Success
 *      - Score < 400:  Warning → Transaction blocked
 */

'use client';

import { useState } from 'react';
import { Shield, AlertTriangle, CheckCircle, Loader2, Lock } from 'lucide-react';
// PRODUCTION FIX — DEMO FLOW: Import pure logic from shared module
import {
  lookupAgentScore,
  evaluateTrustDecision,
  type AgentRankLookup,
  UNKNOWN_WALLET_DEFAULT_SCORE,
  UNKNOWN_WALLET_DEFAULT_GRADE,
  MIN_TRUST_SCORE_THRESHOLD,
} from '../lib/trust-logic';

export type TrustFlowStep = 'input' | 'checking' | 'result' | 'escrow' | 'complete' | 'blocked';

// Re-export for external consumers
export { lookupAgentScore, evaluateTrustDecision, type AgentRankLookup };

interface TrustPaymentFlowProps {
  onComplete: (result: { escrowed: boolean; score: number; grade: string }) => void;
  onSkip: () => void;
}

export default function TrustPaymentFlow({ onComplete, onSkip }: TrustPaymentFlowProps) {
  const [step, setStep] = useState<TrustFlowStep>('input');
  const [walletAddress, setWalletAddress] = useState('');
  const [agentInfo, setAgentInfo] = useState<AgentRankLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  // PRODUCTION FIX — DEMO FLOW: Simulate AgentRank lookup with delay
  async function handleCheckAgentRank() {
    if (!walletAddress.trim()) {
      setError('Please enter a wallet address.');
      return;
    }

    setError(null);
    setStep('checking');

    // Simulate a 1-second network delay for demo effect
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = lookupAgentScore(walletAddress.trim());
    if (!result) {
      // Unknown wallets default to mid-range values
      setAgentInfo({ score: UNKNOWN_WALLET_DEFAULT_SCORE, grade: UNKNOWN_WALLET_DEFAULT_GRADE });
    } else {
      setAgentInfo(result);
    }
    setStep('result');
  }

  // PRODUCTION FIX — DEMO FLOW: Handle trust decision after AgentRank check
  async function handleTrustDecision() {
    if (!agentInfo) return;

    const decision = evaluateTrustDecision(agentInfo.score);

    if (decision === 'blocked') {
      setStep('blocked');
      return;
    }

    // Proceed to escrow
    setStep('escrow');
    // Simulate escrow locking delay
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setStep('complete');
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2">
        <Shield className="w-5 h-5 text-emerald-400" />
        Trust-Verified Payment
      </h2>

      {/* PRODUCTION FIX — DEMO FLOW: Step 1 — Input wallet address */}
      {step === 'input' && (
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">
            Enter a target agent wallet to send $1.00 USDC with Trust verification.
          </p>
          <div className="space-y-2">
            <label htmlFor="target-wallet" className="text-xs text-slate-400">Target Wallet Address</label>
            <input
              id="target-wallet"
              type="text"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder="e.g. DemoAgentTrust850"
              className="bg-black/40 border border-slate-700 rounded-lg px-4 py-3 text-sm w-full text-slate-300 focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-400">Demo wallets:</p>
            <p>• DemoAgentTrust850 — Good agent (Score: 850)</p>
            <p>• DemoAgentNew300 — New agent (Score: 300)</p>
            <p>• DemoAgentSlash150 — Slashed agent (Score: 150)</p>
          </div>
          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">{error}</p>
          )}
          <button
            onClick={handleCheckAgentRank}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            Check AgentRank & Send $1.00 →
          </button>
          <button
            onClick={onSkip}
            className="w-full text-slate-400 hover:text-white text-sm py-1 transition-colors"
          >
            Skip →
          </button>
        </div>
      )}

      {/* PRODUCTION FIX — DEMO FLOW: Step 2 — Checking AgentRank */}
      {step === 'checking' && (
        <div className="space-y-4 text-center py-4">
          <Loader2 className="w-10 h-10 text-emerald-400 mx-auto animate-spin" />
          <p className="text-slate-300 font-medium">Checking AgentRank...</p>
          <p className="text-slate-500 text-sm">Querying Behavioral Oracle for {walletAddress}</p>
        </div>
      )}

      {/* PRODUCTION FIX — DEMO FLOW: Step 3a — AgentRank result (trust verified or warning) */}
      {step === 'result' && agentInfo && (
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-xl p-4 space-y-3">
            <p className="text-sm text-slate-400">AgentRank Result for <span className="text-white font-mono">{walletAddress}</span></p>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-white">{agentInfo.score}</p>
                <p className="text-xs text-slate-500">Score</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold ${agentInfo.score >= MIN_TRUST_SCORE_THRESHOLD ? 'text-emerald-400' : agentInfo.score >= 400 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {agentInfo.grade}
                </p>
                <p className="text-xs text-slate-500">Grade</p>
              </div>
            </div>
            {agentInfo.score >= MIN_TRUST_SCORE_THRESHOLD ? (
              <p className="text-emerald-400 text-sm font-medium flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Trust Verified. Eligible for Insurance.
              </p>
            ) : (
              <p className="text-red-400 text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                ⚠️ AgentRank Critical. High risk of failure. Transaction blocked by Behavioral Oracle.
              </p>
            )}
          </div>
          <button
            onClick={handleTrustDecision}
            className={`w-full font-semibold py-2.5 rounded-xl transition-colors ${
              agentInfo.score >= MIN_TRUST_SCORE_THRESHOLD
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white'
                : 'bg-red-600 hover:bg-red-500 text-white'
            }`}
          >
            {agentInfo.score >= MIN_TRUST_SCORE_THRESHOLD ? 'Proceed to Escrow →' : 'View Details'}
          </button>
        </div>
      )}

      {/* PRODUCTION FIX — DEMO FLOW: Step 3b — Escrow locking animation */}
      {step === 'escrow' && (
        <div className="space-y-4 text-center py-4">
          <Lock className="w-10 h-10 text-emerald-400 mx-auto animate-pulse" />
          <p className="text-slate-300 font-medium">Locking in Escrow...</p>
          <p className="text-slate-500 text-sm">$1.00 USDC being secured on-chain</p>
        </div>
      )}

      {/* PRODUCTION FIX — DEMO FLOW: Step 4a — Escrow complete */}
      {step === 'complete' && agentInfo && (
        <div className="space-y-4 text-center">
          <div className="text-4xl">✅</div>
          <h3 className="text-lg font-bold text-emerald-400">USDC Secured in Escrow</h3>
          <div className="bg-slate-800 rounded-xl p-4 text-left text-sm space-y-2">
            <div className="flex justify-between"><span className="text-slate-400">Amount</span><span className="text-white">$1.00 USDC</span></div>
            <div className="flex justify-between"><span className="text-slate-400">AgentRank</span><span className="text-emerald-400">{agentInfo.score} ({agentInfo.grade})</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Insurance</span><span className="text-emerald-400">Covered by $10K Pool</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Status</span><span className="text-emerald-400">Escrowed ✓</span></div>
          </div>
          <button
            onClick={() => onComplete({ escrowed: true, score: agentInfo.score, grade: agentInfo.grade })}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            Continue →
          </button>
        </div>
      )}

      {/* PRODUCTION FIX — DEMO FLOW: Step 4b — Transaction blocked */}
      {step === 'blocked' && agentInfo && (
        <div className="space-y-4 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
          <h3 className="text-lg font-bold text-red-400">Transaction Blocked</h3>
          <p className="text-slate-400 text-sm">
            ⚠️ AgentRank Critical. High risk of failure. Transaction blocked by Behavioral Oracle.
          </p>
          <div className="bg-slate-800 rounded-xl p-4 text-left text-sm space-y-2">
            <div className="flex justify-between"><span className="text-slate-400">Score</span><span className="text-red-400">{agentInfo.score}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Grade</span><span className="text-red-400">{agentInfo.grade}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Decision</span><span className="text-red-400">Blocked</span></div>
          </div>
          <button
            onClick={() => onComplete({ escrowed: false, score: agentInfo.score, grade: agentInfo.grade })}
            className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            Back to Dashboard →
          </button>
        </div>
      )}
    </div>
  );
}
