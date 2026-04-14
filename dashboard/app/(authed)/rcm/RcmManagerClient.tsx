'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  Cpu,
  DollarSign,
  Layers,
  Loader2,
  Mic,
  MicOff,
  Shield,
  Sparkles,
  Volume2,
  Zap,
} from 'lucide-react';
import { OnboardingChecklist } from './OnboardingChecklist';

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelState = 'ok' | 'error';
type Lane = 'claim-status' | 'eligibility';
type LaneMode = 'auto' | 'auto_notify' | 'human';
type ActiveTab = 'claims' | 'eligibility' | 'connectors' | 'workspaces' | 'agent';
type Operation =
  | 'run-primary'
  | 'run-fallback'
  | 'approve-qa'
  | 'escalate-qa'
  | 'take-over'
  | 'mark-blocked';

type ApprovalPolicy = {
  autoThresholdUsd: number;
  laneModes: Partial<Record<string, LaneMode>>;
  pausedUntil: string | null;
  version: number;
};

const DEFAULT_POLICY: ApprovalPolicy = {
  autoThresholdUsd: 500,
  laneModes: {
    'claim-status': 'auto',
    'eligibility': 'auto',
    'denial-follow-up': 'auto_notify',
    'prior-auth': 'human',
    'era-835': 'auto',
    'charge-capture': 'human',
    'drg-review': 'human',
  },
  pausedUntil: null,
  version: 1,
};

const LANE_LABELS: Record<string, string> = {
  'claim-status': 'Claim checks',
  'eligibility': 'Coverage checks',
  'denial-follow-up': 'Denial follow-up',
  'prior-auth': 'Prior auth',
  'era-835': 'ERA / 835',
  'charge-capture': 'Charge capture',
  'drg-review': 'DRG / coding review',
};

type Connector = {
  key: string;
  label: string;
  status: 'live' | 'simulation' | 'manual_fallback';
  mode: 'remote' | 'simulation' | 'manual';
  configured: boolean;
  capabilities: string[];
  notes: string;
};

type Workspace = {
  workspaceId: string;
  name: string;
  legalName: string | null;
  workspaceType: string;
  specialty: string | null;
  timezone: string | null;
  status: string;
  openWorkItems: number;
  humanReviewCount: number;
  amountAtRiskOpen: number;
  approvalPolicy?: ApprovalPolicy;
};

type ClaimStatusWorkItem = {
  workItemId: string;
  workspaceName: string;
  title: string;
  payerName: string | null;
  claimRef: string | null;
  amountAtRisk: number | null;
  confidencePct: number | null;
  priority: string;
  status: string;
  dueAt: string | null;
  requiresHumanReview: boolean;
};

type EligibilityWorkItem = {
  workItemId: string;
  workspaceName: string;
  title: string;
  payerName: string | null;
  memberId: string | null;
  amountAtRisk: number | null;
  confidencePct: number | null;
  priority: string;
  status: string;
  dueAt: string | null;
  requiresHumanReview: boolean;
};

type ClaimStatusException = {
  exceptionId: string;
  workItemId: string;
  workspaceName: string;
  payerName: string | null;
  claimRef: string | null;
  priority: string;
  exceptionType: string;
  severity: string;
  summary: string;
  recommendedHumanAction: string | null;
  slaAt: string | null;
};

type EligibilityException = {
  exceptionId: string;
  workItemId: string;
  workspaceName: string;
  payerName: string | null;
  memberId: string | null;
  priority: string;
  exceptionType: string;
  severity: string;
  summary: string;
  recommendedHumanAction: string | null;
  slaAt: string | null;
};

type ManagerActionRequest = {
  lane: Lane;
  operation: Operation;
  workItemId: string;
  summary?: string;
  exceptionType?: string;
  recommendedHumanAction?: string;
  severity?: string;
};

type ManagerSnapshot = {
  overview: {
    stage: string;
    queue: {
      totalWorkItems: number;
      totalOpen: number;
      autoClosedCount: number;
      humanClosedCount: number;
      blockedCount: number;
      rejectedCount: number;
      humanReviewCount: number;
      openExceptionCount: number;
      highSeverityExceptionCount: number;
      amountAtRiskOpen: number;
      avgConfidencePct: number | null;
      autoClosedPct: number;
      humanInterventionPct: number;
    };
    workspaces: { count: number };
    firstLane: {
      key: string;
      label: string;
      reason: string;
      totalItems: number;
      openItems: number;
      openExceptions: number;
    };
  };
  workspaces: { items: Workspace[]; count: number };
  workItems: { items: ClaimStatusWorkItem[]; count: number };
  exceptions: { items: ClaimStatusException[]; count: number };
  connectors: { connectors: Connector[] };
  eligibilityWorkItems: { items: EligibilityWorkItem[]; count: number };
  eligibilityExceptions: { items: EligibilityException[]; count: number };
  eligibilityConnectors: { connectors: Connector[] };
  partial: boolean;
  warnings: string[];
  panelStatus: {
    overview: PanelState;
    workspaces: PanelState;
    claimStatusWorkItems: PanelState;
    claimStatusExceptions: PanelState;
    claimStatusConnectors: PanelState;
    eligibilityWorkItems: PanelState;
    eligibilityExceptions: PanelState;
    eligibilityConnectors: PanelState;
  };
};

type ActionResponse = { message?: string; error?: string };

type BriefingData = { fallback: boolean; summary: string };
type PayerRow = { payerName: string; totalItems: number; denialRate: number; autoClosePct: number; amountAtRisk: number };
type PayerIntelData = { payers: PayerRow[] };

type CredentialType = 'payer_portal' | 'api_key' | 'x12_edi' | 'dde';
type StoredCredential = {
  id: string;
  credentialType: CredentialType;
  payerName: string;
  portalUrl: string | null;
  createdAt: string;
  rotatedAt: string | null;
};

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchRcmManagerSnapshot(): Promise<ManagerSnapshot> {
  const res = await fetch('/api/rcm/manager', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load billing snapshot');
  return res.json();
}

async function runManagerAction(payload: ManagerActionRequest): Promise<ActionResponse> {
  const res = await fetch('/api/rcm/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as ActionResponse;
  if (!res.ok) throw new Error(data.error ?? data.message ?? 'Action failed');
  return data;
}

async function persistPolicy(workspaceId: string, policy: ApprovalPolicy): Promise<void> {
  try { localStorage.setItem(`ace_policy_${workspaceId}`, JSON.stringify(policy)); } catch {}
  await fetch('/api/rcm/workspace-policy', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, approvalPolicy: policy }),
  }).catch(() => {});
}

async function fetchCredentials(workspaceId: string): Promise<StoredCredential[]> {
  const res = await fetch(`/api/rcm/payer-vault?workspaceId=${encodeURIComponent(workspaceId)}`);
  if (!res.ok) return [];
  const data = await res.json() as { credentials?: StoredCredential[] };
  return data.credentials ?? [];
}

