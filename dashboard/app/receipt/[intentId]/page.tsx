/**
 * Agent Receipt Page — /receipt/[intentId]
 *
 * Public, real-time page showing full payment lifecycle for a given intent.
 * No authentication required — intentId acts as the shareable receipt token.
 */

import { notFound } from 'next/navigation';
import { createHmac } from 'crypto';

interface Agent {
  id: string;
  displayName: string;
  riskScore: number;
}

interface IntentData {
  id: string;
  amount: number;
  currency: string;
  status: string;
  protocol: string | null;
  agentId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string;
  verificationToken: string;
  agent?: Agent | null;
}

interface EscrowData {
  id: string;
  status: string;
  amountUsdc: number;
}

interface ReceiptData {
  intent: IntentData;
  escrow: EscrowData | null;
  verificationSignature: string;
}

// Timeline statuses in order
const TIMELINE: { key: string; label: string }[] = [
  { key: 'pending', label: 'Created' },
  { key: 'processing', label: 'Pending' },
  { key: 'verified', label: 'Confirmed' },
  { key: 'completed', label: 'Released' },
];

function getTimelineIndex(status: string): number {
  const statusMap: Record<string, number> = {
    pending: 0,
    processing: 1,
    verified: 2,
    completed: 3,
    released: 3,
    expired: 1,
    failed: 1,
  };
  return statusMap[status] ?? 0;
}

function generateVerificationSignature(intentId: string): string {
  const secret = process.env.VERIFICATION_SECRET ?? process.env.WEBHOOK_SECRET;
  if (!secret) {
    // In development without secrets configured, return a placeholder.
    // In production VERIFICATION_SECRET or WEBHOOK_SECRET must be set.
    return 'not-configured';
  }
  return createHmac('sha256', secret).update(intentId).digest('hex').slice(0, 32);
}

async function fetchReceiptData(intentId: string): Promise<ReceiptData | null> {
  const apiBase = process.env.AGENTPAY_API_BASE_URL ?? 'http://localhost:8787';

  try {
    // Fetch intent — use internal service key if available
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (process.env.AGENTPAY_INTERNAL_API_KEY) {
      headers['x-api-key'] = process.env.AGENTPAY_INTERNAL_API_KEY;
    }

    // Public receipt endpoint — no auth required, server-side fetch
    const res = await fetch(`${apiBase}/api/receipt/${intentId}`, {
      headers,
      next: { revalidate: 10 },
    });

    if (res.status === 404) return null;
    if (!res.ok) return null;

    const data = (await res.json()) as {
      intent: IntentData;
      escrow: EscrowData | null;
    };

    return {
      intent: data.intent,
      escrow: data.escrow ?? null,
      verificationSignature: generateVerificationSignature(intentId),
    };
  } catch {
    return null;
  }
}

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    verified: 'bg-green-100 text-green-800',
    completed: 'bg-green-200 text-green-900',
    released: 'bg-green-200 text-green-900',
    expired: 'bg-gray-100 text-gray-600',
    failed: 'bg-red-100 text-red-700',
  };
  const cls = colours[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ intentId: string }>;
}) {
  const { intentId } = await params;
  const data = await fetchReceiptData(intentId);
  if (!data) notFound();

  const { intent, escrow, verificationSignature } = data;
  const currentStep = getTimelineIndex(intent.status);

  const isSolana = intent.protocol === 'solana';
  // The Solana explorer link uses the verificationToken as a search term — the
  // actual on-chain transaction hash will be populated once the listener
  // confirms the transaction and updates the intent metadata.
  const solanaExplorerSearchUrl = isSolana
    ? `https://explorer.solana.com/search?q=${encodeURIComponent(intent.verificationToken)}&cluster=mainnet-beta`
    : null;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-xl space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Payment Receipt</h1>
          <p className="mt-1 text-sm text-gray-500">Intent ID: {intent.id}</p>
        </div>

        {/* Amount + Currency */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Amount</p>
              <p className="mt-1 text-3xl font-semibold text-gray-900">
                {intent.amount.toFixed(2)}{' '}
                <span className="text-lg font-normal text-gray-500">{intent.currency}</span>
              </p>
            </div>
            <StatusBadge status={intent.status} />
          </div>

          {intent.protocol && (
            <p className="mt-3 text-xs text-gray-400">
              Protocol:{' '}
              <span className="font-medium text-gray-600">{intent.protocol.toUpperCase()}</span>
            </p>
          )}
        </div>

        {/* Agent Identity */}
        {intent.agent && (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Agent Identity</h2>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold text-lg">
                {intent.agent.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-gray-900">{intent.agent.displayName}</p>
                <p className="text-xs text-gray-500">Agent ID: {intent.agent.id}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <p className="text-xs text-gray-500">Trust Score</p>
              <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.min(100, (intent.agent.riskScore / 1000) * 100)}%` }}
                />
              </div>
              <p className="text-xs font-medium text-gray-700">{intent.agent.riskScore}/1000</p>
            </div>
          </div>
        )}

        {/* Escrow State */}
        {escrow && (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Escrow State</h2>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Amount:{' '}
                <span className="font-semibold text-gray-900">{escrow.amountUsdc} USDC</span>
              </p>
              <StatusBadge status={escrow.status} />
            </div>
          </div>
        )}

        {/* Solana Explorer Link */}
        {solanaExplorerSearchUrl && (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">On-chain Verification</h2>
            <a
              href={solanaExplorerSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-indigo-600 hover:underline break-all"
            >
              Search on Solana Explorer →
            </a>
          </div>
        )}

        {/* Payment Timeline */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Payment Timeline</h2>
          <ol className="relative border-l border-gray-200 ml-3 space-y-4">
            {TIMELINE.map((step, idx) => {
              const done = idx <= currentStep;
              const active = idx === currentStep;
              return (
                <li key={step.key} className="ml-4">
                  <span
                    className={`absolute -left-1.5 mt-0.5 h-3 w-3 rounded-full border-2 border-white ${
                      done ? (active ? 'bg-indigo-500' : 'bg-green-400') : 'bg-gray-200'
                    }`}
                  />
                  <p
                    className={`text-sm ${
                      active ? 'font-semibold text-gray-900' : done ? 'text-gray-600' : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Verification Signature */}
        <div className="rounded-2xl bg-gray-900 p-5 text-white shadow-sm">
          <h2 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
            Verification Signature
          </h2>
          <p className="font-mono text-xs break-all text-green-400">{verificationSignature}</p>
          <p className="mt-2 text-xs text-gray-500">
            HMAC-SHA256 of intent ID — verify this payment at{' '}
            <code className="text-gray-300">/api/verify</code>
          </p>
        </div>

        {/* Timestamps */}
        <p className="text-center text-xs text-gray-400">
          Created: {intent.createdAt ? new Date(intent.createdAt).toLocaleString() : '—'}
          {' · '}
          Expires: {new Date(intent.expiresAt).toLocaleString()}
        </p>
      </div>
    </main>
  );
}
