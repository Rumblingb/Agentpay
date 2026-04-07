'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Cpu,
  DollarSign,
  Layers,
  Loader2,
  Shield,
} from 'lucide-react';

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
    workspaces: {
      count: number;
    };
    firstLane: {
      key: string;
      label: string;
      reason: string;
      totalItems: number;
      openItems: number;
      openExceptions: number;
    };
  };
  workspaces: {
    items: Array<{
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
    }>;
  };
  workItems: {
    items: Array<{
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
    }>;
  };
  exceptions: {
    items: Array<{
      exceptionId: string;
      workspaceName: string;
      payerName: string | null;
      claimRef: string | null;
      priority: string;
      exceptionType: string;
      severity: string;
      summary: string;
      recommendedHumanAction: string | null;
      slaAt: string | null;
    }>;
  };
  connectors: {
    connectors: Array<{
      key: string;
      label: string;
      status: 'live' | 'simulation' | 'manual_fallback';
      mode: 'remote' | 'simulation' | 'manual';
      configured: boolean;
      capabilities: string[];
      notes: string;
    }>;
  };
  eligibilityWorkItems: {
    items: Array<{
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
    }>;
    count: number;
  };
  eligibilityExceptions: {
    items: Array<{
      exceptionId: string;
      workspaceName: string;
      payerName: string | null;
      claimRef: string | null;
      priority: string;
      exceptionType: string;
      severity: string;
      summary: string;
      recommendedHumanAction: string | null;
      slaAt: string | null;
    }>;
    count: number;
  };
  eligibilityConnectors: {
    connectors: Array<{
      key: string;
      label: string;
      status: 'live' | 'simulation' | 'manual_fallback';
      mode: 'remote' | 'simulation' | 'manual';
      configured: boolean;
      capabilities: string[];
      notes: string;
    }>;
  };
};

