'use client';

import { Shield, Clock, CheckCircle, XCircle } from 'lucide-react';
import MetricCard from '@/components/MetricCard';

/**
 * Escrow dashboard page — shows A2A hiring escrow status and a "Fund Bot" button.
 */
export default function EscrowPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Escrow</h1>
      <p className="text-slate-400 text-sm">
        Agent-to-Agent escrow for hiring flows. Lock funds, mark work complete, approve or dispute.
      </p>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Active Escrows"
          value="—"
          icon={Shield}
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
        />
        <MetricCard
          label="Pending Approval"
          value="—"
          icon={Clock}
          iconColor="text-yellow-400"
          iconBg="bg-yellow-500/10"
        />
        <MetricCard
          label="Released"
          value="—"
          icon={CheckCircle}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
        />
        <MetricCard
          label="Disputed"
          value="—"
          icon={XCircle}
          iconColor="text-red-400"
          iconBg="bg-red-500/10"
        />
      </div>

      {/* Fund Bot Button */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-3">Fund Bot</h2>
        <p className="text-slate-400 text-sm mb-4">
          Use your connected Stripe account to purchase USDC and fund your agent wallet.
        </p>
        <button
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium transition"
          onClick={() => alert('Stripe → USDC funding flow coming soon')}
        >
          Fund Bot via Stripe
        </button>
      </div>

      {/* Escrow Table Placeholder */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-3">Recent Escrows</h2>
        <p className="text-slate-500 text-sm">No escrow transactions yet.</p>
      </div>
    </div>
  );
}
