'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import DataTable from '@/components/DataTable';

interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

interface WebhookDelivery {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseCode?: number;
  createdAt: string;
}

interface WebhooksData {
  webhooks: WebhookSubscription[];
  deliveries: WebhookDelivery[];
}

async function fetchWebhooks(): Promise<WebhooksData> {
  const res = await fetch('/api/webhooks');
  if (!res.ok) throw new Error('Failed to load webhooks');
  return res.json();
}

const webhookCols = [
  { key: 'url', header: 'Endpoint URL' },
  {
    key: 'events',
    header: 'Events',
    render: (row: WebhookSubscription) => row.events?.join(', ') || 'all',
  },
  {
    key: 'active',
    header: 'Status',
    render: (row: WebhookSubscription) => (
      <span className={row.active ? 'text-emerald-400' : 'text-slate-400'}>
        {row.active ? 'Active' : 'Inactive'}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (row: WebhookSubscription) => new Date(row.createdAt).toLocaleString(),
  },
];

const deliveryCols = [
  { key: 'event', header: 'Event' },
  {
    key: 'status',
    header: 'Status',
    render: (row: WebhookDelivery) => (
      <span
        className={
          row.status === 'delivered'
            ? 'text-emerald-400'
            : row.status === 'failed'
              ? 'text-red-400'
              : 'text-yellow-400'
        }
      >
        {row.status}
      </span>
    ),
  },
  { key: 'attempts', header: 'Attempts' },
  {
    key: 'responseCode',
    header: 'HTTP',
    render: (row: WebhookDelivery) => row.responseCode ?? '—',
  },
  {
    key: 'createdAt',
    header: 'Time',
    render: (row: WebhookDelivery) => new Date(row.createdAt).toLocaleString(),
  },
];

export default function WebhooksPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: fetchWebhooks });

  const createMutation = useMutation({
    mutationFn: async (webhookUrl: string) => {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, events: ['payment.verified'] }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to create webhook');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setShowForm(false);
      setUrl('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Webhooks</h1>
        <button
          onClick={() => { setShowForm(true); setFormError(''); }}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
        >
          <Plus size={14} /> New Subscription
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-4">
          <h2 className="font-semibold">New Webhook Subscription</h2>
          {formError && (
            <p className="text-red-400 text-sm">{formError}</p>
          )}
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yoursite.com/webhook"
            className="bg-black/40 border border-slate-700 rounded-lg px-4 py-3 text-sm w-full text-slate-300 focus:outline-none focus:border-emerald-600"
          />
          <div className="flex gap-3">
            <button
              onClick={() => createMutation.mutate(url)}
              disabled={createMutation.isPending}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
            >
              {createMutation.isPending && <RefreshCw size={14} className="animate-spin" />}
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setUrl(''); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Subscriptions */}
      <div>
        <h2 className="font-semibold mb-3">Subscriptions</h2>
        <DataTable
          columns={webhookCols}
          data={data?.webhooks ?? []}
          emptyMessage="No webhook subscriptions yet."
          loading={isLoading}
        />
      </div>

      {/* Delivery logs */}
      <div>
        <h2 className="font-semibold mb-3">Delivery Logs</h2>
        <DataTable
          columns={deliveryCols}
          data={data?.deliveries ?? []}
          emptyMessage="No delivery logs yet."
          loading={isLoading}
        />
      </div>
    </div>
  );
}
