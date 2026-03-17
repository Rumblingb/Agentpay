'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Clock, XCircle, ExternalLink, Copy, Check } from 'lucide-react';

interface Payment {
  id: string;
  paymentId: string;
  amountUsdc: number;
  recipientAddress: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired' | 'rejected';
  transactionHash?: string;
  createdAt: string;
}

const STATUS_CONFIG: Record<
  string,
  { icon: React.ReactNode; label: string; dot: string; text: string; bg: string; border: string }
> = {
  confirmed: {
    icon: <CheckCircle size={11} />,
    label: 'Confirmed',
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.2)',
  },
  pending: {
    icon: <Clock size={11} />,
    label: 'Pending',
    dot: 'bg-amber-500',
    text: 'text-amber-400',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.2)',
  },
  failed: {
    icon: <XCircle size={11} />,
    label: 'Failed',
    dot: 'bg-red-500',
    text: 'text-red-400',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.2)',
  },
  expired: {
    icon: <XCircle size={11} />,
    label: 'Expired',
    dot: 'bg-[#404040]',
    text: 'text-[#525252]',
    bg: 'rgba(255,255,255,0.02)',
    border: 'rgba(255,255,255,0.06)',
  },
  rejected: {
    icon: <XCircle size={11} />,
    label: 'Rejected',
    dot: 'bg-red-700',
    text: 'text-red-500',
    bg: 'rgba(239,68,68,0.05)',
    border: 'rgba(239,68,68,0.15)',
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.expired;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.text}`}
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-1 text-[#404040] hover:text-[#737373] transition-colors"
      title="Copy"
    >
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  );
}

async function fetchPayments() {
  const res = await fetch('/api/payments?limit=100');
  if (!res.ok) throw new Error('Failed to load intents');
  return res.json() as Promise<{ transactions: Payment[] }>;
}

export default function IntentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['intents'],
    queryFn: fetchPayments,
  });

  const payments = data?.transactions ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-white tracking-[-0.02em]">Intents</h1>
          <p className="text-[12px] text-[#525252] mt-0.5">
            {payments.length > 0 ? `${payments.length} total intents` : 'Payment intent ledger'}
          </p>
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid #1c1c1c', background: '#0d0d0d' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-[#404040] text-[13px]">
            Loading intents…
          </div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <Clock size={22} className="text-[#2a2a2a]" />
            <p className="text-[12px] text-[#404040]">No payment intents found.</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                {['Intent ID', 'Status', 'Amount', 'Tx Hash', 'Created'].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-[#404040]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((row, i) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-white/[0.015]"
                  style={{ borderBottom: i < payments.length - 1 ? '1px solid #141414' : undefined }}
                >
                  {/* Intent ID */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-[#737373]">
                        {row.paymentId.slice(0, 8)}…{row.paymentId.slice(-6)}
                      </span>
                      <CopyButton text={row.paymentId} />
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-3">
                    <span
                      className="font-semibold text-white"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      ${Number(row.amountUsdc || 0).toFixed(2)}
                    </span>
                    <span className="ml-1 text-[10px] text-[#404040]">USDC</span>
                  </td>

                  {/* Tx Hash */}
                  <td className="px-4 py-3">
                    {row.transactionHash ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-[#525252]">
                          {row.transactionHash.slice(0, 12)}…
                        </span>
                        <CopyButton text={row.transactionHash} />
                        <a
                          href={`https://solscan.io/tx/${row.transactionHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#404040] hover:text-emerald-400 transition-colors"
                          title="View on Solscan"
                        >
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    ) : (
                      <span className="text-[#2a2a2a]">—</span>
                    )}
                  </td>

                  {/* Created */}
                  <td className="px-4 py-3">
                    <span className="text-[11px] text-[#525252]">
                      {new Date(row.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
