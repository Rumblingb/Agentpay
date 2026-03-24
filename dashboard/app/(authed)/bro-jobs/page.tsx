'use client';

import { useQuery } from '@tanstack/react-query';
import { Train, CreditCard, Zap, CheckCircle2, Clock, AlertCircle, ExternalLink } from 'lucide-react';
import MetricCard from '@/components/MetricCard';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BroJob {
  jobId: string;
  status: string;
  amount: string | null;
  currency: string | null;
  hirerId: string | null;
  jobDescription: string | null;
  stripeConfirmed: string | null;
  openclawDispatched: string | null;
  openclawJobId: string | null;
  openclawDispatchedAt: string | null;
  openclawError: string | null;
  completedAt: string | null;
  dispatchStatus: string | null;
  createdAt: string;
}

interface BroOpsData {
  summary: {
    total: number;
    paid: number;
    pending: number;
    dispatched: number;
    fulfilled: number;
    failed: number;
  };
  jobs: BroJob[];
}

// ── Data fetch ─────────────────────────────────────────────────────────────────

async function fetchBroOps(): Promise<BroOpsData> {
  const res = await fetch('/api/bro-ops');
  if (!res.ok) throw new Error('Failed to load Bro bookings');
  return res.json();
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

function PaymentBadge({ confirmed }: { confirmed: string | null }) {
  if (confirmed === 'true') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 size={10} /> Paid
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <Clock size={10} /> Awaiting
    </span>
  );
}

function OpenClawBadge({ dispatched, error }: { dispatched: string | null; error: string | null }) {
  if (dispatched === 'true') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
        <Zap size={10} /> Dispatched
      </span>
    );
  }
  if (error) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20" title={error}>
        <AlertCircle size={10} /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-white/5 text-[#525252] border border-white/5">
      Pending
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string; border: string }> = {
    completed:      { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    escrow_pending: { color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
    failed:         { color: 'text-red-400',      bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  };
  const style = cfg[status] ?? { color: 'text-[#737373]', bg: 'bg-white/5', border: 'border-white/5' };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${style.color} ${style.bg} ${style.border}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Route snippet from description ────────────────────────────────────────────

function routeFromDescription(desc: string | null): string {
  if (!desc) return '—';
  // "Book train from Derby to London St Pancras..." → "Derby → London St Pancras"
  const m = desc.match(/from\s+(.+?)\s+to\s+(.+?)(?:\s+on|\s+departing|,|$)/i);
  if (m) return `${m[1].trim()} → ${m[2].trim()}`;
  return desc.slice(0, 40) + (desc.length > 40 ? '…' : '');
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BroJobsPage() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<BroOpsData>({
    queryKey: ['bro-ops'],
    queryFn: fetchBroOps,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const summary = data?.summary;
  const jobs    = data?.jobs ?? [];

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="max-w-[1100px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Train size={18} className="text-emerald-400" />
            <h1 className="text-[20px] font-bold tracking-tight text-white">Bro Bookings</h1>
          </div>
          <p className="text-[13px] text-[#525252]">
            Live booking pipeline — payment status, OpenClaw dispatch, fulfillment.
          </p>
        </div>
        {lastUpdated && (
          <span className="text-[11px] text-[#404040]">Updated {lastUpdated}</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-400">
          {(error as Error).message} — check ADMIN_SECRET_KEY in Vercel env vars.
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={Train}
          label="Total Bookings"
          value={isLoading ? '—' : String(summary?.total ?? 0)}
          loading={isLoading}
        />
        <MetricCard
          icon={CreditCard}
          label="Paid"
          value={isLoading ? '—' : String(summary?.paid ?? 0)}
          loading={isLoading}
        />
        <MetricCard
          icon={Zap}
          label="OpenClaw Dispatched"
          value={isLoading ? '—' : String(summary?.dispatched ?? 0)}
          loading={isLoading}
        />
        <MetricCard
          icon={CheckCircle2}
          label="Fulfilled"
          value={isLoading ? '—' : String(summary?.fulfilled ?? 0)}
          loading={isLoading}
        />
      </div>

      {/* Jobs table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: '#0d0d0d', borderColor: '#1c1c1c' }}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#1c1c1c' }}>
          <h2 className="text-[13px] font-semibold text-white">Bookings</h2>
          <span className="text-[11px] text-[#404040]">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
          </span>
        </div>

        {isLoading ? (
          <div className="divide-y" style={{ borderColor: '#1a1a1a' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4 animate-pulse flex gap-4">
                <div className="h-3 bg-white/5 rounded w-40" />
                <div className="h-3 bg-white/5 rounded w-24" />
                <div className="h-3 bg-white/5 rounded w-16" />
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-[#404040]">
            No bookings yet — they appear here once users place a request.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b text-left text-[#404040]" style={{ borderColor: '#1a1a1a' }}>
                  <th className="px-5 py-3 font-medium">Route</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">OpenClaw</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: '#141414' }}>
                {jobs.map((job) => (
                  <tr key={job.jobId} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5 text-[#d4d4d4] font-medium max-w-[200px] truncate">
                      {routeFromDescription(job.jobDescription)}
                    </td>
                    <td className="px-4 py-3.5 text-[#737373]">
                      {job.amount
                        ? `${parseFloat(job.amount).toFixed(2)} ${job.currency ?? 'USDC'}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      <PaymentBadge confirmed={job.stripeConfirmed} />
                    </td>
                    <td className="px-4 py-3.5">
                      <OpenClawBadge dispatched={job.openclawDispatched} error={job.openclawError} />
                    </td>
                    <td className="px-4 py-3.5 text-[#525252] whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3.5">
                      <a
                        href={`/receipt/${job.jobId}`}
                        className="inline-flex items-center gap-1 text-[#404040] hover:text-[#d4d4d4] transition-colors"
                        title="View receipt"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* OpenClaw status note */}
      {summary && summary.paid > 0 && summary.dispatched === 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-400">
          <strong>{summary.paid} paid booking{summary.paid > 1 ? 's' : ''}</strong> — OpenClaw not yet dispatched.
          {' '}Check that <code className="text-[11px] bg-white/5 px-1 rounded">OPENCLAW_API_URL</code> and{' '}
          <code className="text-[11px] bg-white/5 px-1 rounded">OPENCLAW_API_KEY</code> are set as Wrangler secrets.
        </div>
      )}
    </div>
  );
}
