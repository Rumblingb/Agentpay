'use client';

import { useState, useEffect } from 'react';
import { Bell, CheckCircle, AlertCircle, Settings, Loader2 } from 'lucide-react';

const TRUST_EVENTS = [
  { id: 'payment.verified', label: 'Payment Verified', description: 'Fires when a payment is confirmed on-chain' },
  { id: 'payment.expired', label: 'Payment Expired', description: 'Fires when a payment intent expires unpaid' },
  { id: 'escrow.locked', label: 'Escrow Locked', description: 'Fires when USDC is locked in A2A escrow' },
  { id: 'escrow.released', label: 'Escrow Released', description: 'Fires when escrowed funds are released' },
  { id: 'escrow.disputed', label: 'Escrow Disputed', description: 'Fires when a dispute is opened on an escrow' },
  { id: 'agentrank.updated', label: 'AgentRank Updated', description: 'Fires when an agent trust score changes' },
] as const;

export default function SettingsPage() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formError, setFormError] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Load current webhook URL from profile
  useEffect(() => {
    fetch('/api/merchants/profile')
      .then((r) => r.json())
      .then((profile) => {
        if (profile.webhookUrl) setWebhookUrl(profile.webhookUrl);
      })
      .catch(() => {})
      .finally(() => setLoadingProfile(false));
  }, []);

  function toggleEvent(eventId: string) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      next.has(eventId) ? next.delete(eventId) : next.add(eventId);
      return next;
    });
  }

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleSave() {
    setFormError('');
    if (!webhookUrl.trim()) {
      setFormError('Please enter a webhook endpoint URL.');
      return;
    }
    try { new URL(webhookUrl); } catch {
      setFormError('Please enter a valid URL (e.g. https://yourapp.com/webhooks/agentpay).');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/merchants/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim() }),
      });
      if (!res.ok) throw new Error('Save failed');
      showToast('success', 'Webhook endpoint saved. Events will be delivered with HMAC signatures.');
    } catch {
      showToast('error', 'Failed to save webhook. Check your network and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      const res = await fetch('/api/merchants/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: null }),
      });
      if (!res.ok) throw new Error('Clear failed');
      setWebhookUrl('');
      setSelectedEvents(new Set());
      showToast('success', 'Webhook endpoint removed.');
    } catch {
      showToast('error', 'Failed to remove webhook.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="flex items-center gap-3">
        <Settings className="w-5 h-5 text-slate-400" />
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Webhooks */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="font-semibold text-lg">Payment Webhooks</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              Receive HMAC-signed event notifications when payments and trust events occur.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <span className="text-sm font-medium text-slate-300">Events</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TRUST_EVENTS.map((event) => (
              <label
                key={event.id}
                htmlFor={`event-${event.id}`}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                  selectedEvents.has(event.id)
                    ? 'border-emerald-600 bg-emerald-600/10'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                }`}
              >
                <input
                  id={`event-${event.id}`}
                  type="checkbox"
                  checked={selectedEvents.has(event.id)}
                  onChange={() => toggleEvent(event.id)}
                  className="mt-0.5 accent-emerald-500"
                />
                <div>
                  <p className="text-sm font-medium text-white">{event.label}</p>
                  <p className="text-xs text-slate-500">{event.description}</p>
                  <code className="text-xs text-emerald-400/70 mt-1 block">{event.id}</code>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="webhook-url" className="text-sm font-medium text-slate-300">
            Endpoint URL
          </label>
          {loadingProfile ? (
            <div className="h-10 rounded-lg bg-slate-800 animate-pulse" />
          ) : (
            <input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://yourapp.com/webhooks/agentpay"
              className="bg-black/40 border border-slate-700 rounded-lg px-4 py-3 text-sm w-full text-slate-300 focus:outline-none focus:border-emerald-600"
            />
          )}
          <p className="text-xs text-slate-500">
            AgentPay will POST JSON events signed with <code className="text-emerald-400/70">X-AgentPay-Signature</code> (HMAC-SHA256).
          </p>
        </div>

        {formError && (
          <div className="flex items-start gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            {formError}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loadingProfile}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Save Endpoint
          </button>
          {webhookUrl && (
            <button
              onClick={handleClear}
              disabled={saving}
              className="text-sm text-slate-500 hover:text-slate-300 transition"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50 transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-red-700 text-white'
          }`}
        >
          <CheckCircle className="w-4 h-4 shrink-0" />
          <p className="text-sm font-medium">{toast.message}</p>
        </div>
      )}
    </div>
  );
}
