'use client';

import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/DataTable';
import { CheckCircle, Clock, XCircle } from 'lucide-react';

interface Payment {
  id: string;
  paymentId: string;
  amountUsdc: number;
  recipientAddress: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  transactionHash?: string;
  createdAt: string;
}

const statusIcon: Record<Payment['status'], React.ReactNode> = {
  confirmed: <CheckCircle size={14} className="text-emerald-400 inline" />,
  pending: <Clock size={14} className="text-yellow-400 inline" />,
  failed: <XCircle size={14} className="text-red-400 inline" />,
  expired: <XCircle size={14} className="text-slate-400 inline" />,
};

const statusText: Record<Payment['status'], string> = {
  confirmed: 'text-emerald-400',
  pending: 'text-yellow-400',
  failed: 'text-red-400',
  expired: 'text-slate-400',
};

async function fetchPayments() {
  const res = await fetch('/api/payments?limit=100');
  if (!res.ok) throw new Error('Failed to load intents');
  return res.json() as Promise<{ transactions: Payment[] }>;
}

const columns = [
  {
    key: 'paymentId',
    header: 'Payment ID',
    render: (row: Payment) => (
      <span className="font-mono text-xs">{row.paymentId.slice(0, 20)}…</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row: Payment) => (
      <span className={`flex items-center gap-1.5 capitalize ${statusText[row.status]}`}>
        {statusIcon[row.status]} {row.status}
      </span>
    ),
  },
  {
    key: 'amountUsdc',
    header: 'Amount (USDC)',
    render: (row: Payment) => `$${row.amountUsdc.toFixed(2)}`,
  },
  {
    key: 'transactionHash',
    header: 'Tx Hash',
    render: (row: Payment) =>
      row.transactionHash ? (
        <span className="font-mono text-xs">{row.transactionHash.slice(0, 16)}…</span>
      ) : (
        <span className="text-slate-500">—</span>
      ),
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (row: Payment) => new Date(row.createdAt).toLocaleString(),
  },
];

export default function IntentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['intents'],
    queryFn: fetchPayments,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Intents</h1>
      <DataTable
        columns={columns}
        data={data?.transactions ?? []}
        emptyMessage="No payment intents found."
        loading={isLoading}
      />
    </div>
  );
}