async function saveCredential(payload: {
  workspaceId: string;
  credentialType: CredentialType;
  payerName: string;
  portalUrl?: string;
  plaintextData: Record<string, string>;
}): Promise<{ id?: string; error?: string }> {
  const res = await fetch('/api/rcm/payer-vault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({ error: 'Parse error' }));
}

async function deleteCredential(id: string): Promise<void> {
  await fetch(`/api/rcm/payer-vault/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function fetchAppeal(workItemId: string): Promise<{ appeal?: string; error?: string }> {
  const res = await fetch('/api/rcm/generate-appeal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workItemId }),
  });
  return res.json().catch(() => ({ error: 'Failed to parse response' }));
}

function hydratePolicy(workspaceId: string, serverPolicy?: ApprovalPolicy): ApprovalPolicy {
  if (serverPolicy) {
    // Server is source of truth — write through to localStorage so offline fallback stays fresh
    try { localStorage.setItem(`ace_policy_${workspaceId}`, JSON.stringify(serverPolicy)); } catch {}
    return serverPolicy;
  }
  // Offline fallback only when server didn't return a policy
  try {
    const raw = localStorage.getItem(`ace_policy_${workspaceId}`);
    if (raw) return { ...DEFAULT_POLICY, ...JSON.parse(raw) as ApprovalPolicy };
  } catch {}
  return DEFAULT_POLICY;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(v ?? 0);
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

function humanize(s: string): string { return s.replace(/_/g, ' '); }

function joinMeta(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p?.trim())).join(' · ');
}

function priorityAccent(p: string): string {
  if (p === 'urgent') return '#f43f5e';
  if (p === 'high') return '#f59e0b';
  if (p === 'normal') return '#38bdf8';
  return '#3a3a3a';
}

function severityStyle(s: string): { bg: string; border: string; text: string } {
  if (s === 'critical') return { bg: 'rgba(244,63,94,0.08)', border: 'rgba(244,63,94,0.2)', text: '#fb7185' };
  if (s === 'high') return { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', text: '#fcd34d' };
  return { bg: 'rgba(100,116,139,0.06)', border: 'rgba(100,116,139,0.15)', text: '#94a3b8' };
}

function actionKey(p: ManagerActionRequest): string {
  return `${p.lane}:${p.operation}:${p.workItemId}`;
}

function workItemActions(lane: Lane, item: ClaimStatusWorkItem | EligibilityWorkItem): ManagerActionRequest[] {
  if (item.status === 'routed')
    return [{ lane, operation: 'run-primary', workItemId: item.workItemId }];
  if (item.status === 'retry_pending')
    return [{ lane, operation: 'run-fallback', workItemId: item.workItemId }];
  if (item.status === 'awaiting_qa')
    return [
      { lane, operation: 'approve-qa', workItemId: item.workItemId },
      { lane, operation: 'escalate-qa', workItemId: item.workItemId, summary: `${item.title} needs manual review.` },
    ];
  return [];
}

function exceptionActions(lane: Lane, item: ClaimStatusException | EligibilityException): ManagerActionRequest[] {
  return [
    { lane, operation: 'take-over', workItemId: item.workItemId, summary: item.summary },
    { lane, operation: 'mark-blocked', workItemId: item.workItemId, summary: item.summary },
  ];
}

// ── Briefing strip ─────────────────────────────────────────────────────────────

function BriefingStrip({
  briefing, briefingLoading,
  humanReviewCount, autoCount, autoClosedPct, snapshotLoading, onReview,
}: {
  briefing: BriefingData | null | undefined;
  briefingLoading: boolean;
  humanReviewCount: number;
  autoCount: number;
  autoClosedPct: number;
  snapshotLoading: boolean;
  onReview: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const fallbackText = snapshotLoading ? null
    : autoCount > 0
      ? `${autoCount} item${autoCount !== 1 ? 's' : ''} auto-resolved today · ${autoClosedPct}% autonomous rate`
      : 'Queue is clear';

  const displayText = briefing?.summary ?? fallbackText;
  const isFallback = !briefing || briefing.fallback;

  const needsTruncate = (displayText?.length ?? 0) > 200;
  const shown = needsTruncate && !expanded
    ? `${displayText!.slice(0, 200)}\u2026`
    : displayText;

  return (
    <div style={{
      marginBottom: 16, padding: '12px 16px', borderRadius: 10,
      background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginTop: 1 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: '#10b981',
              animation: 'ace-pulse 1.4s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', letterSpacing: '-0.01em' }}>Ace</span>
          </div>

          {briefingLoading && !displayText ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
              <div style={{ width: 120, height: 10, borderRadius: 4, background: '#111', animation: 'shimmer 1.4s ease-in-out infinite' }} />
              <div style={{ width: 80, height: 10, borderRadius: 4, background: '#111', animation: 'shimmer 1.4s ease-in-out infinite' }} />
            </div>
          ) : (
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12, color: isFallback ? '#555' : '#aaa', lineHeight: 1.6 }}>
                {shown}
              </span>
              {needsTruncate && (
                <button
                  onClick={() => setExpanded(x => !x)}
                  style={{ marginLeft: 6, fontSize: 11, color: '#444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {expanded ? 'less' : 'more'}
                </button>
              )}
            </div>
          )}
        </div>

        {!snapshotLoading && (humanReviewCount > 0 ? (
          <button
            onClick={onReview}
            style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)',
              color: '#fb7185', cursor: 'pointer',
            }}
          >
            <AlertTriangle size={10} />
            {humanReviewCount} need{humanReviewCount === 1 ? 's' : ''} your input
          </button>
        ) : (
          <span style={{ flexShrink: 0, fontSize: 11, color: '#333', display: 'flex', alignItems: 'center', gap: 5 }}>
            <CheckCircle2 size={10} style={{ color: '#10b981' }} />
            Nothing needs your input
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Shared display components ─────────────────────────────────────────────────

function WarnBanner({ text, style: extra }: { text: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8, fontSize: 12,
      background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', color: '#fcd34d',
      ...extra,
    }}>
      {text}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{
      padding: '20px 14px', borderRadius: 10, textAlign: 'center',
      background: '#080808', border: '1px dashed #1a1a1a', fontSize: 12, color: '#444',
    }}>
      {text}
    </div>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────

function ActionBtn({
  payload, pending, onClick,
}: {
  payload: ManagerActionRequest;
  pending: boolean;
  onClick: (p: ManagerActionRequest) => void;
}) {
  const isGreen = payload.operation === 'approve-qa' || payload.operation === 'take-over';
  const isAmber = payload.operation === 'escalate-qa' || payload.operation === 'mark-blocked';
  const label =
    payload.operation === 'run-primary' ? 'Run' :
    payload.operation === 'run-fallback' ? 'Fallback' :
    payload.operation === 'approve-qa' ? 'Approve' :
    payload.operation === 'escalate-qa' ? 'Escalate' :
    payload.operation === 'take-over' ? 'Take over' : 'Block';

  return (
    <button
      onClick={() => onClick(payload)}
      disabled={pending}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 11px', borderRadius: 6, fontSize: 11, fontWeight: 600,
        letterSpacing: '0.05em', textTransform: 'uppercase',
        cursor: pending ? 'not-allowed' : 'pointer', border: '1px solid',
        background: isGreen ? 'rgba(16,185,129,0.1)' : isAmber ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.04)',
        borderColor: isGreen ? 'rgba(16,185,129,0.25)' : isAmber ? 'rgba(245,158,11,0.2)' : '#1e1e1e',
        color: isGreen ? '#34d399' : isAmber ? '#fcd34d' : '#888',
        opacity: pending ? 0.6 : 1, transition: 'opacity 0.15s',
      }}
    >
      {pending && <Loader2 size={10} className="animate-spin" />}
      {label}
    </button>
  );
}

// ── Work item row ─────────────────────────────────────────────────────────────

type WorkItemRowProps = {
  lane: Lane;
  item: ClaimStatusWorkItem | EligibilityWorkItem;
  expandedId: string | null;
  highlighted?: boolean;
  onExpand: (id: string | null) => void;
  checkPending: (p: ManagerActionRequest) => boolean;
  onAction: (p: ManagerActionRequest) => void;
};

function WorkItemRow({ lane, item, expandedId, highlighted = false, onExpand, checkPending, onAction }: WorkItemRowProps) {
  const expanded = expandedId === item.workItemId;
  const actions = workItemActions(lane, item);
  const accent = priorityAccent(item.priority);
  const ref = lane === 'claim-status'
    ? (item as ClaimStatusWorkItem).claimRef
    : (item as EligibilityWorkItem).memberId;

  return (
    <div style={{
      borderRadius: 10,
      background: highlighted ? 'rgba(16,185,129,0.05)' : '#080808',
      border: highlighted ? '1px solid rgba(16,185,129,0.22)' : '1px solid #161616',
      boxShadow: highlighted ? '0 0 0 1px rgba(16,185,129,0.08)' : 'none',
      overflow: 'hidden',
    }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer' }}
        onClick={() => onExpand(expanded ? null : item.workItemId)}
      >
        <div style={{ width: 3, height: 34, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </div>
          <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>
            {joinMeta(item.workspaceName, item.payerName, ref)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {item.requiresHumanReview && (
            <span style={{
              padding: '2px 7px', borderRadius: 4,
              background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.18)',
              color: '#fb7185', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              Review
            </span>
          )}
          <span style={{
            padding: '2px 7px', borderRadius: 4,
            background: '#0d0d0d', border: '1px solid #1a1a1a',
            color: '#666', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {humanize(item.status)}
          </span>
          <div style={{ textAlign: 'right', minWidth: 72 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>{fmt$(item.amountAtRisk)}</div>
            {item.confidencePct !== null && (
              <div style={{ fontSize: 10, color: '#444', marginTop: 1 }}>{item.confidencePct}% conf</div>
            )}
          </div>
          <ChevronDown
            size={13}
            style={{ color: '#333', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s', flexShrink: 0 }}
          />
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '10px 14px 12px 29px', borderTop: '1px solid #111', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {actions.length > 0 ? (
            <>
              <span style={{ fontSize: 11, color: '#444' }}>Action:</span>
              {actions.map(p => (
                <ActionBtn key={actionKey(p)} payload={p} pending={checkPending(p)} onClick={onAction} />
              ))}
            </>
          ) : (
            <span style={{ fontSize: 11, color: '#444' }}>No actions available.</span>
          )}
          {item.dueAt && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#444' }}>Due {fmtDate(item.dueAt)}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Exception card ─────────────────────────────────────────────────────────────

type ExceptionCardProps = {
  lane: Lane;
  item: ClaimStatusException | EligibilityException;
  highlighted?: boolean;
  checkPending: (p: ManagerActionRequest) => boolean;
  onAction: (p: ManagerActionRequest) => void;
  onAppeal?: (workItemId: string) => void;
};

function ExceptionCard({ lane, item, highlighted = false, checkPending, onAction, onAppeal }: ExceptionCardProps) {
  const actions = exceptionActions(lane, item);
  const { bg, border, text } = severityStyle(item.severity);
  const ref = lane === 'claim-status'
    ? (item as ClaimStatusException).claimRef
    : (item as EligibilityException).memberId;

  return (
    <div style={{
      borderRadius: 10,
      background: highlighted ? 'rgba(16,185,129,0.08)' : bg,
      border: highlighted ? '1px solid rgba(16,185,129,0.22)' : `1px solid ${border}`,
      boxShadow: highlighted ? '0 0 0 1px rgba(16,185,129,0.08)' : 'none',
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', lineHeight: 1.4 }}>{item.summary}</div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
            {joinMeta(item.workspaceName, item.payerName, ref)}
          </div>
        </div>
        <span style={{
          padding: '2px 8px', borderRadius: 4,
          background: 'rgba(255,255,255,0.04)', border: `1px solid ${border}`,
          color: text, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', flexShrink: 0,
        }}>
          {item.severity}
        </span>
      </div>
      {item.recommendedHumanAction && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
          <span style={{ color: '#555' }}>Recommended: </span>
          {item.recommendedHumanAction}
        </div>
      )}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {actions.map(p => (
          <ActionBtn key={actionKey(p)} payload={p} pending={checkPending(p)} onClick={onAction} />
        ))}
        {onAppeal && (item.exceptionType?.toLowerCase().includes('denial') || item.severity === 'critical') && lane === 'claim-status' && (
          <button
            onClick={() => onAppeal(item.workItemId)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer',
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
              color: '#a78bfa',
            }}
          >
            Appeal
          </button>
        )}
        {item.slaAt && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#444' }}>SLA {fmtDate(item.slaAt)}</span>
        )}
      </div>
    </div>
  );
}

// ── Connector grid — A2A payer readiness ──────────────────────────────────────

function ConnectorGrid({
  connectors, claimErr, eligErr, isLoading, credentials, onConnect, onRevoke,
}: {
  connectors: Connector[];
  claimErr: boolean;
  eligErr: boolean;
  isLoading: boolean;
  credentials: StoredCredential[];
  onConnect: (payerName: string) => void;
  onRevoke: (credentialId: string, payerName: string) => void;
}) {
  const liveCount = connectors.filter(c => c.status === 'live').length;
  const simCount = connectors.filter(c => c.status === 'simulation').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Payer network
        </div>
        {simCount > 0 && !isLoading && (
          <span style={{ fontSize: 11, color: '#f59e0b' }}>
            {simCount} connecting — agent adjudication incoming
          </span>
        )}
      </div>

      {liveCount > 0 && !isLoading && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 8,
          background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Zap size={12} style={{ color: '#10b981', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#555' }}>
            <span style={{ color: '#34d399', fontWeight: 600 }}>{liveCount} agent-ready</span>
            {' '}payer{liveCount !== 1 ? 's' : ''} — claims bypass the legacy queue and process via direct API.
          </span>
        </div>
      )}

      {(claimErr || eligErr) && (
        <WarnBanner text="One or more connector panels failed to refresh." style={{ marginBottom: 12 }} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
        {connectors.map(c => {
          const isLive = c.status === 'live';
          const isSim = c.status === 'simulation';
          const statusLabel = isLive ? 'Agent-ready' : isSim ? 'Connecting' : 'Legacy queue';
          const color = isLive ? '#34d399' : isSim ? '#fcd34d' : '#555';
          const bg = isLive ? 'rgba(16,185,129,0.08)' : isSim ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.02)';
          const bdr = isLive ? 'rgba(16,185,129,0.2)' : isSim ? 'rgba(245,158,11,0.15)' : '#1a1a1a';
          const speed = isLive ? '~24h via API' : isSim ? 'Connecting...' : '3–5 business days';
          const cred = credentials.find(cr => cr.payerName.toLowerCase() === c.label.toLowerCase());

          return (
            <div key={c.key} style={{ padding: '14px 16px', borderRadius: 10, background: '#080808', border: '1px solid #161616' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>{c.label}</div>
                <span style={{
                  padding: '2px 9px', borderRadius: 20,
                  background: bg, border: `1px solid ${bdr}`,
                  fontSize: 10, fontWeight: 600, color, letterSpacing: '0.04em',
                }}>
                  {statusLabel}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#444', marginBottom: 8 }}>{speed}</div>
              <div style={{ fontSize: 11, color: '#555', lineHeight: 1.5 }}>{c.notes}</div>
              {c.capabilities.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
                  {c.capabilities.map(cap => (
                    <span key={cap} style={{
                      padding: '2px 6px', borderRadius: 4, background: '#0d0d0d', border: '1px solid #1a1a1a',
                      fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {cap.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
              {/* Credential row */}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {cred ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>Credentials stored</span>
                      <span style={{ fontSize: 10, color: '#333' }}>· {cred.credentialType.replace(/_/g, ' ')}</span>
                    </div>
                    <button
                      onClick={() => onRevoke(cred.id, c.label)}
                      style={{ fontSize: 10, fontWeight: 600, color: '#555', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
                    >
                      Revoke
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => onConnect(c.label)}
                    style={{
                      fontSize: 11, fontWeight: 600, color: '#888',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid #1c1c1c',
                      borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    + Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {connectors.length === 0 && !isLoading && <EmptyState text="No connectors configured." />}
      </div>
    </div>
  );
}

// ── Workspace grid ─────────────────────────────────────────────────────────────

function WorkspaceGrid({
  workspaces, unavailable, isLoading, highlightedWorkspaceId,
}: {
  workspaces: Workspace[];
  unavailable: boolean;
  isLoading: boolean;
  highlightedWorkspaceId?: string | null;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
        Active practices
      </div>
      {unavailable && <WarnBanner text="Workspace roster unavailable." />}
      {!unavailable && !isLoading && workspaces.length === 0 && <EmptyState text="No practices active." />}
      {!unavailable && workspaces.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {workspaces.map(ws => (
            <div key={ws.workspaceId} style={{
              padding: '16px',
              borderRadius: 10,
              background: highlightedWorkspaceId === ws.workspaceId ? 'rgba(16,185,129,0.05)' : '#080808',
              border: highlightedWorkspaceId === ws.workspaceId ? '1px solid rgba(16,185,129,0.22)' : '1px solid #161616',
              boxShadow: highlightedWorkspaceId === ws.workspaceId ? '0 0 0 1px rgba(16,185,129,0.08)' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>{ws.name}</div>
                {ws.workspaceType === 'institutional' && (
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', background: '#1e293b', color: '#94a3b8', padding: '2px 6px', borderRadius: 4 }}>
                    UB-04
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
                {[
                  ws.workspaceType === 'institutional' ? 'Institutional'
                    : ws.workspaceType === 'professional_rcm' ? 'Professional'
                    : ws.workspaceType === 'facility_rcm' ? 'Facility'
                    : ws.workspaceType,
                  ws.specialty,
                ].filter(Boolean).join(' · ')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
                {[
                  { label: 'Open', value: String(ws.openWorkItems) },
                  { label: 'Review', value: String(ws.humanReviewCount) },
                  { label: 'At risk', value: fmt$(ws.amountAtRiskOpen) },
                ].map(stat => (
                  <div key={stat.label}>
                    <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{stat.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', marginTop: 3 }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Agent console ─────────────────────────────────────────────────────────────

function modeBadge(m: LaneMode): { label: string; color: string; bg: string; border: string } {
  if (m === 'auto') return { label: 'Fully auto', color: '#34d399', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' };
  if (m === 'auto_notify') return { label: 'Auto + notify', color: '#fcd34d', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' };
  return { label: 'Human review', color: '#fb7185', bg: 'rgba(244,63,94,0.06)', border: 'rgba(244,63,94,0.15)' };
}

function AgentConsole({
  workspace, policy, onPolicyChange,
  autoClosedPct, avgConfidencePct, humanInterventionPct, autoClosedCount, isLoading,
}: {
  workspace: Workspace | null;
  policy: ApprovalPolicy;
  onPolicyChange: (p: ApprovalPolicy) => void;
  autoClosedPct: number;
  avgConfidencePct: number | null;
  humanInterventionPct: number;
  autoClosedCount: number;
  isLoading: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const conf = avgConfidencePct ?? 70;
  const trustScore = Math.round(autoClosedPct * 0.5 + conf * 0.3 + (100 - humanInterventionPct) * 0.2);
  const grade = trustScore >= 80 ? 'A' : trustScore >= 70 ? 'B' : trustScore >= 60 ? 'C' : trustScore >= 50 ? 'D' : 'F';
  const gradeColor = grade === 'A' ? '#10b981' : grade === 'B' ? '#34d399' : grade === 'C' ? '#f59e0b' : '#f43f5e';

  const agentId = workspace
    ? `agt_rcm_${workspace.workspaceId.replace(/-/g, '').slice(0, 10)}`
    : 'agt_rcm_—';

  const isPaused = policy.pausedUntil !== null;

  async function applyPolicy(next: ApprovalPolicy) {
    onPolicyChange(next);
    setSaving(true);
    if (workspace) await persistPolicy(workspace.workspaceId, next);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (isLoading) return <EmptyState text="Loading agent data..." />;

  return (
    <div className="ace-agent-console-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, alignItems: 'start' }}>

      {/* Left — identity + trust score */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '20px', borderRadius: 12, background: '#080808', border: '1px solid #161616' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: isPaused ? '#111' : 'linear-gradient(135deg, #059669, #10b981)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: isPaused ? 'none' : '0 0 16px rgba(16,185,129,0.2)',
              transition: 'all 0.2s',
            }}>
              <Bot size={20} style={{ color: isPaused ? '#444' : '#000' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#ededef' }}>Ace — Billing Agent</div>
              <div style={{ fontSize: 11, color: '#333', marginTop: 2, fontFamily: 'monospace' }}>{agentId}</div>
            </div>
          </div>

          {isPaused && (
            <div style={{
              marginBottom: 12, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.15)',
              fontSize: 11, color: '#fb7185',
            }}>
              Autonomous actions paused until {fmtDate(policy.pausedUntil)}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                Agent trust score
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 40, fontWeight: 800, color: '#ededef', letterSpacing: '-0.04em', lineHeight: 1 }}>
                  {trustScore}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: gradeColor }}>
                  / 100 · {grade}
                </span>
              </div>
            </div>
            <Activity size={18} style={{ color: '#1c1c1c', marginBottom: 4 }} />
          </div>
          <div style={{ height: 3, background: '#141414', borderRadius: 2, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ height: '100%', width: `${trustScore}%`, background: gradeColor, borderRadius: 2, transition: 'width 0.6s ease' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {[
              { label: 'Auto-resolved', value: `${autoClosedPct}%` },
              { label: 'Confidence', value: avgConfidencePct !== null ? `${avgConfidencePct}%` : '—' },
              { label: 'Items handled', value: String(autoClosedCount) },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#e0e0e0', marginTop: 3 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => applyPolicy({ ...policy, pausedUntil: isPaused ? null : new Date(Date.now() + 86_400_000).toISOString() })}
          style={{
            width: '100%', padding: '11px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', border: '1px solid', transition: 'all 0.15s',
            background: isPaused ? 'rgba(16,185,129,0.06)' : 'rgba(244,63,94,0.06)',
            borderColor: isPaused ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.15)',
            color: isPaused ? '#34d399' : '#fb7185',
          }}
        >
          {isPaused ? '▶ Resume autonomous actions' : '⏸ Pause autonomous actions (24h)'}
        </button>
      </div>

      {/* Right — authority controls */}
      <div style={{ padding: '20px', borderRadius: 12, background: '#080808', border: '1px solid #161616' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ededef' }}>Agent authority</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Control what Ace handles autonomously</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {saving && <Loader2 size={12} className="animate-spin" style={{ color: '#444' }} />}
            {saved && !saving && <span style={{ fontSize: 11, color: '#10b981' }}>Saved</span>}
          </div>
        </div>

        {/* Dollar threshold */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
            Auto-handle items under{' '}
            <span style={{ color: '#ededef', fontWeight: 600 }}>{fmt$(policy.autoThresholdUsd)}</span>
          </div>
          <input
            type="range" min={0} max={5000} step={100}
            value={policy.autoThresholdUsd}
            onChange={e => applyPolicy({ ...policy, autoThresholdUsd: Number(e.target.value) })}
            style={{ width: '100%', accentColor: '#10b981' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#2a2a2a', marginTop: 4 }}>
            <span>$0</span><span>$5,000</span>
          </div>
        </div>

        {/* Per-lane toggles */}
        <div style={{ fontSize: 11, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
          Per-lane authority
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(LANE_LABELS).map(([lane, label]) => {
            const current: LaneMode = (policy.laneModes[lane] as LaneMode) ?? 'auto';
            const cb = modeBadge(current);
            return (
              <div key={lane} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 12px', borderRadius: 8, background: '#0d0d0d', border: '1px solid #161616',
              }}>
                <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500 }}>{label}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['auto', 'auto_notify', 'human'] as LaneMode[]).map(m => {
                    const mb = modeBadge(m);
                    const active = current === m;
                    return (
                      <button
                        key={m}
                        onClick={() => applyPolicy({ ...policy, laneModes: { ...policy.laneModes, [lane]: m } })}
                        title={mb.label}
                        style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          cursor: 'pointer', border: '1px solid', transition: 'all 0.12s',
                          background: active ? mb.bg : 'transparent',
                          borderColor: active ? mb.border : '#1c1c1c',
                          color: active ? mb.color : '#2a2a2a',
                        }}
                      >
                        {mb.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.08)', fontSize: 11, color: '#444', lineHeight: 1.65 }}>
          <span style={{ color: '#34d399', fontWeight: 600 }}>Fully auto</span> — Ace acts immediately{' · '}
          <span style={{ color: '#fcd34d', fontWeight: 600 }}>Auto + notify</span> — Ace acts, you get an alert{' · '}
          <span style={{ color: '#fb7185', fontWeight: 600 }}>Human review</span> — Ace queues it for you
        </div>
      </div>
    </div>
  );
}

// ── Connect modal ─────────────────────────────────────────────────────────────

function ConnectModal({
  payerName, workspaceId, onSuccess, onClose,
}: {
  payerName: string;
  workspaceId: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [credType, setCredType] = useState<CredentialType>('payer_portal');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [portalUrl, setPortalUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const plaintextData: Record<string, string> = {};
    if (credType === 'payer_portal' || credType === 'dde') {
      if (!username.trim()) { setError('Username is required.'); return; }
      if (!password.trim()) { setError('Password is required.'); return; }
      plaintextData.username = username.trim();
      plaintextData.password = password.trim();
    } else {
      if (!apiKey.trim()) { setError('API key / EDI key is required.'); return; }
      plaintextData.apiKey = apiKey.trim();
    }

    setSaving(true);
    const result = await saveCredential({
      workspaceId,
      credentialType: credType,
      payerName,
      portalUrl: portalUrl.trim() || undefined,
      plaintextData,
    });
    setSaving(false);

    if (result.error) { setError(result.error); return; }
    onSuccess();
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#0d0d0d', border: '1px solid #1c1c1c',
    borderRadius: 8, color: '#ededef', fontSize: 13, padding: '10px 12px',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter, system-ui, sans-serif',
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, background: '#0a0a0a', border: '1px solid #1c1c1c', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #141414', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ededef' }}>Connect payer</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{payerName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        <form onSubmit={submit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Credential type */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Connection type</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([['payer_portal', 'Portal login'], ['api_key', 'API key'], ['x12_edi', 'X12 EDI'], ['dde', 'DDE']] as [CredentialType, string][]).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setCredType(val)}
                  style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: credType === val ? 'rgba(16,185,129,0.1)' : 'transparent',
                    border: `1px solid ${credType === val ? 'rgba(16,185,129,0.3)' : '#1c1c1c'}`,
                    color: credType === val ? '#34d399' : '#555',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Portal URL (all types) */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Portal URL <span style={{ color: '#333', textTransform: 'none', fontWeight: 400 }}>(optional)</span>
            </label>
            <input type="url" value={portalUrl} onChange={e => setPortalUrl(e.target.value)} placeholder="https://provider.availity.com" style={inputStyle} />
          </div>

          {/* Fields by type */}
          {(credType === 'payer_portal' || credType === 'dde') ? (
            <>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Username / NPI</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="your_username" autoComplete="off" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" style={inputStyle} />
              </div>
            </>
          ) : (
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                {credType === 'x12_edi' ? 'Submitter ID / key' : 'API key'}
              </label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="••••••••••••" autoComplete="new-password" style={inputStyle} />
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: '#fb7185' }}>{error}</div>}

          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.08)', fontSize: 11, color: '#444', lineHeight: 1.6 }}>
            Credentials are encrypted with AES-256-GCM before storage. Ace never logs plaintext.
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: saving ? '#059669' : '#10b981', color: '#000',
              border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.8 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Encrypting & saving…' : 'Save credentials →'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Appeal modal ──────────────────────────────────────────────────────────────

function AppealModal({
  text, loading, error, onClose,
}: {
  text: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 600, maxHeight: '80vh',
          background: '#0a0a0a', border: '1px solid #1c1c1c', borderRadius: 14,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #141414', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ededef' }}>Appeal letter</div>
            <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>Drafted by Ace · Review before sending</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {text && (
              <button
                onClick={copy}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: copied ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${copied ? 'rgba(16,185,129,0.25)' : '#1c1c1c'}`,
                  color: copied ? '#34d399' : '#888', cursor: 'pointer',
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#555', fontSize: 13 }}>
              <Loader2 size={14} className="animate-spin" />
              Drafting appeal\u2026
            </div>
          )}
          {error && (
            <div style={{ fontSize: 13, color: '#fb7185' }}>{error}</div>
          )}
          {text && !loading && (
            <pre style={{
              margin: 0, fontSize: 12, color: '#ccc', lineHeight: 1.8,
              fontFamily: 'Inter, system-ui, sans-serif', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payer intelligence ────────────────────────────────────────────────────────

function PayerIntelligence({ data, loading }: { data: PayerIntelData | undefined; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const payers = (data?.payers ?? []).slice(0, 10);

  return (
    <div style={{ marginTop: 20, borderTop: '1px solid #111', paddingTop: 16 }}>
      <button
        onClick={() => setOpen(x => !x)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Payer analytics
        </span>
        <ChevronDown
          size={13}
          style={{ color: '#333', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}
        />
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[1, 2, 3].map(n => (
                <div key={n} style={{ height: 32, borderRadius: 6, background: '#0d0d0d', animation: 'shimmer 1.4s ease-in-out infinite' }} />
              ))}
            </div>
          )}
          {!loading && payers.length === 0 && (
            <EmptyState text="No payer data for this period." />
          )}
          {!loading && payers.length > 0 && (
            <div style={{ borderRadius: 8, border: '1px solid #141414', overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr',
                padding: '8px 14px', background: '#090909', borderBottom: '1px solid #141414',
              }}>
                {['Payer', 'Denial rate', 'Auto-close', '$ at risk'].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 600, color: '#333', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {h}
                  </span>
                ))}
              </div>
              {payers.map((p, i) => (
                <div key={p.payerName} style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr',
                  padding: '9px 14px',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  borderBottom: i < payers.length - 1 ? '1px solid #0f0f0f' : 'none',
                }}>
                  <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.payerName}
                  </span>
                  <span style={{ fontSize: 12, color: p.denialRate > 20 ? '#f59e0b' : '#555', fontWeight: p.denialRate > 20 ? 600 : 400 }}>
                    {p.denialRate.toFixed(1)}%
                  </span>
                  <span style={{ fontSize: 12, color: p.autoClosePct > 60 ? '#34d399' : '#555', fontWeight: p.autoClosePct > 60 ? 600 : 400 }}>
                    {p.autoClosePct.toFixed(1)}%
                  </span>
                  <span style={{ fontSize: 12, color: '#888' }}>
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(p.amountAtRisk)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TTS (voice FAB) ───────────────────────────────────────────────────────────

function useDashboardTts() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  return useCallback(async (text: string) => {
    try {
      const res = await fetch('/api/tts-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('non-ok');
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const d = await res.json() as { fallback?: boolean };
        if (d.fallback && typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
        }
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
    }
  }, []);
}

type OperatorFocus = {
  tab: ActiveTab;
  kind: 'work-item' | 'exception' | 'connector' | 'workspace' | 'policy';
  id: string;
  label: string;
  detail: string;
};

type AceSuggestedOption = {
  id: string;
  eyebrow: string;
  title: string;
  detail: string;
  tab: ActiveTab;
  cta: string;
  tone: 'critical' | 'action' | 'monitor';
  focus?: OperatorFocus;
};

function buildAceSuggestedOptions({
  queue,
  workspaces,
  claimExceptions,
  eligibilityExceptions,
  claimItems,
  eligibilityItems,
  connectors,
}: {
  queue: ManagerSnapshot['overview']['queue'] | undefined;
  workspaces: Workspace[];
  claimExceptions: ClaimStatusException[];
  eligibilityExceptions: EligibilityException[];
  claimItems: ClaimStatusWorkItem[];
  eligibilityItems: EligibilityWorkItem[];
  connectors: Connector[];
}): AceSuggestedOption[] {
  const options: AceSuggestedOption[] = [];

  const criticalClaim = claimExceptions.find((item) => item.severity === 'critical') ?? claimExceptions[0];
  const criticalEligibility = eligibilityExceptions.find((item) => item.severity === 'critical') ?? eligibilityExceptions[0];
  const reviewTarget = (queue?.humanReviewCount ?? 0) > 0
    ? claimItems.find((item) => item.requiresHumanReview) ?? eligibilityItems.find((item) => item.requiresHumanReview)
    : null;
  const nonLiveConnectors = connectors.filter((connector) => connector.status !== 'live');
  const topWorkspace = [...workspaces].sort((a, b) => b.amountAtRiskOpen - a.amountAtRiskOpen)[0];

  if (criticalClaim) {
    options.push({
      id: 'claim-exception',
      eyebrow: 'Needs decision',
      title: 'Review the top denial block',
      detail: `${criticalClaim.payerName ?? 'Payer'} needs attention${criticalClaim.claimRef ? ` on ${criticalClaim.claimRef}` : ''}. ${criticalClaim.summary}`,
      tab: 'claims',
      cta: 'Open claim checks',
      tone: criticalClaim.severity === 'critical' ? 'critical' : 'action',
      focus: {
        tab: 'claims',
        kind: 'exception',
        id: criticalClaim.exceptionId,
        label: criticalClaim.claimRef ? `${criticalClaim.payerName ?? 'Payer'} · ${criticalClaim.claimRef}` : (criticalClaim.payerName ?? 'Claim exception'),
        detail: criticalClaim.summary,
      },
    });
  } else if (criticalEligibility) {
    options.push({
      id: 'eligibility-exception',
      eyebrow: 'Coverage issue',
      title: 'Clear the highest-risk eligibility miss',
      detail: `${criticalEligibility.payerName ?? 'Payer'} needs a manual check. ${criticalEligibility.summary}`,
      tab: 'eligibility',
      cta: 'Open coverage checks',
      tone: criticalEligibility.severity === 'critical' ? 'critical' : 'action',
      focus: {
        tab: 'eligibility',
        kind: 'exception',
        id: criticalEligibility.exceptionId,
        label: criticalEligibility.memberId ? `${criticalEligibility.payerName ?? 'Payer'} · ${criticalEligibility.memberId}` : (criticalEligibility.payerName ?? 'Eligibility exception'),
        detail: criticalEligibility.summary,
      },
    });
  }

  if (reviewTarget) {
    options.push({
      id: 'review-queue',
      eyebrow: 'Human review',
      title: `${queue?.humanReviewCount ?? 0} item${queue?.humanReviewCount === 1 ? '' : 's'} waiting for approval`,
      detail: `${reviewTarget.workspaceName} is holding the next decision. Surface the queue instead of making operators hunt for it.`,
      tab: 'claimRef' in reviewTarget ? 'claims' : 'eligibility',
      cta: 'Review queue',
      tone: 'action',
      focus: {
        tab: 'claimRef' in reviewTarget ? 'claims' : 'eligibility',
        kind: 'work-item',
        id: reviewTarget.workItemId,
        label: reviewTarget.title,
        detail: `${reviewTarget.workspaceName}${reviewTarget.payerName ? ` · ${reviewTarget.payerName}` : ''}`,
      },
    });
  }

  if (nonLiveConnectors.length > 0) {
    options.push({
      id: 'connectors',
      eyebrow: 'Setup gap',
      title: `Connect ${nonLiveConnectors.length} payer lane${nonLiveConnectors.length === 1 ? '' : 's'}`,
      detail: `${nonLiveConnectors[0]?.label ?? 'A payer'} is still in simulation or manual mode, so Ace cannot behave like a full operator there yet.`,
      tab: 'connectors',
      cta: 'Open payer network',
      tone: 'action',
      focus: {
        tab: 'connectors',
        kind: 'connector',
        id: nonLiveConnectors[0]?.key ?? 'connectors',
        label: nonLiveConnectors[0]?.label ?? 'Payer network',
        detail: nonLiveConnectors[0]?.notes ?? 'Finish connector setup so Ace can operate directly.',
      },
    });
  }

  if (topWorkspace && topWorkspace.amountAtRiskOpen > 0) {
    options.push({
      id: 'workspace-risk',
      eyebrow: 'At risk',
      title: `Protect ${fmt$(topWorkspace.amountAtRiskOpen)} in ${topWorkspace.name}`,
      detail: `${topWorkspace.openWorkItems} open items and ${topWorkspace.humanReviewCount} manual reviews are sitting in the highest-risk practice.`,
      tab: 'workspaces',
      cta: 'Open practices',
      tone: 'monitor',
      focus: {
        tab: 'workspaces',
        kind: 'workspace',
        id: topWorkspace.workspaceId,
        label: topWorkspace.name,
        detail: `${topWorkspace.openWorkItems} open items · ${topWorkspace.humanReviewCount} manual review${topWorkspace.humanReviewCount === 1 ? '' : 's'} · ${fmt$(topWorkspace.amountAtRiskOpen)} at risk`,
      },
    });
  }

  if ((queue?.autoClosedPct ?? 0) < 70) {
    options.push({
      id: 'agent-authority',
      eyebrow: 'Autonomy tuning',
      title: 'Tighten Ace authority by lane',
      detail: `Autonomous close rate is ${queue?.autoClosedPct ?? 0}%. Adjust thresholds before scaling new workspaces.`,
      tab: 'agent',
      cta: 'Open agent controls',
      tone: 'monitor',
      focus: {
        tab: 'agent',
        kind: 'policy',
        id: 'agent-authority',
        label: 'Agent authority',
        detail: `Autonomous close rate is ${queue?.autoClosedPct ?? 0}%. Tighten guardrails before adding more volume.`,
      },
    });
  }

  if (options.length === 0) {
    options.push({
      id: 'monitor',
      eyebrow: 'Queue clear',
      title: 'Keep Ace in monitor mode',
      detail: 'No urgent actions surfaced. Use the agent tab to widen authority or keep the current guardrails.',
      tab: 'agent',
      cta: 'Open agent controls',
      tone: 'monitor',
      focus: {
        tab: 'agent',
        kind: 'policy',
        id: 'monitor',
        label: 'Monitor mode',
        detail: 'Queue is steady. Review authority settings before expanding scope.',
      },
    });
  }

  return options.slice(0, 3);
}

function AceOperatorDeck({
  activeTab,
  onSelectOption,
  briefingSummary,
  queue,
  firstLaneLabel,
  workspaces,
  claimExceptions,
  eligibilityExceptions,
  claimItems,
  eligibilityItems,
  connectors,
  isLoading,
}: {
  activeTab: ActiveTab;
  onSelectOption: (option: AceSuggestedOption) => void;
  briefingSummary: string | null;
  queue: ManagerSnapshot['overview']['queue'] | undefined;
  firstLaneLabel: string | undefined;
  workspaces: Workspace[];
  claimExceptions: ClaimStatusException[];
  eligibilityExceptions: EligibilityException[];
  claimItems: ClaimStatusWorkItem[];
  eligibilityItems: EligibilityWorkItem[];
  connectors: Connector[];
  isLoading: boolean;
}) {
  const speak = useDashboardTts();
  const [speaking, setSpeaking] = useState(false);
  const options = buildAceSuggestedOptions({
    queue,
    workspaces,
    claimExceptions,
    eligibilityExceptions,
    claimItems,
    eligibilityItems,
    connectors,
  });

  const liveConnectorCount = connectors.filter((connector) => connector.status === 'live').length;
  const summary = briefingSummary
    ?? `${queue?.humanReviewCount ?? 0} items need operator review. ${queue?.autoClosedCount ?? 0} handled automatically. ${firstLaneLabel ?? 'Claim checks'} is the primary lane.`;

  async function playBriefing() {
    setSpeaking(true);
    await speak(summary);
    setTimeout(() => setSpeaking(false), 1800);
  }

  const toneStyles: Record<AceSuggestedOption['tone'], { border: string; bg: string; text: string }> = {
    critical: { border: 'rgba(244,63,94,0.24)', bg: 'rgba(244,63,94,0.08)', text: '#fb7185' },
    action: { border: 'rgba(16,185,129,0.2)', bg: 'rgba(16,185,129,0.05)', text: '#34d399' },
    monitor: { border: 'rgba(148,163,184,0.16)', bg: 'rgba(148,163,184,0.05)', text: '#cbd5e1' },
  };

  return (
    <section style={{ marginBottom: 18 }}>
      <div className="ace-operator-grid" style={{
        display: 'grid', gridTemplateColumns: '1.1fr 1fr 1.2fr', gap: 14,
        padding: 16, borderRadius: 16, border: '1px solid #161616', background: 'linear-gradient(180deg, rgba(8,8,8,0.96), rgba(5,5,5,0.98))',
      }}>
        <div style={{ padding: 16, borderRadius: 14, background: 'radial-gradient(circle at top, rgba(16,185,129,0.12), rgba(8,8,8,0.94) 58%)', border: '1px solid rgba(16,185,129,0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: speaking ? '#34d399' : '#10b981', boxShadow: speaking ? '0 0 18px rgba(52,211,153,0.45)' : '0 0 12px rgba(16,185,129,0.28)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#34d399', letterSpacing: '0.08em', textTransform: 'uppercase' }}>ACE operator unit</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ position: 'relative', width: 104, height: 104, flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(16,185,129,0.14)', transform: speaking ? 'scale(1.06)' : 'scale(1)', transition: 'transform 180ms ease' }} />
              <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), rgba(16,185,129,0.32) 35%, rgba(5,5,5,0.98) 75%)', border: '1px solid rgba(16,185,129,0.18)', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }} />
              <div style={{ position: 'absolute', left: 33, right: 33, top: 40, height: 7, borderRadius: 999, background: 'rgba(255,255,255,0.74)' }} />
              <div style={{ position: 'absolute', left: 28, right: 28, bottom: 26, height: speaking ? 18 : 8, borderRadius: 999, background: 'linear-gradient(180deg, rgba(16,185,129,0.95), rgba(5,5,5,0.95))', transition: 'height 180ms ease' }} />
            </div>

            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f5f5f5', letterSpacing: '-0.03em' }}>Ace is working like an operator, not a static dashboard.</div>
              <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6, marginTop: 8 }}>
                Useful next actions are surfaced automatically, with voice on top and queue state underneath. This is the closest grounded path to an OpenClaw-style unit using the billing product that already exists.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            {[
              `${queue?.humanReviewCount ?? 0} review`,
              `${queue?.openExceptionCount ?? 0} exceptions`,
              `${liveConnectorCount} live payers`,
            ].map((pill) => (
              <span key={pill} style={{ padding: '6px 10px', borderRadius: 999, fontSize: 11, color: '#b6c2be', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {pill}
              </span>
            ))}
          </div>
        </div>

        <div style={{ padding: 16, borderRadius: 14, background: '#090909', border: '1px solid #141414', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Voice briefing</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#ededed', marginTop: 4 }}>What Ace would say right now</div>
            </div>
            <button
              onClick={playBriefing}
              disabled={isLoading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(16,185,129,0.2)',
                background: speaking ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.06)', color: '#34d399',
                cursor: isLoading ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              <Volume2 size={14} />
              {speaking ? 'Speaking…' : 'Hear briefing'}
            </button>
          </div>

          <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid #141414', fontSize: 13, color: '#bdbdbd', lineHeight: 1.65, minHeight: 116 }}>
            {summary}
          </div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Primary lane', value: firstLaneLabel ?? 'Claim checks' },
              { label: 'Autonomous close rate', value: `${queue?.autoClosedPct ?? 0}%` },
              { label: 'Revenue protected', value: fmt$(queue?.amountAtRiskOpen) },
              { label: 'Practice count', value: String(workspaces.length) },
            ].map((item) => (
              <div key={item.label} style={{ padding: '10px 12px', borderRadius: 10, background: '#070707', border: '1px solid #111' }}>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#ececec', marginTop: 4 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: 16, borderRadius: 14, background: '#090909', border: '1px solid #141414' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Useful options</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#ededed', marginTop: 4 }}>Auto-surfaced next moves</div>
            </div>
            <Sparkles size={15} style={{ color: '#34d399' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {options.map((option) => {
              const tone = toneStyles[option.tone];
              const active = activeTab === option.tab;
              return (
                <button
                  key={option.id}
                  onClick={() => onSelectOption(option)}
                  style={{
                    textAlign: 'left', padding: '14px 14px 12px', borderRadius: 12,
                    border: `1px solid ${active ? tone.border : '#161616'}`,
                    background: active ? tone.bg : '#070707', cursor: 'pointer',
                    transition: 'all 140ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: tone.text, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{option.eyebrow}</span>
                    <ArrowRight size={13} style={{ color: active ? tone.text : '#555' }} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#efefef', marginTop: 6 }}>{option.title}</div>
                  <div style={{ fontSize: 12, color: '#8b8b8b', lineHeight: 1.55, marginTop: 6 }}>{option.detail}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: tone.text, marginTop: 10 }}>{option.cta}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Voice FAB ──────────────────────────────────────────────────────────────────

function OperatorFocusBanner({ focus }: { focus: OperatorFocus }) {
  return (
    <div style={{
      marginBottom: 14,
      padding: '12px 14px',
      borderRadius: 10,
      background: 'rgba(16,185,129,0.05)',
      border: '1px solid rgba(16,185,129,0.14)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#34d399', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Operator focus
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#ededed', marginTop: 5 }}>{focus.label}</div>
      <div style={{ fontSize: 12, color: '#7f8c88', lineHeight: 1.55, marginTop: 4 }}>{focus.detail}</div>
    </div>
  );
}

function VoiceFAB({
  onSwitchTab, autoClosedCount, autoClosedPct, trustScore, briefingSummary,
}: {
  onSwitchTab: (t: ActiveTab) => void;
  autoClosedCount: number;
  autoClosedPct: number;
  trustScore: number;
  briefingSummary: string | null;
}) {
  const [listening, setListening] = useState(false);
  const [label, setLabel] = useState('');
  const recRef = useRef<{ stop: () => void } | null>(null);
  const speak = useDashboardTts();

  const handle = useCallback((text: string) => {
    const t = text.toLowerCase();
    let hint = '';
    let reply = '';

    if (t.includes('brief') || t.includes('what needs') || t.includes('morning update')) {
      reply = briefingSummary ?? `${autoClosedCount} items auto-resolved. ${autoClosedCount > 0 ? 'Queue is moving.' : 'Queue is clear.'}`;
      hint = "Briefing";
    } else if (t.includes('claim') || t.includes('denial')) {
      onSwitchTab('claims'); reply = "Showing claim checks."; hint = "Claim checks";
    } else if (t.includes('eligib') || t.includes('coverage')) {
      onSwitchTab('eligibility'); reply = "Showing coverage checks."; hint = "Coverage checks";
    } else if (t.includes('connector') || t.includes('payer')) {
      onSwitchTab('connectors'); reply = "Showing payer network."; hint = "Payer network";
    } else if (t.includes('practice') || t.includes('workspace')) {
      onSwitchTab('workspaces'); reply = "Showing practices."; hint = "Practices";
    } else if (t.includes('agent') || t.includes('authority')) {
      onSwitchTab('agent'); reply = "Showing agent authority."; hint = "Agent authority";
    } else if (t.includes('resolved') || t.includes('handled') || t.includes('how many')) {
      reply = `Ace has auto-resolved ${autoClosedCount} items — ${autoClosedPct} percent this period.`;
      hint = `${autoClosedCount} items, ${autoClosedPct}% auto`;
    } else if (t.includes('trust') || t.includes('score')) {
      reply = `Your billing agent trust score is ${trustScore} out of 100.`;
      hint = `Trust score: ${trustScore}/100`;
    } else {
      reply = "Try: show claims, how many resolved, or trust score.";
      hint = "Try again";
    }

    speak(reply);
    setLabel(hint);
    setTimeout(() => setLabel(''), 4000);
  }, [autoClosedCount, autoClosedPct, trustScore, onSwitchTab, speak]);

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    if (!SR) { speak("Voice commands require Chrome or Safari."); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new SR() as any;
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => handle(e.results[0][0].transcript as string);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <div className="ace-voice-fab" style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      {label && (
        <div style={{
          padding: '7px 13px', borderRadius: 8, fontSize: 12, color: '#34d399',
          background: '#0d0d0d', border: '1px solid rgba(16,185,129,0.15)',
          maxWidth: 200, textAlign: 'right',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {label}
        </div>
      )}
      <button
        onClick={toggle}
        title={listening ? 'Stop' : 'Talk to Ace'}
        style={{
          width: 50, height: 50, borderRadius: '50%', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: listening ? '#10b981' : '#111',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: listening ? 'ace-pulse 1.4s ease-in-out infinite' : 'none',
          transition: 'background 0.2s',
        }}
      >
        {listening
          ? <MicOff size={18} style={{ color: '#000' }} />
          : <Mic size={18} style={{ color: '#444' }} />
        }
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RcmManagerClient() {
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('claims');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [operatorFocus, setOperatorFocus] = useState<OperatorFocus | null>(null);
  const [policy, setPolicy] = useState<ApprovalPolicy>(DEFAULT_POLICY);
  const [policyInit, setPolicyInit] = useState(false);
  const [appealWorkItemId, setAppealWorkItemId] = useState<string | null>(null);
  const [appealText, setAppealText] = useState<string | null>(null);
  const [appealLoading, setAppealLoading] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [connectTarget, setConnectTarget] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-manager'],
    queryFn: fetchRcmManagerSnapshot,
    refetchInterval: 30_000,
  });

  const { data: briefingData, isLoading: briefingLoading } = useQuery<BriefingData>({
    queryKey: ['rcm-briefing'],
    queryFn: async () => {
      const res = await fetch('/api/rcm/daily-briefing');
      if (!res.ok) return { fallback: true, summary: 'Briefing temporarily unavailable.' };
      return res.json();
    },
    staleTime: 3_600_000,
    retry: false,
  });

  const primaryWorkspaceId = data?.workspaces.items[0]?.workspaceId ?? null;

  const { data: credentialsData, refetch: refetchCredentials } = useQuery<StoredCredential[]>({
    queryKey: ['rcm-credentials', primaryWorkspaceId],
    queryFn: () => primaryWorkspaceId ? fetchCredentials(primaryWorkspaceId) : Promise.resolve([]),
    staleTime: 60_000,
    retry: false,
    enabled: activeTab === 'connectors' && !!primaryWorkspaceId,
  });

  const { data: payerIntelData, isLoading: payerIntelLoading } = useQuery<PayerIntelData>({
    queryKey: ['rcm-payer-intel'],
    queryFn: async () => {
      const res = await fetch('/api/rcm/payer-intelligence');
      if (!res.ok) return { payers: [] };
      return res.json();
    },
    staleTime: 900_000,
    retry: false,
    enabled: activeTab === 'connectors',
  });

  useEffect(() => {
    if (policyInit || !data) return;
    const ws = data.workspaces.items[0];
    if (ws) setPolicy(hydratePolicy(ws.workspaceId, ws.approvalPolicy));
    setPolicyInit(true);
  }, [data, policyInit]);

  const actionMutation = useMutation({
    mutationFn: runManagerAction,
    onMutate: (p) => { setFlash(null); setActiveActionKey(actionKey(p)); },
    onSuccess: (r) => {
      setFlash({ tone: 'ok', msg: r.message ?? 'Action completed.' });
      queryClient.invalidateQueries({ queryKey: ['rcm-manager'] });
      queryClient.invalidateQueries({ queryKey: ['rcm-briefing'] });
    },
    onError: (e: Error) => setFlash({ tone: 'err', msg: e.message }),
    onSettled: () => setActiveActionKey(null),
  });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  function trigger(p: ManagerActionRequest) { actionMutation.mutate(p); }
  function isPending(p: ManagerActionRequest) { return activeActionKey === actionKey(p); }

  function switchTab(tab: ActiveTab) {
    setOperatorFocus(null);
    setExpandedItem(null);
    setActiveTab(tab);
  }

  function handleOperatorOption(option: AceSuggestedOption) {
    setActiveTab(option.tab);
    setOperatorFocus(option.focus ?? null);
    setExpandedItem(option.focus?.kind === 'work-item' ? option.focus.id : null);
  }

  async function handleRevoke(credentialId: string, payerName: string) {
    await deleteCredential(credentialId);
    refetchCredentials();
    setFlash({ tone: 'ok', msg: `${payerName} disconnected.` });
  }

  async function handleAppeal(workItemId: string) {
    setAppealWorkItemId(workItemId);
    setAppealText(null);
    setAppealError(null);
    setAppealLoading(true);
    const result = await fetchAppeal(workItemId);
    setAppealLoading(false);
    if (result.error) setAppealError(result.error);
    else setAppealText(result.appeal ?? null);
  }

  function closeAppeal() {
    setAppealWorkItemId(null);
    setAppealText(null);
    setAppealError(null);
  }

  const q = data?.overview.queue;
  const workspaces = data?.workspaces.items ?? [];
  const workItems = data?.workItems.items ?? [];
  const exceptions = data?.exceptions.items ?? [];
  const connectors = data?.connectors.connectors ?? [];
  const eligWI = data?.eligibilityWorkItems?.items ?? [];
  const eligEx = data?.eligibilityExceptions?.items ?? [];
  const eligCon = data?.eligibilityConnectors?.connectors ?? [];

  const conf = q?.avgConfidencePct ?? 70;
  const trustScore = Math.round((q?.autoClosedPct ?? 0) * 0.5 + conf * 0.3 + (100 - (q?.humanInterventionPct ?? 0)) * 0.2);

  const kpis = [
    {
      label: 'In progress',
      value: isLoading ? '—' : String(q?.totalOpen ?? 0),
      sub: isLoading ? '' : `${q?.totalWorkItems ?? 0} total`,
      icon: Layers, accent: '#38bdf8',
    },
    {
      label: 'Ace auto-closed',
      value: isLoading ? '—' : `${q?.autoClosedPct ?? 0}%`,
      sub: isLoading ? '' : `${q?.autoClosedCount ?? 0} items`,
      icon: CheckCircle2, accent: '#10b981',
    },
    {
      label: 'Revenue protected',
      value: isLoading ? '—' : fmt$(q?.amountAtRiskOpen),
      sub: isLoading ? '' : `${data?.workspaces.count ?? 0} practices`,
      icon: DollarSign, accent: '#8b5cf6',
    },
    {
      label: 'Need attention',
      value: isLoading ? '—' : String(q?.openExceptionCount ?? 0),
      sub: isLoading ? '' : (q?.highSeverityExceptionCount ? `${q.highSeverityExceptionCount} critical` : 'none critical'),
      icon: AlertTriangle,
      accent: (q?.openExceptionCount ?? 0) > 0 ? '#f43f5e' : '#3a3a3a',
    },
  ];

  const TABS: { id: ActiveTab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'claims', label: 'Claim checks', icon: Layers, count: workItems.length || undefined },
    { id: 'eligibility', label: 'Coverage checks', icon: Shield, count: eligWI.length || undefined },
    { id: 'connectors', label: 'Connectors', icon: Cpu },
    { id: 'workspaces', label: 'Practices', icon: Building2, count: workspaces.length || undefined },
    { id: 'agent', label: 'Agent', icon: Bot },
  ];

  if (isError) {
    return (
      <div style={{ padding: 28, borderRadius: 10, background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.15)', color: '#fb7185', fontSize: 14 }}>
        Could not load billing dashboard. Check API connectivity.
      </div>
    );
  }

  const renderLane = (tab: 'claims' | 'eligibility') => {
    const isClaims = tab === 'claims';
    const lane: Lane = isClaims ? 'claim-status' : 'eligibility';
    const items = isClaims ? workItems : eligWI;
    const exItems = isClaims ? exceptions : eligEx;
    const queueErr = isClaims
      ? data?.panelStatus.claimStatusWorkItems === 'error'
      : data?.panelStatus.eligibilityWorkItems === 'error';
    const exErr = isClaims
      ? data?.panelStatus.claimStatusExceptions === 'error'
      : data?.panelStatus.eligibilityExceptions === 'error';
    const protocol = isClaims ? 'X12 276/277' : 'HETS 270/271';

    return (
      <div className="ace-lane-grid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 16, alignItems: 'start' }}>
        <div>
          {operatorFocus?.tab === tab && <OperatorFocusBanner focus={operatorFocus} />}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Work queue
            </span>
            <span style={{ fontSize: 10, color: '#2a2a2a', fontFamily: 'monospace', letterSpacing: '0.05em' }}>{protocol}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {queueErr && <WarnBanner text="Queue temporarily unavailable — not a clear-queue signal." />}
            {!queueErr && !isLoading && items.length === 0 && <EmptyState text="Queue is clear" />}
            {!queueErr && items.map(item => (
              <WorkItemRow
                key={item.workItemId}
                lane={lane}
                item={item}
                expandedId={expandedItem}
                highlighted={operatorFocus?.tab === tab && operatorFocus.kind === 'work-item' && operatorFocus.id === item.workItemId}
                onExpand={setExpandedItem}
                checkPending={isPending}
                onAction={trigger}
              />
            ))}
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Needs your attention
            </span>
            {exItems.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#fb7185' }}>{exItems.length} open</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {exErr && <WarnBanner text="Exception panel temporarily unavailable." />}
            {!exErr && !isLoading && exItems.length === 0 && <EmptyState text="No open exceptions" />}
            {!exErr && exItems.map(item => (
              <ExceptionCard
                key={item.exceptionId}
                lane={lane}
                item={item}
                highlighted={operatorFocus?.tab === tab && operatorFocus.kind === 'exception' && operatorFocus.id === item.exceptionId}
                checkPending={isPending}
                onAction={trigger}
                onAppeal={handleAppeal}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        @media (max-width: 1180px) {
          .ace-operator-grid { grid-template-columns: 1fr !important; }
          .ace-lane-grid { grid-template-columns: 1fr !important; }
          .ace-agent-console-grid { grid-template-columns: 1fr !important; }
          .ace-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }

        @media (max-width: 860px) {
          .ace-kpi-grid { grid-template-columns: 1fr !important; }
          .ace-tab-bar { width: 100% !important; flex-wrap: wrap; }
        }

        @media (max-width: 640px) {
          .ace-voice-fab { right: 18px !important; bottom: 18px !important; }
        }
      `}</style>

      {/* Flash toast */}
      {flash && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: flash.tone === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.08)',
          border: `1px solid ${flash.tone === 'ok' ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.2)'}`,
          color: flash.tone === 'ok' ? '#34d399' : '#fb7185',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {flash.msg}
        </div>
      )}

      {/* Partial-load warning */}
      {data?.partial && data.warnings.length > 0 && (
        <WarnBanner
          text={`Some panels are temporarily unavailable: ${data.warnings.join(' · ')}`}
          style={{ marginBottom: 20 }}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#e8e8e8', letterSpacing: '-0.02em' }}>
              Ace operator console
            </h1>
          </div>
          <p style={{ margin: '3px 0 0 16px', fontSize: 11, color: '#444' }}>
            Voice-first billing unit with auto-surfaced next actions · refreshes every 30s
          </p>
        </div>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#444' }}>
            <Loader2 size={12} className="animate-spin" />
            Loading
          </div>
        )}
      </div>

      <AceOperatorDeck
        activeTab={activeTab}
        onSelectOption={handleOperatorOption}
        briefingSummary={briefingData?.summary ?? null}
        queue={q}
        firstLaneLabel={data?.overview.firstLane.label}
        workspaces={workspaces}
        claimExceptions={exceptions}
        eligibilityExceptions={eligEx}
        claimItems={workItems}
        eligibilityItems={eligWI}
        connectors={[...connectors, ...eligCon]}
        isLoading={isLoading}
      />

      {/* Onboarding checklist — hides itself once all four steps are done */}
      {(() => {
        const ws = workspaces[0] ?? null;
        const hasConnector = (credentialsData ?? []).length > 0 || connectors.some((c: Connector) => c.status === 'live');
        const hasFirstClaim = (workItems?.length ?? 0) > 0 || (eligWI?.length ?? 0) > 0;
        return (
          <OnboardingChecklist
            workspace={ws ? { workspaceId: ws.workspaceId, name: ws.name, workspaceType: ws.workspaceType } : null}
            hasConnector={hasConnector}
            hasFirstClaim={hasFirstClaim}
            onJumpToConnectors={() => switchTab('connectors')}
            onRunDemo={async () => {
              if (!ws) return;
              try {
                const res = await fetch(`/api/rcm/workspaces/${ws.workspaceId}/demo-claim`, { method: 'POST' });
                if (res.ok) {
                  setFlash({ tone: 'ok', msg: 'Demo claim queued. Watch the claims tab.' });
                  switchTab('claims');
                  queryClient.invalidateQueries({ queryKey: ['rcm-manager'] });
                } else {
                  const d = await res.json().catch(() => ({})) as { error?: string };
                  setFlash({ tone: 'err', msg: d.error ?? 'Could not queue demo claim.' });
                }
              } catch {
                setFlash({ tone: 'err', msg: 'Network error queueing demo claim.' });
              }
            }}
          />
        );
      })()}

      {/* KPI strip */}
      <div className="ace-kpi-grid" style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        marginBottom: 16, borderRadius: 12,
        border: '1px solid #161616', background: '#080808', overflow: 'hidden',
      }}>
        {kpis.map((kpi, i) => (
          <div key={kpi.label} style={{ padding: '18px 22px', borderRight: i < 3 ? '1px solid #161616' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {kpi.label}
              </span>
              <kpi.icon size={13} style={{ color: kpi.accent }} />
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#e8e8e8', letterSpacing: '-0.03em', lineHeight: 1 }}>
              {kpi.value}
            </div>
            <div style={{ fontSize: 11, color: '#444', marginTop: 5 }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Briefing strip */}
      <BriefingStrip
        briefing={briefingData}
        briefingLoading={briefingLoading}
        humanReviewCount={q?.humanReviewCount ?? 0}
        autoCount={q?.autoClosedCount ?? 0}
        autoClosedPct={q?.autoClosedPct ?? 0}
        snapshotLoading={isLoading}
        onReview={() => switchTab('claims')}
      />

      {/* Tab bar */}
      <div className="ace-tab-bar" style={{
        display: 'flex', gap: 3, marginBottom: 18,
        padding: 4, background: '#080808', borderRadius: 10,
        border: '1px solid #161616', width: 'fit-content',
      }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '7px 13px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: active ? '#0f0f0f' : 'transparent',
                color: active ? '#e0e0e0' : '#555',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
              }}
            >
              <tab.icon size={12} />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 18, height: 18, borderRadius: 9, padding: '0 4px',
                  fontSize: 10, fontWeight: 700,
                  background: active ? '#10b981' : '#1a1a1a',
                  color: active ? '#000' : '#777',
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {(activeTab === 'claims' || activeTab === 'eligibility') && renderLane(activeTab)}

      {activeTab === 'connectors' && (
        <>
          {operatorFocus?.tab === 'connectors' && <OperatorFocusBanner focus={operatorFocus} />}
          <ConnectorGrid
            connectors={[...connectors, ...eligCon]}
            claimErr={data?.panelStatus.claimStatusConnectors === 'error'}
            eligErr={data?.panelStatus.eligibilityConnectors === 'error'}
            isLoading={isLoading}
            credentials={credentialsData ?? []}
            onConnect={setConnectTarget}
            onRevoke={handleRevoke}
          />
          <PayerIntelligence data={payerIntelData} loading={payerIntelLoading} />
        </>
      )}

      {activeTab === 'workspaces' && (
        <>
          {operatorFocus?.tab === 'workspaces' && <OperatorFocusBanner focus={operatorFocus} />}
          <WorkspaceGrid
            workspaces={workspaces}
            unavailable={data?.panelStatus.workspaces === 'error'}
            isLoading={isLoading}
            highlightedWorkspaceId={operatorFocus?.tab === 'workspaces' && operatorFocus.kind === 'workspace' ? operatorFocus.id : null}
          />
        </>
      )}

      {activeTab === 'agent' && (
        <>
          {operatorFocus?.tab === 'agent' && <OperatorFocusBanner focus={operatorFocus} />}
          <AgentConsole
            workspace={workspaces[0] ?? null}
            policy={policy}
            onPolicyChange={setPolicy}
            autoClosedPct={q?.autoClosedPct ?? 0}
            avgConfidencePct={q?.avgConfidencePct ?? null}
            humanInterventionPct={q?.humanInterventionPct ?? 0}
            autoClosedCount={q?.autoClosedCount ?? 0}
            isLoading={isLoading}
          />
        </>
      )}

      {/* Connect credential modal */}
      {connectTarget && primaryWorkspaceId && (
        <ConnectModal
          payerName={connectTarget}
          workspaceId={primaryWorkspaceId}
          onSuccess={() => { setConnectTarget(null); refetchCredentials(); setFlash({ tone: 'ok', msg: `${connectTarget} connected.` }); }}
          onClose={() => setConnectTarget(null)}
        />
      )}

      {/* Appeal modal */}
      {appealWorkItemId && (
        <AppealModal
          text={appealText}
          loading={appealLoading}
          error={appealError}
          onClose={closeAppeal}
        />
      )}

      {/* Voice FAB */}
      <VoiceFAB
        onSwitchTab={switchTab}
        autoClosedCount={q?.autoClosedCount ?? 0}
        autoClosedPct={q?.autoClosedPct ?? 0}
        trustScore={trustScore}
        briefingSummary={briefingData?.summary ?? null}
      />

    </div>
  );
}