async function fetchRcmManagerSnapshot(): Promise<ManagerSnapshot> {
  const res = await fetch('/api/rcm/manager', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load RCM manager snapshot');
  return res.json();
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function labelize(value: string): string {
  return value.replace(/_/g, ' ');
}

function toneForPriority(priority: string): string {
  switch (priority) {
    case 'urgent':
      return 'text-rose-300 border-rose-500/30 bg-rose-500/10';
    case 'high':
      return 'text-amber-300 border-amber-500/30 bg-amber-500/10';
    case 'normal':
      return 'text-sky-300 border-sky-500/30 bg-sky-500/10';
    default:
      return 'text-slate-300 border-slate-500/30 bg-slate-500/10';
  }
}

function toneForSeverity(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'text-rose-300 border-rose-500/30 bg-rose-500/10';
    case 'high':
      return 'text-amber-300 border-amber-500/30 bg-amber-500/10';
    default:
      return 'text-slate-300 border-slate-500/30 bg-slate-500/10';
  }
}

function ConnectorStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'live'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : status === 'simulation'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-slate-500/30 bg-slate-500/10 text-slate-300';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function RcmPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-manager'],
    queryFn: fetchRcmManagerSnapshot,
    refetchInterval: 30000,
  });

  const queue = data?.overview.queue;
  const workspaces = data?.workspaces.items ?? [];
  const workItems = data?.workItems.items ?? [];
  const exceptions = data?.exceptions.items ?? [];
  const connectors = data?.connectors.connectors ?? [];
  const eligibilityWorkItems = data?.eligibilityWorkItems?.items ?? [];
  const eligibilityExceptions = data?.eligibilityExceptions?.items ?? [];
  const eligibilityConnectors = data?.eligibilityConnectors?.connectors ?? [];

  if (isError) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/5 p-8 text-[14px] text-rose-300">
        Manager snapshot failed to load. Check API connectivity.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div
        className="rounded-3xl border p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(17,24,39,0.96), rgba(10,15,28,0.92))',
          borderColor: '#1f2937',
        }}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4b5563]">
              AgentPay RCM
            </div>
            <h1 className="text-[26px] font-semibold tracking-[-0.03em] text-white">
              Autonomous billing operations
            </h1>
            <p className="max-w-xl text-[13px] leading-6 text-[#64748b]">
              Agents work the queue. Humans review exceptions.
            </p>
          </div>

          <div className="grid min-w-[260px] gap-3">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-400">
                Active lanes
              </div>
              <div className="mt-2 text-[15px] font-semibold text-white">
                Claim status · Eligibility
              </div>
              {data && (
                <div className="mt-1 text-[12px] text-[#a7f3d0]">
                  {queue?.totalOpen ?? 0} open · {queue?.openExceptionCount ?? 0} exceptions
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
                Auto-close rate
              </div>
              <div className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-white">
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin text-[#64748b]" />
                ) : (
                  `${queue?.autoClosedPct ?? 0}%`
                )}
              </div>
              {!isLoading && (
                <div className="mt-1 text-[12px] text-[#64748b]">
                  {queue?.autoClosedCount ?? 0} closed autonomously
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Open Queue',
            value: isLoading ? '—' : String(queue?.totalOpen ?? 0),
            subtext: `${queue?.totalWorkItems ?? 0} total work items`,
            icon: Layers,
            tone: 'text-sky-400',
          },
          {
            label: 'Auto-Close Rate',
            value: isLoading ? '—' : `${queue?.autoClosedPct ?? 0}%`,
            subtext: `${queue?.autoClosedCount ?? 0} autonomous closures`,
            icon: CheckCircle2,
            tone: 'text-emerald-400',
          },
          {
            label: 'Exception Pressure',
            value: isLoading ? '—' : String(queue?.openExceptionCount ?? 0),
            subtext: `${queue?.highSeverityExceptionCount ?? 0} high severity`,
            icon: AlertTriangle,
            tone: 'text-amber-400',
          },
          {
            label: 'Amount at Risk',
            value: isLoading ? '—' : formatCurrency(queue?.amountAtRiskOpen),
            subtext: `${data?.overview.workspaces.count ?? 0} active workspaces`,
            icon: DollarSign,
            tone: 'text-violet-400',
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border p-5"
            style={{ background: '#0b1220', borderColor: '#1f2937' }}
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
                {card.label}
              </div>
              <card.icon size={16} className={card.tone} />
            </div>
            <div className="mt-3 text-[28px] font-semibold tracking-[-0.03em] text-white">
              {card.value}
            </div>
            <div className="mt-2 text-[13px] text-[#64748b]">{card.subtext}</div>
          </div>
        ))}
      </div>

      {/* Claim status lane */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: '#0b1220', borderColor: '#1f2937' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Layers size={16} className="text-sky-400" />
            <h2 className="text-[16px] font-semibold">Claim status</h2>
          </div>
          <div className="flex items-center gap-2">
            {isLoading && <Loader2 size={14} className="animate-spin text-[#64748b]" />}
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-sky-300">
              X12 276/277
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          {/* Work items */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
              Work queue
            </div>
            {!isLoading && workItems.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-4 text-[13px] text-[#64748b]">
                Queue is clear.
              </div>
            )}
            {workItems.map((item) => (
              <div
                key={item.workItemId}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-[14px] font-semibold text-white">{item.title}</div>
                    <div className="text-[12px] text-[#64748b]">
                      {item.workspaceName}
                      {item.payerName ? ` · ${item.payerName}` : ''}
                      {item.claimRef ? ` · ${item.claimRef}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] ${toneForPriority(item.priority)}`}
                    >
                      {labelize(item.priority)}
                    </span>
                    <span className="rounded-full border border-[#22304a] bg-[#0f172a] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[#cbd5e1]">
                      {labelize(item.status)}
                    </span>
                    {item.requiresHumanReview && (
                      <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-rose-300">
                        Human review
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-[12px] text-[#cbd5e1] md:grid-cols-3">
                  <div>
                    <div className="text-[#64748b]">At risk</div>
                    <div>{formatCurrency(item.amountAtRisk)}</div>
                  </div>
                  <div>
                    <div className="text-[#64748b]">Confidence</div>
                    <div>{item.confidencePct === null ? 'Pending' : `${item.confidencePct}%`}</div>
                  </div>
                  <div>
                    <div className="text-[#64748b]">Due</div>
                    <div>{formatDate(item.dueAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Exceptions + connectors */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
              Exceptions
            </div>
            {!isLoading && exceptions.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-4 text-[13px] text-[#64748b]">
                No open exceptions.
              </div>
            )}
            {exceptions.map((item) => (
              <div
                key={item.exceptionId}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold text-white">{item.summary}</div>
                    <div className="mt-1 text-[12px] text-[#64748b]">
                      {item.workspaceName}
                      {item.payerName ? ` · ${item.payerName}` : ''}
                      {item.claimRef ? ` · ${item.claimRef}` : ''}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] ${toneForSeverity(item.severity)}`}
                  >
                    {labelize(item.severity)}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-[12px]">
                  <div>
                    <span className="text-[#64748b]">Type: </span>
                    <span className="text-[#cbd5e1]">{labelize(item.exceptionType)}</span>
                  </div>
                  <div>
                    <span className="text-[#64748b]">Action: </span>
                    <span className="text-[#cbd5e1]">{item.recommendedHumanAction ?? 'Review case'}</span>
                  </div>
                  <div>
                    <span className="text-[#64748b]">SLA: </span>
                    <span className="text-[#cbd5e1]">{formatDate(item.slaAt)}</span>
                  </div>
                </div>
              </div>
            ))}

            {/* Claim status connectors */}
            {connectors.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
                  Connectors
                </div>
                {connectors.map((connector) => (
                  <div
                    key={connector.key}
                    className="rounded-2xl border border-[#162033] bg-[#0a1120] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] font-semibold text-[#93c5fd]">
                        {connector.label}
                      </div>
                      <ConnectorStatusBadge status={connector.status} />
                    </div>
                    <div className="mt-1 text-[12px] text-[#64748b]">{connector.notes}</div>
                    {connector.capabilities.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {connector.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="rounded-full border border-[#22304a] bg-[#0f172a] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[#94a3b8]"
                          >
                            {cap.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Eligibility lane */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: '#0b1220', borderColor: '#1f2937' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Shield size={16} className="text-violet-400" />
            <h2 className="text-[16px] font-semibold">Eligibility</h2>
          </div>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-violet-300">
            HETS 270/271
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          {/* Work items */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
              Work queue
            </div>
            {!isLoading && eligibilityWorkItems.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-4 text-[13px] text-[#64748b]">
                Queue is clear.
              </div>
            )}
            {eligibilityWorkItems.map((item) => (
              <div
                key={item.workItemId}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-[14px] font-semibold text-white">{item.title}</div>
                    <div className="text-[12px] text-[#64748b]">
                      {item.workspaceName}
                      {item.payerName ? ` · ${item.payerName}` : ''}
                      {item.memberId ? ` · ${item.memberId}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] ${toneForPriority(item.priority)}`}
                    >
                      {labelize(item.priority)}
                    </span>
                    <span className="rounded-full border border-[#22304a] bg-[#0f172a] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[#cbd5e1]">
                      {labelize(item.status)}
                    </span>
                    {item.requiresHumanReview && (
                      <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-rose-300">
                        Human review
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-[12px] text-[#cbd5e1] md:grid-cols-3">
                  <div>
                    <div className="text-[#64748b]">At risk</div>
                    <div>{formatCurrency(item.amountAtRisk)}</div>
                  </div>
                  <div>
                    <div className="text-[#64748b]">Confidence</div>
                    <div>{item.confidencePct === null ? 'Pending' : `${item.confidencePct}%`}</div>
                  </div>
                  <div>
                    <div className="text-[#64748b]">Due</div>
                    <div>{formatDate(item.dueAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Eligibility exceptions + connectors */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
              Exceptions
            </div>
            {!isLoading && eligibilityExceptions.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-4 text-[13px] text-[#64748b]">
                No open exceptions.
              </div>
            )}
            {eligibilityExceptions.map((item) => (
              <div
                key={item.exceptionId}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-semibold text-white">{item.summary}</div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] ${toneForSeverity(item.severity)}`}
                  >
                    {labelize(item.severity)}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-[#64748b]">
                  {item.workspaceName}
                  {item.payerName ? ` · ${item.payerName}` : ''}
                </div>
                <div className="mt-2 text-[12px]">
                  <span className="text-[#64748b]">Action: </span>
                  <span className="text-[#cbd5e1]">{item.recommendedHumanAction ?? 'Review case'}</span>
                </div>
              </div>
            ))}

            {eligibilityConnectors.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
                  Connectors
                </div>
                {eligibilityConnectors.map((connector) => (
                  <div
                    key={connector.key}
                    className="rounded-2xl border border-[#162033] bg-[#0a1120] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] font-semibold text-[#93c5fd]">
                        {connector.label}
                      </div>
                      <ConnectorStatusBadge status={connector.status} />
                    </div>
                    <div className="mt-1 text-[12px] text-[#64748b]">{connector.notes}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Connector overview */}
      {(connectors.length > 0 || eligibilityConnectors.length > 0) && (
        <div
          className="rounded-2xl border p-5"
          style={{ background: '#0b1220', borderColor: '#1f2937' }}
        >
          <div className="flex items-center gap-2 text-white">
            <Cpu size={16} className="text-sky-400" />
            <h2 className="text-[16px] font-semibold">Connector status</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...connectors, ...eligibilityConnectors].map((connector) => (
              <div
                key={connector.key}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13px] font-semibold text-[#93c5fd]">{connector.label}</div>
                  <ConnectorStatusBadge status={connector.status} />
                </div>
                <div className="mt-2 text-[12px] text-[#64748b]">{connector.notes}</div>
                {connector.capabilities.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {connector.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="rounded-full border border-[#22304a] bg-[#0f172a] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[#94a3b8]"
                      >
                        {cap.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active workspaces */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: '#0b1220', borderColor: '#1f2937' }}
      >
        <div className="flex items-center gap-2 text-white">
          <Building2 size={16} className="text-emerald-400" />
          <h2 className="text-[16px] font-semibold">Workspaces</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {!isLoading && workspaces.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-5 text-[13px] text-[#64748b]">
              No workspaces active.
            </div>
          ) : (
            workspaces.map((workspace) => (
              <div
                key={workspace.workspaceId}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4"
              >
                <div className="text-[14px] font-semibold text-white">{workspace.name}</div>
                <div className="mt-1 text-[12px] text-[#64748b]">
                  {workspace.workspaceType}
                  {workspace.specialty ? ` · ${workspace.specialty}` : ''}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
                  <div>
                    <div className="text-[#64748b]">Open</div>
                    <div className="text-[#cbd5e1]">{workspace.openWorkItems}</div>
                  </div>
                  <div>
                    <div className="text-[#64748b]">Review</div>
                    <div className="text-[#cbd5e1]">{workspace.humanReviewCount}</div>
                  </div>
                  <div>
                    <div className="text-[#64748b]">At risk</div>
                    <div className="text-[#cbd5e1]">{formatCurrency(workspace.amountAtRiskOpen)}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
