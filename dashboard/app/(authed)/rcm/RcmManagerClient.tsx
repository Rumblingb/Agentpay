'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Cpu,
  DollarSign,
  Layers,
  Loader2,
  Shield,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelState = 'ok' | 'error';
type Lane = 'claim-status' | 'eligibility';
type ActiveTab = 'claims' | 'eligibility' | 'connectors' | 'workspaces';
type Operation =
  | 'run-primary'
  | 'run-fallback'
  | 'approve-qa'
  | 'escalate-qa'
  | 'take-over'
  | 'mark-blocked';

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
  payload,
  pending,
  onClick,
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
        opacity: pending ? 0.6 : 1,
        transition: 'opacity 0.15s',
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
};

function ExceptionCard({ lane, item, checkPending, onAction }: ExceptionCardProps) {
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
        {item.slaAt && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#444' }}>SLA {fmtDate(item.slaAt)}</span>
        )}
      </div>
    </div>
  );
}

// ── Connector grid ─────────────────────────────────────────────────────────────

function ConnectorGrid({
  connectors,
  claimErr,
  eligErr,
  isLoading,
}: {
  connectors: Connector[];
  claimErr: boolean;
  eligErr: boolean;
  isLoading: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
        Connector health
      </div>
      {(claimErr || eligErr) && (
        <WarnBanner text="One or more connector panels failed to refresh." style={{ marginBottom: 12 }} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
        {connectors.map(c => {
          const isLive = c.status === 'live';
          const isSim = c.status === 'simulation';
          return (
            <div key={c.key} style={{ padding: '14px 16px', borderRadius: 10, background: '#080808', border: '1px solid #161616' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>{c.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: isLive ? '#10b981' : isSim ? '#f59e0b' : '#3a3a3a' }} />
                  <span style={{
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em',
                    color: isLive ? '#34d399' : isSim ? '#fcd34d' : '#888',
                  }}>
                    {c.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
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
  workspaces,
  unavailable,
  isLoading,
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

// ── Main component ────────────────────────────────────────────────────────────

export default function RcmManagerClient() {
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('claims');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-manager'],
    queryFn: fetchRcmManagerSnapshot,
    refetchInterval: 30_000,
  });

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

  const kpis = [
    {
      label: 'In progress',
      value: isLoading ? '—' : String(q?.totalOpen ?? 0),
      sub: isLoading ? '' : `${q?.totalWorkItems ?? 0} total`,
      icon: Layers,
      accent: '#38bdf8',
    },
    {
      label: 'Ace auto-closed',
      value: isLoading ? '—' : `${q?.autoClosedPct ?? 0}%`,
      sub: isLoading ? '' : `${q?.autoClosedCount ?? 0} items`,
      icon: CheckCircle2,
      accent: '#10b981',
    },
    {
      label: 'Revenue protected',
      value: isLoading ? '—' : fmt$(q?.amountAtRiskOpen),
      sub: isLoading ? '' : `${data?.workspaces.count ?? 0} practices`,
      icon: DollarSign,
      accent: '#8b5cf6',
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
  ];

  if (isError) {
    return (
      <div style={{ padding: 28, borderRadius: 10, background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.15)', color: '#fb7185', fontSize: 14 }}>
        Could not load billing dashboard. Check API connectivity.
      </div>
    );
  }

  // Lane tab content — inline render (not a component) so it uses parent scope safely
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
        {/* Queue */}
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
        {/* Exceptions */}
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
        marginBottom: 20, borderRadius: 12,
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

      {/* Automation insight */}
      {data && !isLoading && (q?.autoClosedPct ?? 0) > 0 && (
        <div style={{
          marginBottom: 20, padding: '10px 16px', borderRadius: 8,
          background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <CheckCircle2 size={13} style={{ color: '#10b981', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#555' }}>
            Ace auto-closed{' '}
            <span style={{ color: '#34d399', fontWeight: 600 }}>{q?.autoClosedCount ?? 0} items</span>
            {' '}({q?.autoClosedPct ?? 0}%) this period — your team only touched{' '}
            <span style={{ color: '#aaa', fontWeight: 600 }}>{q?.humanClosedCount ?? 0}</span>.
          </span>
        </div>
      )}

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

    </div>
  );
}
