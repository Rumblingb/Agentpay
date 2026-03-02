'use client';

import { useState } from 'react';

interface ReputationBadgeProps {
  score: number;
  totalTransactions?: number;
  successRate?: number;
  disputeRate?: number;
  accountAgeDays?: number;
}

function getTier(score: number): { label: string; color: string; bgColor: string; borderColor: string } {
  if (score >= 80) return { label: 'Verified', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' };
  if (score >= 50) return { label: 'Trusted', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/30' };
  if (score >= 20) return { label: 'New', color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30' };
  return { label: 'Untrusted', color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' };
}

function getStars(score: number): number {
  return Math.round((score / 100) * 5 * 10) / 10; // e.g. 4.5
}

export default function ReputationBadge({
  score,
  totalTransactions,
  successRate,
  disputeRate,
  accountAgeDays,
}: ReputationBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tier = getTier(score);
  const stars = getStars(score);
  const fullStars = Math.floor(stars);
  const hasHalf = stars - fullStars >= 0.5;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className={`${tier.bgColor} ${tier.borderColor} border px-3 py-1.5 rounded-full flex items-center gap-2 cursor-pointer transition-all hover:scale-105`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        aria-label={`Reputation: ${tier.label} (${score}/100)`}
      >
        {/* Star display */}
        <span className="flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={
                i < fullStars
                  ? tier.color
                  : i === fullStars && hasHalf
                    ? 'text-slate-500'
                    : 'text-slate-700'
              }
            >
              ★
            </span>
          ))}
        </span>
        <span className={`text-sm font-semibold ${tier.color}`}>{tier.label}</span>
        <span className="text-xs text-slate-500">{score}</span>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-xl z-50">
          <div className="text-sm font-semibold text-slate-200 mb-3">Reputation Breakdown</div>
          <div className="space-y-2 text-xs">
            {totalTransactions !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">Total Transactions</span>
                <span className="text-slate-200 font-medium">{totalTransactions.toLocaleString()}</span>
              </div>
            )}
            {successRate !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">Success Rate</span>
                <span className="text-emerald-400 font-medium">{successRate.toFixed(1)}%</span>
              </div>
            )}
            {disputeRate !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">Dispute Rate</span>
                <span className={`font-medium ${disputeRate > 5 ? 'text-red-400' : 'text-slate-200'}`}>
                  {disputeRate.toFixed(1)}%
                </span>
              </div>
            )}
            {accountAgeDays !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">Account Age</span>
                <span className="text-slate-200 font-medium">{accountAgeDays} days</span>
              </div>
            )}
          </div>
          {/* Arrow */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 border-l border-t border-slate-700 rotate-45" />
        </div>
      )}
    </div>
  );
}
