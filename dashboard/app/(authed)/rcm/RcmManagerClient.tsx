'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
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
  Zap,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelState = 'ok' | 'error';
type Lane = 'claim-status' | 'eligibility' | 'denial-follow-up' | 'prior-auth' | 'era-835' | 'charge-capture' | 'drg-review';
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

type TeamMember = { id: string; name: string; email: string; createdAt: string };
type ImportRow = { title?: string; payerName?: string; claimRef?: string; patientRef?: string; providerRef?: string; amountAtRisk?: string; priority?: string; dueAt?: string };

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

async function fetchTeamMembers(): Promise<TeamMember[]> {
  const res = await fetch('/api/rcm/team');
  if (!res.ok) return [];
  const data = await res.json() as { members?: TeamMember[] };
  return data.members ?? [];
}

async function inviteTeamMember(payload: { email: string; role: string }): Promise<{ ok?: boolean; inviteUrl?: string; error?: string }> {
  const res = await fetch('/api/rcm/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({ error: 'Failed' }));
}

async function removeTeamMember(id: string): Promise<void> {
  await fetch(`/api/rcm/team/${id}`, { method: 'DELETE' });
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

  const isFallback = !briefing || briefing.fallback;
  const actionableFallback = snapshotLoading ? null
    : humanReviewCount > 0
      ? `${humanReviewCount} item${humanReviewCount !== 1 ? 's' : ''} need your attention today.`
      : 'No urgent items — Ace is running smoothly.';

  const displayText = isFallback ? (actionableFallback ?? fallbackText) : (briefing?.summary ?? fallbackText);

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
  onExpand: (id: string | null) => void;
  checkPending: (p: ManagerActionRequest) => boolean;
  onAction: (p: ManagerActionRequest) => void;
};

function WorkItemRow({ lane, item, expandedId, onExpand, checkPending, onAction }: WorkItemRowProps) {
  const expanded = expandedId === item.workItemId;
  const actions = workItemActions(lane, item);
  const accent = priorityAccent(item.priority);
  const ref = lane === 'claim-status'
    ? (item as ClaimStatusWorkItem).claimRef
    : (item as EligibilityWorkItem).memberId;

  return (
    <div style={{ borderRadius: 10, background: '#080808', border: '1px solid #161616', overflow: 'hidden' }}>
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
  checkPending: (p: ManagerActionRequest) => boolean;
  onAction: (p: ManagerActionRequest) => void;
  onAppeal?: (workItemId: string) => void;
};

function ExceptionCard({ lane, item, checkPending, onAction, onAppeal }: ExceptionCardProps) {
  const actions = exceptionActions(lane, item);
  const { bg, border, text } = severityStyle(item.severity);
  const ref = lane === 'claim-status'
    ? (item as ClaimStatusException).claimRef
    : (item as EligibilityException).memberId;

  return (
    <div style={{ borderRadius: 10, background: bg, border: `1px solid ${border}`, padding: '14px 16px' }}>
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

const CONNECTOR_STATUS_LABELS: Record<string, string> = {
  live: 'Live',
  simulation: 'AI\u2011assisted',
  manual_fallback: 'Manual queue',
};

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
            {simCount} AI\u2011assisted — direct API connection coming
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
            <span style={{ color: '#34d399', fontWeight: 600 }}>{liveCount} live</span>
            {' '}payer{liveCount !== 1 ? 's' : ''} — claims process via direct API.
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
          const statusLabel = CONNECTOR_STATUS_LABELS[c.status] ?? c.status;
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
  workspaces, unavailable, isLoading,
}: {
  workspaces: Workspace[];
  unavailable: boolean;
  isLoading: boolean;
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
            <div key={ws.workspaceId} style={{ padding: '16px', borderRadius: 10, background: '#080808', border: '1px solid #161616' }}>
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, alignItems: 'start' }}>

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

// ── Team section (inside Agent tab) ──────────────────────────────────────────

function TeamSection({ activeTab }: { activeTab: ActiveTab }) {
  const [expanded, setExpanded] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: members, isLoading: membersLoading, refetch: refetchMembers } = useQuery<TeamMember[]>({
    queryKey: ['rcm-team'],
    queryFn: fetchTeamMembers,
    enabled: activeTab === 'agent' && expanded,
    staleTime: 60_000,
  });

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    setInviteUrl(null);
    const result = await inviteTeamMember({ email: inviteEmail.trim(), role: inviteRole });
    setInviting(false);
    if (result.error) {
      setInviteError(result.error);
    } else {
      setInviteUrl(result.inviteUrl ?? null);
      setInvitedEmail(inviteEmail.trim());
      setInviteEmail('');
      refetchMembers();
    }
  }

  async function handleRemove(id: string) {
    await removeTeamMember(id);
    refetchMembers();
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const inputStyle: React.CSSProperties = {
    background: '#0d0d0d', border: '1px solid #1c1c1c',
    borderRadius: 8, color: '#ededef', fontSize: 13, padding: '10px 12px',
    outline: 'none', fontFamily: 'Inter, system-ui, sans-serif',
  };

  return (
    <div style={{ marginTop: 20, borderTop: '1px solid #111', paddingTop: 16 }}>
      <button
        onClick={() => setExpanded(x => !x)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Team
        </span>
        <ChevronDown
          size={13}
          style={{ color: '#333', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}
        />
      </button>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {/* Members list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {membersLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[1, 2].map(n => (
                  <div key={n} style={{ height: 40, borderRadius: 8, background: '#0d0d0d', animation: 'shimmer 1.4s ease-in-out infinite' }} />
                ))}
              </div>
            )}
            {!membersLoading && (members ?? []).length === 0 && (
              <EmptyState text="No team members yet." />
            )}
            {!membersLoading && (members ?? []).map(m => {
              const initials = m.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 8, background: '#080808', border: '1px solid #161616',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: '#94a3b8',
                  }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.email} · Joined {fmtDate(m.createdAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(m.id)}
                    style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px', borderRadius: 4 }}
                    title="Remove member"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {/* Invite form */}
          <div style={{ padding: '16px', borderRadius: 10, background: '#080808', border: '1px solid #161616' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
              Invite a team member
            </div>
            <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                  required
                />
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  style={{ ...inputStyle, paddingRight: 10, cursor: 'pointer' }}
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              {inviteError && <div style={{ fontSize: 12, color: '#fb7185' }}>{inviteError}</div>}
              <button
                type="submit"
                disabled={inviting}
                style={{
                  padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: inviting ? '#059669' : '#10b981', color: '#000',
                  border: 'none', cursor: inviting ? 'not-allowed' : 'pointer', opacity: inviting ? 0.8 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {inviting && <Loader2 size={12} className="animate-spin" />}
                {inviting ? 'Sending…' : 'Send invite →'}
              </button>
            </form>

            {inviteUrl && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
                  Share this link with {invitedEmail}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    readOnly
                    value={inviteUrl}
                    style={{ ...inputStyle, flex: 1, fontSize: 11, color: '#94a3b8' }}
                  />
                  <button
                    onClick={copyLink}
                    style={{
                      padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, flexShrink: 0,
                      background: copied ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${copied ? 'rgba(16,185,129,0.25)' : '#1c1c1c'}`,
                      color: copied ? '#34d399' : '#888', cursor: 'pointer',
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────

function parseImportCsv(raw: string): ImportRow[] {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const normalise = (h: string): keyof ImportRow | null => {
    if (h === 'title') return 'title';
    if (h === 'payer_name' || h === 'payername') return 'payerName';
    if (h === 'claim_ref' || h === 'claimref') return 'claimRef';
    if (h === 'patient_ref' || h === 'patientref') return 'patientRef';
    if (h === 'provider_ref' || h === 'providerref') return 'providerRef';
    if (h === 'amount_at_risk' || h === 'amountatrisk') return 'amountAtRisk';
    if (h === 'priority') return 'priority';
    if (h === 'due_at' || h === 'dueat') return 'dueAt';
    return null;
  };

  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const row: ImportRow = {};
    headers.forEach((h, i) => {
      const key = normalise(h);
      if (key) (row as Record<string, string>)[key] = cells[i] ?? '';
    });
    return row;
  });
}

function ImportModal({
  workspaceId,
  onDone,
  onClose,
}: {
  workspaceId: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'pick' | 'preview' | 'result'>('pick');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [resultError, setResultError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const validRows = rows.filter(r => r.title?.trim());
  const skippedCount = rows.length - validRows.length;

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const parsed = parseImportCsv(text);
      setRows(parsed);
      setStep('preview');
    };
    reader.readAsText(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function runImport() {
    if (!workspaceId) { setResultError('No workspace found.'); setStep('result'); return; }
    setImporting(true);
    setStep('result');
    try {
      const res = await fetch('/api/rcm/import-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, claims: validRows }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string; error?: string };
      if (!res.ok) {
        setResultError(data.error ?? 'Import failed.');
      } else {
        setResultMsg(data.message ?? `Imported ${validRows.length} claim${validRows.length !== 1 ? 's' : ''} successfully.`);
      }
    } catch {
      setResultError('Network error — import failed.');
    } finally {
      setImporting(false);
    }
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
        style={{ width: '100%', maxWidth: 580, background: '#0a0a0a', border: '1px solid #1c1c1c', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #141414', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ededef' }}>Import claims</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
              {step === 'pick' ? 'Upload a CSV file' : step === 'preview' ? 'Review before importing' : 'Import complete'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Step 1 — file picker */}
          {step === 'pick' && (
            <div>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? '#10b981' : '#1e293b'}`,
                  borderRadius: 12, padding: '40px 24px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'border-color 0.15s',
                  background: dragging ? 'rgba(16,185,129,0.03)' : 'transparent',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>
                  Drop a CSV file here or click to browse
                </div>
                <div style={{ fontSize: 11, color: '#333', marginTop: 6 }}>
                  Expected columns: title, payer_name, claim_ref, amount_at_risk, priority, due_at
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onInputChange} />
            </div>
          )}

          {/* Step 2 — preview */}
          {step === 'preview' && (
            <div>
              <div style={{ marginBottom: 12, fontSize: 12, color: '#94a3b8' }}>
                {skippedCount > 0
                  ? `${rows.length} claims, ${skippedCount} will be skipped — missing title`
                  : `${validRows.length} claim${validRows.length !== 1 ? 's' : ''} ready to import`}
              </div>
              <div style={{ borderRadius: 8, border: '1px solid #141414', overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1fr', padding: '7px 12px', background: '#090909', borderBottom: '1px solid #141414' }}>
                  {['Title', 'Payer', 'Amount', 'Priority'].map(h => (
                    <span key={h} style={{ fontSize: 10, fontWeight: 600, color: '#333', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
                  ))}
                </div>
                {rows.slice(0, 5).map((row, i) => {
                  const invalid = !row.title?.trim();
                  return (
                    <div key={i} style={{
                      display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1fr',
                      padding: '8px 12px',
                      background: invalid ? 'rgba(244,63,94,0.05)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      borderBottom: i < Math.min(rows.length, 5) - 1 ? '1px solid #0f0f0f' : 'none',
                    }}>
                      <span style={{ fontSize: 12, color: invalid ? '#fb7185' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.title?.trim() || <em style={{ color: '#555' }}>missing title</em>}
                      </span>
                      <span style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.payerName || '—'}</span>
                      <span style={{ fontSize: 12, color: '#555' }}>{row.amountAtRisk || '—'}</span>
                      <span style={{ fontSize: 12, color: '#555' }}>{row.priority || '—'}</span>
                    </div>
                  );
                })}
                {rows.length > 5 && (
                  <div style={{ padding: '7px 12px', fontSize: 11, color: '#333' }}>
                    +{rows.length - 5} more rows not shown
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setStep('pick'); setRows([]); }}
                  style={{ padding: '10px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid #1c1c1c', color: '#555', cursor: 'pointer' }}
                >
                  Back
                </button>
                <button
                  onClick={runImport}
                  disabled={validRows.length === 0}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    background: validRows.length === 0 ? '#111' : '#10b981', color: validRows.length === 0 ? '#333' : '#000',
                    border: 'none', cursor: validRows.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  Import {validRows.length} claim{validRows.length !== 1 ? 's' : ''} →
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — result */}
          {step === 'result' && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              {importing ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#555', fontSize: 13 }}>
                  <Loader2 size={14} className="animate-spin" />
                  Importing…
                </div>
              ) : resultError ? (
                <div>
                  <div style={{ fontSize: 13, color: '#fb7185', marginBottom: 16 }}>{resultError}</div>
                  <button onClick={onClose} style={inputStyle as React.CSSProperties}>Dismiss</button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, color: '#34d399', marginBottom: 16 }}>{resultMsg}</div>
                  <button
                    onClick={onDone}
                    style={{ padding: '10px 24px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399', cursor: 'pointer' }}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          )}
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
              <>
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
                <a
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(text ?? '')}`}
                  download="appeal-letter.txt"
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid #1c1c1c',
                    color: '#888', textDecoration: 'none', cursor: 'pointer',
                  }}
                >
                  Download .txt
                </a>
              </>
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

// ── Voice FAB ──────────────────────────────────────────────────────────────────

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
    <div style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
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
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('claims');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [policy, setPolicy] = useState<ApprovalPolicy>(DEFAULT_POLICY);
  const [policyInit, setPolicyInit] = useState(false);
  const [appealWorkItemId, setAppealWorkItemId] = useState<string | null>(null);
  const [appealText, setAppealText] = useState<string | null>(null);
  const [appealLoading, setAppealLoading] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [connectTarget, setConnectTarget] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showExpiryBanner, setShowExpiryBanner] = useState(false);

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
      setToastMsg(r.message ?? 'Action completed.');
      queryClient.invalidateQueries({ queryKey: ['rcm-manager'] });
      queryClient.invalidateQueries({ queryKey: ['rcm-briefing'] });
    },
    onError: (e: Error) => setToastMsg(e.message),
    onSettled: () => setActiveActionKey(null),
  });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then((d: { sessionExpiresAt?: number } | null) => {
        if (!d?.sessionExpiresAt) return;
        const msRemaining = d.sessionExpiresAt * 1000 - Date.now();
        const WARN_MS = 30 * 60 * 1000;
        if (msRemaining < WARN_MS) {
          setShowExpiryBanner(true);
        } else {
          t = setTimeout(() => setShowExpiryBanner(true), msRemaining - WARN_MS);
        }
      })
      .catch(() => {});
    return () => { if (t !== undefined) clearTimeout(t); };
  }, []);

  function trigger(p: ManagerActionRequest) { actionMutation.mutate(p); }
  function isPending(p: ManagerActionRequest) { return activeActionKey === actionKey(p); }

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

    const showFreshState = !isLoading && !queueErr && !exErr && items.length === 0 && exItems.length === 0;

    if (showFreshState) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '56px 24px', borderRadius: 14,
          background: '#080808', border: '1px dashed #1e293b', textAlign: 'center',
        }}>
          <Zap size={28} style={{ color: '#1e293b', marginBottom: 16 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#3a3a3a', marginBottom: 8 }}>
            Ace is ready. No claims yet.
          </div>
          <div style={{ fontSize: 12, color: '#2a2a2a', maxWidth: 360, lineHeight: 1.7, marginBottom: 20 }}>
            Connect a payer credential in the Connectors tab to start. Ace will begin monitoring claims automatically.
          </div>
          <button
            onClick={() => setActiveTab('connectors')}
            style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
              color: '#34d399', cursor: 'pointer',
            }}
          >
            Go to Connectors →
          </button>
        </div>
      );
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 16, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Work queue
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isClaims && (
                <button
                  onClick={() => setImportOpen(true)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.18)',
                    color: '#34d399', cursor: 'pointer',
                  }}
                >
                  + Import claims
                </button>
              )}
              <span style={{ fontSize: 10, color: '#2a2a2a', fontFamily: 'monospace', letterSpacing: '0.05em' }}>{protocol}</span>
            </div>
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

      {/* Session expiry warning */}
      {showExpiryBanner && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)',
          borderRadius: 8, padding: '12px 24px', marginBottom: 16,
          fontSize: 13, color: '#fbbf24', gap: 12,
        }}>
          <span>Your session expires soon — sign in again to stay connected.</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <a href="/rcm-login" style={{ color: '#fbbf24', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Sign in again →
            </a>
            <button
              onClick={() => setShowExpiryBanner(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fbbf24', padding: 0, lineHeight: 1, fontSize: 16 }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

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

      {/* Action snackbar (bottom-center) */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
          padding: '12px 20px', color: '#f8fafc', fontSize: 13, zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {toastMsg}
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
              Billing operations
            </h1>
          </div>
          <p style={{ margin: '3px 0 0 16px', fontSize: 11, color: '#444' }}>
            Ace is working the queue · auto-refreshes every 30s
          </p>
        </div>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#444' }}>
            <Loader2 size={12} className="animate-spin" />
            Loading
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div style={{
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
        onReview={() => setActiveTab('claims')}
      />

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 3, marginBottom: 18,
        padding: 4, background: '#080808', borderRadius: 10,
        border: '1px solid #161616', width: 'fit-content',
      }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
        <WorkspaceGrid
          workspaces={workspaces}
          unavailable={data?.panelStatus.workspaces === 'error'}
          isLoading={isLoading}
        />
      )}

      {activeTab === 'agent' && (
        <>
          <AgentConsole
            workspace={workspaces[0] ?? null}
            policy={policy}
            onPolicyChange={(p) => {
              setPolicy(p);
              if (workspaces[0]) persistPolicy(workspaces[0].workspaceId, p);
            }}
            autoClosedPct={q?.autoClosedPct ?? 0}
            avgConfidencePct={q?.avgConfidencePct ?? null}
            humanInterventionPct={q?.humanInterventionPct ?? 0}
            autoClosedCount={q?.autoClosedCount ?? 0}
            isLoading={isLoading}
          />
          <TeamSection activeTab={activeTab} />
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

      {/* Import claims modal */}
      {importOpen && (
        <ImportModal
          workspaceId={primaryWorkspaceId}
          onDone={() => { setImportOpen(false); queryClient.invalidateQueries({ queryKey: ['rcm-manager'] }); }}
          onClose={() => setImportOpen(false)}
        />
      )}

      {/* Voice FAB */}
      <VoiceFAB
        onSwitchTab={setActiveTab}
        autoClosedCount={q?.autoClosedCount ?? 0}
        autoClosedPct={q?.autoClosedPct ?? 0}
        trustScore={trustScore}
        briefingSummary={briefingData?.summary ?? null}
      />

    </div>
  );
}
