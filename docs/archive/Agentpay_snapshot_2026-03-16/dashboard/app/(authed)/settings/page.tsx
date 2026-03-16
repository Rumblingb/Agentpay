/**
 * PRODUCTION FIX — DEMO FLOW
 *
 * Settings page with "Trust Webhooks" section.
 * Provides a form to subscribe to protocol events:
 *   - escrow.locked
 *   - escrow.released
 *   - escrow.disputed
 *   - agentrank.slashed
 *
 * For the investor demo this is a UI mock that shows a success toast.
 */

'use client';

import { useState } from 'react';
import { Bell, CheckCircle, Settings } from 'lucide-react';

// PRODUCTION FIX — DEMO FLOW: Toast auto-dismiss duration in milliseconds
const TOAST_DURATION_MS = 3000;

// PRODUCTION FIX — DEMO FLOW: Trust protocol event types
const TRUST_EVENTS = [
  { id: 'escrow.locked', label: 'Escrow Locked', description: 'Fires when USDC is locked in escrow' },
  { id: 'escrow.released', label: 'Escrow Released', description: 'Fires when escrowed funds are released' },
  { id: 'escrow.disputed', label: 'Escrow Disputed', description: 'Fires when a dispute is opened on an escrow' },
  { id: 'agentrank.slashed', label: 'AgentRank Slashed', description: 'Fires when an agent score is penalized' },
] as const;

export default function SettingsPage() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [showToast, setShowToast] = useState(false);
  const [formError, setFormError] = useState('');

  // PRODUCTION FIX — DEMO FLOW: Toggle event checkbox
  function toggleEvent(eventId: string) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  // PRODUCTION FIX — DEMO FLOW: Save webhook (demo mock — shows success toast)
  function handleSaveWebhook() {
    setFormError('');

    if (!webhookUrl.trim()) {
      setFormError('Please enter a webhook endpoint URL.');
      return;
    }

    if (selectedEvents.size === 0) {
      setFormError('Please select at least one event.');
      return;
    }

    // Demo mock: show success toast
    setShowToast(true);
    setTimeout(() => setShowToast(false), TOAST_DURATION_MS);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-slate-400" />
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* PRODUCTION FIX — DEMO FLOW: Trust Webhooks Section */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="font-semibold text-lg">Trust Webhooks</h2>
            <p className="text-slate-400 text-sm">Subscribe to real-time protocol events from the AgentPay Trust Infrastructure.</p>
          </div>
        </div>

        {/* Event checkboxes */}
        <div className="space-y-3">
          <span className="text-sm font-medium text-slate-300">Select Events</span>
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

        {/* Webhook URL input */}
        <div className="space-y-2">
          <label htmlFor="webhook-url" className="text-sm font-medium text-slate-300">Webhook Endpoint URL</label>
          <input
            id="webhook-url"
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://yourapp.com/webhooks/agentpay"
            className="bg-black/40 border border-slate-700 rounded-lg px-4 py-3 text-sm w-full text-slate-300 focus:outline-none focus:border-emerald-600"
          />
        </div>

        {/* Error message */}
        {formError && (
          <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">{formError}</p>
        )}

        {/* Save button */}
        <button
          onClick={handleSaveWebhook}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition"
        >
          Save Webhook
        </button>
      </div>

      {/* PRODUCTION FIX — DEMO FLOW: Success toast */}
      {showToast && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-in slide-in-from-bottom-5 z-50">
          <CheckCircle className="w-5 h-5" />
          <div>
            <p className="font-semibold text-sm">Webhook Saved</p>
            <p className="text-xs text-emerald-200">
              Subscribed to {selectedEvents.size} event{selectedEvents.size !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
