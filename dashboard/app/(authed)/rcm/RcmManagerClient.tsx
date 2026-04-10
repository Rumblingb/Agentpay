'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart2,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  Cpu,
  DollarSign,
  FileText,
  Layers,
  Loader2,
  Mic,
  MicOff,
  Shield,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelState = 'ok' | 'error';
type Lane = 'claim-status' | 'eligibility';
type LaneMode = 'auto' | 'auto_notify' | 'human';
type ActiveTab = 'claims' | 'eligibility' | 'connectors' | 'workspaces' | 'agent' | 'pipeline' | 'intel';
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

type DailyBriefing = {
  briefing: string;
  generatedAt: string;
  context?: Record<string, unknown>;
};

type RevenuePipelineStage = {
  stage: string;
  label: string;
  count: number;
  amount: number;
};

type RevenuePipeline = {
  windowDays: number;
  stages: RevenuePipelineStage[];
  summary: { denialRate: number; recoveryRate: number; totalAmount: number };
};

type PayerRow = {
  payerName: string;
  totalItems: number;
  denialRate: number;
  autoClosePct: number;
  amountAtRisk: number;
};

type PayerIntelligence = {
  windowDays: number;
  payers: PayerRow[];
};

type AutomationHealth = {
  lanes: Array<{ lane: string; accuracy: number; falsePositives: number; threshold: number }>;
  summary: { autoClosedCorrectly: number; falsePositivesCaught: number; savedAmount: number };
  recommendation: string;
};

