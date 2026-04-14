'use client';

/**
 * OnboardingChecklist — shown at the top of the RCM dashboard for the first
 * few days. Tracks the four things a new practice must finish before the
 * agent can run end-to-end:
 *
 *   1. Workspace created (proves signup → onboard handoff worked)
 *   2. Stripe Connect payout route enabled (proves money can land)
 *   3. Primary connector configured (proves claims can flow in)
 *   4. First claim imported or demo run (proves the agent can act)
 *
 * Auto-hides once all four are done. Does not block the dashboard — if
 * the user dismisses it, a compact progress dot remains in the header.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Loader2, ArrowRight, X, PlayCircle } from 'lucide-react';

type Workspace = {
  workspaceId: string;
  name: string;
  workspaceType: string;
};

type ConnectStatus = {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsCurrentlyDue?: string[];
};

type Props = {
  workspace: Workspace | null;
  hasConnector: boolean;
  hasFirstClaim: boolean;
  onRunDemo: () => void;
  onJumpToConnectors: () => void;
};

const DISMISSED_KEY = 'ace_rcm_onboarding_checklist_dismissed';

export function OnboardingChecklist({
  workspace,
  hasConnector,
  hasFirstClaim,
  onRunDemo,
  onJumpToConnectors,
}: Props) {
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY) === '1') setDismissed(true);
    } catch {
      // ignore
    }
  }, []);

  const refreshConnectStatus = useCallback(async () => {
    if (!workspace) return;
    try {
      const res = await fetch(`/api/rcm/workspaces/${workspace.workspaceId}/connect-status`);
      if (!res.ok) return;
      const data = (await res.json()) as ConnectStatus;
      setConnectStatus(data);
    } catch {
      // silent — checklist degrades gracefully
    }
  }, [workspace]);

  useEffect(() => {
    void refreshConnectStatus();
  }, [refreshConnectStatus]);

  useEffect(() => {
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    if (params.get('connect') === 'return') {
      void refreshConnectStatus();
    }
  }, [refreshConnectStatus]);

  const startStripeOnboarding = useCallback(async () => {
    if (!workspace) return;
    setStripeLoading(true);
    try {
      const res = await fetch(`/api/rcm/workspaces/${workspace.workspaceId}/connect-account`, {
        method: 'POST',
      });
      if (!res.ok) {
        setStripeLoading(false);
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
    } catch {
      // ignore
    }
    setStripeLoading(false);
  }, [workspace]);

  const steps = useMemo(() => {
    const payoutsReady = Boolean(connectStatus?.payoutsEnabled);
    return [
      {
        id: 'workspace',
        label: 'Workspace created',
        detail: workspace?.name ? `Practice: ${workspace.name}` : 'Finish onboarding to create a workspace.',
        done: Boolean(workspace),
        action: null,
      },
      {
        id: 'stripe',
        label: 'Stripe payouts live',
        detail: payoutsReady
          ? 'Money can land in your bank account.'
          : connectStatus?.connected
            ? 'Stripe needs more information before payouts are enabled.'
            : 'Connect a bank account so payer payments can reach you.',
        done: payoutsReady,
        action: payoutsReady
          ? null
          : {
              label: stripeLoading ? 'Opening Stripe\u2026' : connectStatus?.connected ? 'Finish Stripe setup' : 'Connect Stripe',
              onClick: startStripeOnboarding,
              disabled: stripeLoading,
            },
      },
      {
        id: 'connector',
        label: 'Primary payer connector',
        detail: hasConnector
          ? 'Payer portal linked. Claims can flow in.'
          : 'Link your clearinghouse or payer portal so Ace can check claim status.',
        done: hasConnector,
        action: hasConnector
          ? null
          : { label: 'Add connector', onClick: onJumpToConnectors, disabled: false },
      },
      {
        id: 'first-claim',
        label: 'First claim worked',
        detail: hasFirstClaim
          ? 'Your agent has completed at least one claim check.'
          : 'Run a sample claim so you can see Ace work end-to-end.',
        done: hasFirstClaim,
        action: hasFirstClaim ? null : { label: 'Run demo claim', onClick: onRunDemo, disabled: false },
      },
    ];
  }, [workspace, connectStatus, stripeLoading, hasConnector, hasFirstClaim, onRunDemo, onJumpToConnectors, startStripeOnboarding]);

  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length;

  if (allDone || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  return (
    <div
      style={{
        marginBottom: 18,
        border: '1px solid #1e293b',
        borderRadius: 12,
        background: 'linear-gradient(180deg, #0b0f16 0%, #080808 100%)',
        padding: '18px 22px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Getting started
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', marginTop: 4 }}>
            {doneCount} of {steps.length} complete — finish these to unlock full agent autonomy
          </div>
        </div>
        <button
          onClick={dismiss}
          title="Hide checklist"
          style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', padding: 4 }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map(step => (
          <div
            key={step.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderRadius: 8,
              background: step.done ? 'rgba(16,185,129,0.05)' : '#0d1118',
              border: `1px solid ${step.done ? 'rgba(16,185,129,0.2)' : '#1a1f2a'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
              {step.done ? (
                <CheckCircle2 size={18} style={{ color: '#10b981', flexShrink: 0 }} />
              ) : (
                <Circle size={18} style={{ color: '#475569', flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: step.done ? '#94a3b8' : '#e8e8e8' }}>
                  {step.label}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {step.detail}
                </div>
              </div>
            </div>
            {step.action && (
              <button
                onClick={step.action.onClick}
                disabled={step.action.disabled}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px',
                  background: step.action.disabled ? '#065f46' : '#10b981',
                  color: '#000', border: 'none', borderRadius: 7,
                  fontSize: 12, fontWeight: 600, letterSpacing: '-0.01em',
                  cursor: step.action.disabled ? 'not-allowed' : 'pointer',
                  opacity: step.action.disabled ? 0.7 : 1,
                  flexShrink: 0,
                }}
              >
                {step.action.disabled && <Loader2 size={12} className="spin" />}
                {step.id === 'first-claim' && !step.action.disabled && <PlayCircle size={12} />}
                {step.action.label}
                {!step.action.disabled && step.id !== 'first-claim' && <ArrowRight size={12} />}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