type VoiceIntentResponse = {
  narration: string;
  confirmRequired?: boolean;
  action?: Record<string, unknown>;
  executed?: boolean;
};

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchRcmManagerSnapshot(): Promise<ManagerSnapshot> {
  const res = await fetch('/api/rcm/manager', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load billing snapshot');
  return res.json();
}

async function fetchDailyBriefing(): Promise<DailyBriefing> {
  const res = await fetch('/api/rcm/daily-briefing');
  if (!res.ok) throw new Error('briefing unavailable');
  return res.json();
}

async function fetchRevenuePipeline(windowDays = 30): Promise<RevenuePipeline> {
  const res = await fetch(`/api/rcm/revenue-pipeline?windowDays=${windowDays}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('pipeline unavailable');
  return res.json();
}

async function fetchPayerIntelligence(windowDays = 30): Promise<PayerIntelligence> {
  const res = await fetch(`/api/rcm/payer-intelligence?windowDays=${windowDays}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('payer intelligence unavailable');
  return res.json();
}

async function fetchAutomationHealth(): Promise<AutomationHealth> {
  const res = await fetch('/api/rcm/automation-health', { cache: 'no-store' });
  if (!res.ok) throw new Error('automation health unavailable');
  return res.json();
}

async function postVoiceIntent(payload: {
  transcript: string;
  workspaceId?: string;
  confirmed?: boolean;
  action?: Record<string, unknown>;
}): Promise<VoiceIntentResponse> {
  const res = await fetch('/api/rcm/voice-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ narration: 'Could not process voice command.' })) as VoiceIntentResponse;
  return data;
}

async function postGenerateAppeal(workItemId: string): Promise<{ appealLetter: string; claimRef?: string; payerName?: string }> {
  const res = await fetch('/api/rcm/generate-appeal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workItemId }),
  });
  if (!res.ok) throw new Error('Appeal generation failed');
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

function hydratePolicy(workspaceId: string, serverPolicy?: ApprovalPolicy): ApprovalPolicy {
  try {
    const raw = localStorage.getItem(`ace_policy_${workspaceId}`);
    if (raw) return { ...DEFAULT_POLICY, ...JSON.parse(raw) as ApprovalPolicy };
  } catch {}
  return serverPolicy ?? DEFAULT_POLICY;
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

// ── Digest strip ───────────────────────────────────────────────────────────────

function DigestStrip({
  autoCount, humanReviewCount, autoClosedPct, isLoading, onReview,
}: {
  autoCount: number;
  humanReviewCount: number;
  autoClosedPct: number;
  isLoading: boolean;
  onReview: () => void;
}) {
  if (isLoading) return null;
  return (
    <div style={{
      marginBottom: 16, padding: '11px 18px', borderRadius: 10,
      background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: '#10b981',
            animation: 'ace-pulse 1.4s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981', letterSpacing: '-0.01em' }}>Ace</span>
        </div>
        <span style={{ fontSize: 12, color: '#555' }}>
          handled today:{' '}
          <span style={{ color: '#bbb' }}>
            {autoCount > 0 ? `${autoCount} item${autoCount !== 1 ? 's' : ''} auto-resolved` : 'queue clear'}
          </span>
          {autoClosedPct > 0 && (
            <span style={{ color: '#444' }}> · {autoClosedPct}% autonomous rate</span>
          )}
        </span>
      </div>
      {humanReviewCount > 0 ? (
        <button
          onClick={onReview}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)',
            color: '#fb7185', cursor: 'pointer',
          }}
        >
          <AlertTriangle size={10} />
          {humanReviewCount} need{humanReviewCount === 1 ? 's' : ''} your input
        </button>
      ) : (
        <span style={{ fontSize: 11, color: '#333', display: 'flex', alignItems: 'center', gap: 5 }}>
          <CheckCircle2 size={10} style={{ color: '#10b981' }} />
          Nothing needs your input
        </span>
      )}
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
  const isDenial = item.exceptionType?.includes('denial') || item.summary?.toLowerCase().includes('denial') || item.summary?.toLowerCase().includes('denied');

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
        {isDenial && onAppeal && (
          <button
            onClick={() => onAppeal(item.workItemId)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              cursor: 'pointer', border: '1px solid rgba(99,102,241,0.25)',
              background: 'rgba(99,102,241,0.08)', color: '#818cf8',
            }}
          >
            <FileText size={10} />
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
  connectors, claimErr, eligErr, isLoading,
}: {
  connectors: Connector[];
  claimErr: boolean;
  eligErr: boolean;
  isLoading: boolean;
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
          const label = isLive ? 'Agent-ready' : isSim ? 'Connecting' : 'Legacy queue';
          const color = isLive ? '#34d399' : isSim ? '#fcd34d' : '#555';
          const bg = isLive ? 'rgba(16,185,129,0.08)' : isSim ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.02)';
          const bdr = isLive ? 'rgba(16,185,129,0.2)' : isSim ? 'rgba(245,158,11,0.15)' : '#1a1a1a';
          const speed = isLive ? '~24h via API' : isSim ? 'Connecting...' : '3–5 business days';

          return (
            <div key={c.key} style={{ padding: '14px 16px', borderRadius: 10, background: '#080808', border: '1px solid #161616' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>{c.label}</div>
                <span style={{
                  padding: '2px 9px', borderRadius: 20,
                  background: bg, border: `1px solid ${bdr}`,
                  fontSize: 10, fontWeight: 600, color, letterSpacing: '0.04em',
                }}>
                  {label}
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
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>{ws.name}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
                {[ws.workspaceType, ws.specialty].filter(Boolean).join(' · ')}
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

// ── Voice FAB (AI-powered) ─────────────────────────────────────────────────────

function VoiceFAB({
  workspaceId,
}: {
  workspaceId?: string;
}) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [narration, setNarration] = useState('');
  const [pendingAction, setPendingAction] = useState<{ narration: string; action: Record<string, unknown> } | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const speak = useDashboardTts();
  const queryClient = useQueryClient();

  const handle = useCallback(async (transcript: string) => {
    setProcessing(true);
    setNarration('');
    try {
      const result = await postVoiceIntent({ transcript, workspaceId });
      speak(result.narration);
      if (result.confirmRequired && result.action) {
        setPendingAction({ narration: result.narration, action: result.action });
        setNarration(result.narration);
      } else {
        setNarration(result.narration);
        // Refresh data if an action was executed
        if (result.executed) {
          queryClient.invalidateQueries({ queryKey: ['rcm-manager'] });
        }
        setTimeout(() => setNarration(''), 6000);
      }
    } catch {
      const fallback = "I couldn't process that. Try: what needs attention, or pause prior auth.";
      speak(fallback);
      setNarration(fallback);
      setTimeout(() => setNarration(''), 4000);
    } finally {
      setProcessing(false);
    }
  }, [workspaceId, speak, queryClient]);

  async function confirmAction() {
    if (!pendingAction) return;
    setProcessing(true);
    try {
      const result = await postVoiceIntent({ transcript: '', workspaceId, confirmed: true, action: pendingAction.action });
      speak(result.narration);
      setNarration(result.narration);
      queryClient.invalidateQueries({ queryKey: ['rcm-manager'] });
    } catch {
      speak("Action failed. Please try again.");
    } finally {
      setPendingAction(null);
      setProcessing(false);
      setTimeout(() => setNarration(''), 5000);
    }
  }

  function toggle() {
    if (processing) return;
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
    rec.onresult = (e: any) => { handle(e.results[0][0].transcript as string); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <div style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      {(narration || pendingAction) && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 12, color: '#e0e0e0',
          background: '#0d0d0d', border: '1px solid #1e1e1e',
          maxWidth: 260, lineHeight: 1.55,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          <p style={{ margin: '0 0 8px' }}>{narration || pendingAction?.narration}</p>
          {pendingAction && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={confirmAction}
                disabled={processing}
                style={{
                  padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                  background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
                  color: '#34d399', cursor: 'pointer',
                }}
              >
                Confirm
              </button>
              <button
                onClick={() => { setPendingAction(null); setNarration(''); }}
                style={{
                  padding: '4px 10px', borderRadius: 5, fontSize: 11,
                  background: 'transparent', border: '1px solid #1e1e1e', color: '#555', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      <button
        onClick={toggle}
        title={listening ? 'Stop' : 'Ask your billing AI'}
        style={{
          width: 50, height: 50, borderRadius: '50%', border: 'none', cursor: processing ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: listening ? '#10b981' : processing ? '#1a1a1a' : '#111',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: listening ? 'ace-pulse 1.4s ease-in-out infinite' : 'none',
          transition: 'background 0.2s',
        }}
      >
        {processing
          ? <Loader2 size={18} style={{ color: '#444' }} className="animate-spin" />
          : listening
            ? <MicOff size={18} style={{ color: '#000' }} />
            : <Mic size={18} style={{ color: '#444' }} />
        }
      </button>
    </div>
  );
}

// ── Daily briefing panel ───────────────────────────────────────────────────────

function DailyBriefingPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-daily-briefing'],
    queryFn: fetchDailyBriefing,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  if (isError) return null;

  return (
    <div style={{
      marginBottom: 16, padding: '14px 18px', borderRadius: 10,
      background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.12)',
      display: 'flex', gap: 14, alignItems: 'flex-start',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 12px rgba(99,102,241,0.25)',
      }}>
        <Sparkles size={14} style={{ color: '#fff' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Today&apos;s Briefing
          </span>
          {data?.generatedAt && (
            <span style={{ fontSize: 10, color: '#333' }}>
              {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#444' }}>
            <Loader2 size={11} className="animate-spin" />
            Generating briefing…
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: '#aaa', lineHeight: 1.65 }}>
            {data?.briefing ?? 'Briefing unavailable.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Revenue pipeline panel ─────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'submitted', color: '#38bdf8' },
  { key: 'received', color: '#818cf8' },
  { key: 'processing', color: '#a78bfa' },
  { key: 'pending_info', color: '#f59e0b' },
  { key: 'denied', color: '#f43f5e' },
  { key: 'appealed', color: '#fb923c' },
  { key: 'recovered', color: '#10b981' },
];

function RevenuePipelinePanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-revenue-pipeline'],
    queryFn: () => fetchRevenuePipeline(30),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const maxAmount = Math.max(1, ...(data?.stages ?? []).map(s => s.amount));

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
        Revenue recovery pipeline · last 30 days
      </div>

      {isError && <WarnBanner text="Pipeline data temporarily unavailable." />}

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#444', padding: '20px 0' }}>
          <Loader2 size={12} className="animate-spin" />
          Loading pipeline…
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          {/* Funnel bars */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 20, height: 120 }}>
            {PIPELINE_STAGES.map(({ key, color }) => {
              const stage = data.stages.find(s => s.stage === key);
              const amount = stage?.amount ?? 0;
              const count = stage?.count ?? 0;
              const label = stage?.label ?? key.replace(/_/g, ' ');
              const pct = Math.max(4, Math.round((amount / maxAmount) * 100));
              return (
                <div key={key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color, textAlign: 'center' }}>
                    {fmt$(amount)}
                  </div>
                  <div
                    title={`${label}: ${count} items · ${fmt$(amount)}`}
                    style={{
                      width: '100%', height: `${pct}%`, borderRadius: 4, background: color,
                      opacity: 0.8, transition: 'height 0.4s ease',
                      minHeight: 4,
                    }}
                  />
                  <div style={{ fontSize: 9, color: '#555', textAlign: 'center', lineHeight: 1.3 }}>
                    {label.split(' ').map((w: string, i: number) => <span key={i} style={{ display: 'block' }}>{w}</span>)}
                  </div>
                  <div style={{ fontSize: 9, color: '#444' }}>{count}</div>
                </div>
              );
            })}
          </div>

          {/* Summary row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
            padding: '14px 16px', borderRadius: 10, background: '#080808', border: '1px solid #161616',
          }}>
            {[
              { label: 'Total in pipeline', value: fmt$(data.summary.totalAmount), accent: '#38bdf8' },
              { label: 'Denial rate', value: `${data.summary.denialRate.toFixed(1)}%`, accent: data.summary.denialRate > 10 ? '#f43f5e' : '#f59e0b' },
              { label: 'Recovery rate', value: `${data.summary.recoveryRate.toFixed(1)}%`, accent: '#10b981' },
            ].map(stat => (
              <div key={stat.label}>
                <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                  {stat.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: stat.accent, letterSpacing: '-0.02em' }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Payer intelligence panel ───────────────────────────────────────────────────

function PayerIntelligencePanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-payer-intelligence'],
    queryFn: () => fetchPayerIntelligence(30),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
        Payer performance · last 30 days
      </div>

      {isError && <WarnBanner text="Payer intelligence temporarily unavailable." />}

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#444', padding: '20px 0' }}>
          <Loader2 size={12} className="animate-spin" />
          Loading payer data…
        </div>
      )}

      {!isLoading && !isError && data && (
        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #161616' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr',
            padding: '10px 16px', background: '#0d0d0d', borderBottom: '1px solid #161616',
          }}>
            {['Payer', 'Items', 'Denial rate', 'Auto-close', 'At risk'].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</div>
            ))}
          </div>

          {data.payers.length === 0 && (
            <div style={{ padding: '20px 16px', fontSize: 12, color: '#444', textAlign: 'center' }}>
              No payer data for this period.
            </div>
          )}

          {data.payers.map((row, i) => {
            const denialColor = row.denialRate > 15 ? '#f43f5e' : row.denialRate > 8 ? '#f59e0b' : '#10b981';
            const autoColor = row.autoClosePct > 70 ? '#10b981' : row.autoClosePct > 40 ? '#f59e0b' : '#f43f5e';
            return (
              <div
                key={row.payerName}
                style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr',
                  padding: '12px 16px', background: '#080808',
                  borderBottom: i < data.payers.length - 1 ? '1px solid #111' : 'none',
                  alignItems: 'center',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>{row.payerName}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{row.totalItems}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: denialColor }}>{row.denialRate.toFixed(1)}%</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: autoColor }}>{row.autoClosePct.toFixed(0)}%</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e0e0e0' }}>{fmt$(row.amountAtRisk)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Automation health card ─────────────────────────────────────────────────────

function AutomationHealthCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-automation-health'],
    queryFn: fetchAutomationHealth,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const [dismissed, setDismissed] = useState(false);
  if (dismissed || isError || isLoading) return null;
  if (!data?.recommendation) return null;

  return (
    <div style={{
      marginTop: 16, padding: '14px 16px', borderRadius: 10,
      background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <TrendingUp size={13} style={{ color: '#f59e0b' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fcd34d', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Automation Intelligence
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#888', lineHeight: 1.6 }}>
            {data.recommendation}
          </p>
          {data.summary && (
            <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
              {[
                { label: 'Auto-closed correctly', value: String(data.summary.autoClosedCorrectly) },
                { label: 'False positives caught', value: String(data.summary.falsePositivesCaught) },
                { label: 'Saved by review', value: fmt$(data.summary.savedAmount) },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#333', padding: 4, flexShrink: 0 }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Appeal modal ───────────────────────────────────────────────────────────────

function AppealModal({
  workItemId, onClose,
}: {
  workItemId: string;
  onClose: () => void;
}) {
  const [letter, setLetter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    postGenerateAppeal(workItemId)
      .then(r => { if (!cancelled) { setLetter(r.appealLetter); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError('Could not generate appeal letter.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [workItemId]);

  function copyToClipboard() {
    navigator.clipboard.writeText(letter).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 640, borderRadius: 14,
        background: '#0c0c0c', border: '1px solid #1e1e1e',
        boxShadow: '0 24px 64px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', maxHeight: '80vh',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #161616',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <FileText size={14} style={{ color: '#818cf8' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0' }}>Appeal Letter</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#555', padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#555', fontSize: 13 }}>
              <Loader2 size={14} className="animate-spin" />
              Generating appeal letter…
            </div>
          )}
          {error && <div style={{ fontSize: 13, color: '#fb7185' }}>{error}</div>}
          {letter && (
            <pre style={{
              margin: 0, fontSize: 12, color: '#aaa', lineHeight: 1.7,
              whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace',
            }}>
              {letter}
            </pre>
          )}
        </div>

        {letter && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid #161616', display: 'flex', gap: 8 }}>
            <button
              onClick={copyToClipboard}
              style={{
                padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: copied ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.12)',
                border: `1px solid ${copied ? 'rgba(16,185,129,0.25)' : 'rgba(99,102,241,0.2)'}`,
                color: copied ? '#34d399' : '#818cf8',
                cursor: 'pointer',
              }}
            >
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: 'transparent', border: '1px solid #1e1e1e', color: '#555',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
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
  const [policy, setPolicy] = useState<ApprovalPolicy>(DEFAULT_POLICY);
  const [policyInit, setPolicyInit] = useState(false);
  const [appealWorkItemId, setAppealWorkItemId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-manager'],
    queryFn: fetchRcmManagerSnapshot,
    refetchInterval: 30_000,
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
    { id: 'pipeline', label: 'Pipeline', icon: BarChart2 },
    { id: 'intel', label: 'Payer intel', icon: TrendingUp },
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
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 16, alignItems: 'start' }}>
        <div>
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
                onAppeal={setAppealWorkItemId}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

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

      {/* Digest strip */}
      <DigestStrip
        autoCount={q?.autoClosedCount ?? 0}
        humanReviewCount={q?.humanReviewCount ?? 0}
        autoClosedPct={q?.autoClosedPct ?? 0}
        isLoading={isLoading}
        onReview={() => setActiveTab('claims')}
      />

      {/* Daily briefing */}
      <DailyBriefingPanel />

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

      {activeTab === 'pipeline' && <RevenuePipelinePanel />}

      {activeTab === 'intel' && <PayerIntelligencePanel />}

      {activeTab === 'connectors' && (
        <ConnectorGrid
          connectors={[...connectors, ...eligCon]}
          claimErr={data?.panelStatus.claimStatusConnectors === 'error'}
          eligErr={data?.panelStatus.eligibilityConnectors === 'error'}
          isLoading={isLoading}
        />
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
          <AutomationHealthCard />
        </>
      )}

      {/* Appeal modal */}
      {appealWorkItemId && (
        <AppealModal
          workItemId={appealWorkItemId}
          onClose={() => setAppealWorkItemId(null)}
        />
      )}

      {/* Voice FAB (AI-powered) */}
      <VoiceFAB workspaceId={workspaces[0]?.workspaceId} />

    </div>
  );
}
