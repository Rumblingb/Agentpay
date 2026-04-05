'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Cpu,
  DollarSign,
  Layers,
  Loader2,
  Shield,
  Users,
} from 'lucide-react';

const billingFamilies = [
  {
    title: 'Professional / provider billing',
    copy:
      'Physician, dental, eye, and ortho workflows where the claim, payer follow-up, and supporting evidence are repetitive enough to structure tightly.',
    tags: ['CMS-1500', 'Medicare', 'Medicaid', 'Private'],
  },
  {
    title: 'Facility / home health billing',
    copy:
      'Hospital, home health, DME, PAS, and hospice queues where institutional claims, eligibility, documentation, and correction workflows create heavy admin volume.',
    tags: ['UB-04', 'Home Health', 'DME', 'Hospice'],
  },
];

const agentRoles = [
  {
    title: 'Router Agent',
    copy: 'Classifies the incoming work item, selects the playbook, and decides whether the case is eligible for autonomous execution.',
  },
  {
    title: 'Worker Agent',
    copy: 'Executes the narrow queue playbook, records actions, and proposes closure when confidence is high enough.',
  },
  {
    title: 'QA Agent',
    copy: 'Checks whether the work is actually complete, the evidence is sufficient, and the case can close without human touch.',
  },
  {
    title: 'Escalation Agent',
    copy: 'Packages low-confidence, blocked, or ambiguous cases into a clean human exception inbox.',
  },
];

const connectorReality = [
  {
    title: 'Claim status rail',
    copy:
      'Use HIPAA X12 276/277 as the default automation rail. It is the cleanest place to prove high-volume, repeatable work without building the whole stack at once.',
  },
  {
    title: 'Eligibility rail',
    copy:
      'Use Medicare HETS 270/271 for eligibility checks. That should be a dedicated connector, not an ad hoc portal habit.',
  },
  {
    title: 'DDE stance',
    copy:
      'Treat DDE as a connector family and operator workflow, not one universal API. Use it where correction or contractor access requires it, but do not make it the whole product thesis.',
  },
];

const founderHoles = [
  'Trying to cover professional billing, home health, hospice, DME, dental, and eye workflows in the same first release.',
  'Assuming payer money movement is part of AgentPay. Insurance payment still rides EFT and ERA rails.',
  'Underestimating home health documentation, certification, and homebound eligibility requirements.',
  'Treating provider passwords and portal access as a casual implementation detail instead of a vault, audit, and compliance problem.',
  'Letting one general-purpose agent own the whole workflow instead of using typed queue state and specialized agents.',
];

const runtimeStance = [
  'Borrow durable task flow, hooks, and sub-agent coordination from agent runtimes.',
  'Keep typed work items, connector adapters, and approval boundaries as the real system of record.',
  'Do not make one persistent general agent the owner of payer, portal, and provider execution.',
];

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
  if (!value) return 'No date';
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

export default function RcmPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rcm-manager'],
    queryFn: fetchRcmManagerSnapshot,
    refetchInterval: 30000,
  });

  const queue = data?.overview.queue;
  const firstLane = data?.overview.firstLane;
  const workspaces = data?.workspaces.items ?? [];
  const workItems = data?.workItems.items ?? [];
  const exceptions = data?.exceptions.items ?? [];
  const connectors = data?.connectors.connectors ?? [];
  const eligibilityWorkItems = data?.eligibilityWorkItems?.items ?? [];
  const eligibilityExceptions = data?.eligibilityExceptions?.items ?? [];
  const eligibilityConnectors = data?.eligibilityConnectors?.connectors ?? [];

  return (
    <div className="space-y-6">
      <div
        className="rounded-3xl border p-6"
        style={{
          background:
            'linear-gradient(135deg, rgba(17,24,39,0.96), rgba(10,15,28,0.92))',
          borderColor: '#1f2937',
        }}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="max-w-3xl space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4b5563]">
              AgentPay RCM
            </div>
            <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-white">
              Autonomous billing operations, with humans only on exceptions.
            </h1>
            <p className="max-w-2xl text-[14px] leading-7 text-[#94a3b8]">
              The center of gravity is not software for a 30-person team. The center of gravity is
              agents working the queue by default, with managers only stepping in when a case is
              blocked, ambiguous, or commercially sensitive.
            </p>
          </div>

          <div className="grid min-w-[280px] gap-3">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-400">
                First lane
              </div>
              <div className="mt-2 text-[18px] font-semibold text-white">
                Claim status + DDE correction
              </div>
              <p className="mt-2 text-[13px] leading-6 text-[#a7f3d0]">
                {firstLane
                  ? `${firstLane.openItems} open items and ${firstLane.openExceptions} live exceptions on the bounded first lane.`
                  : 'Narrow enough to automate seriously, broad enough to prove queue orchestration, evidence, escalation, and payout control.'}
              </p>
            </div>

            <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
                System state
              </div>
              <div className="mt-2 text-[14px] leading-6 text-[#cbd5e1]">
                {isLoading && 'Loading live queue state.'}
                {isError && 'Manager snapshot failed. The lane stays defined, but the live read needs attention.'}
                {!isLoading &&
                  !isError &&
                  `${queue?.totalOpen ?? 0} open cases, ${queue?.openExceptionCount ?? 0} requiring active exception handling.`}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Open Queue',
            value: queue ? String(queue.totalOpen) : '—',
            subtext: `${queue?.totalWorkItems ?? 0} total work items`,
            icon: Layers,
            tone: 'text-sky-400',
          },
          {
            label: 'Auto-Close Rate',
            value: queue ? `${queue.autoClosedPct}%` : '—',
            subtext: `${queue?.autoClosedCount ?? 0} autonomous closures`,
            icon: CheckCircle2,
            tone: 'text-emerald-400',
          },
          {
            label: 'Exception Pressure',
            value: queue ? String(queue.openExceptionCount) : '—',
            subtext: `${queue?.highSeverityExceptionCount ?? 0} high severity`,
            icon: AlertTriangle,
            tone: 'text-amber-400',
          },
          {
            label: 'Amount At Risk',
            value: queue ? formatCurrency(queue.amountAtRiskOpen) : '—',
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
            <div className="mt-2 text-[13px] leading-6 text-[#94a3b8]">{card.subtext}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div
          className="rounded-2xl border p-5"
          style={{ background: '#0b1220', borderColor: '#1f2937' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-white">
              <Layers size={16} className="text-sky-400" />
              <h2 className="text-[16px] font-semibold">Live work queue</h2>
            </div>
            {isLoading && <Loader2 size={16} className="animate-spin text-[#64748b]" />}
          </div>

          <div className="mt-4 space-y-3">
            {!isLoading && workItems.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-5 text-[13px] leading-6 text-[#94a3b8]">
                The lane is ready for first live work items. Intake, execution, QA, retry, escalation,
                and human resolution are all wired.
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
                    <div className="text-[12px] leading-5 text-[#94a3b8]">
                      {item.workspaceName}
                      {item.payerName ? ` • ${item.payerName}` : ''}
                      {item.claimRef ? ` • ${item.claimRef}` : ''}
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
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-[12px] leading-6 text-[#cbd5e1] md:grid-cols-4">
                  <div>
                    <div className="text-[#64748b]">Amount at risk</div>
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
                  <div>
                    <div className="text-[#64748b]">Human review</div>
                    <div>{item.requiresHumanReview ? 'Required' : 'Not required'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-2xl border p-5"
          style={{ background: '#0b1220', borderColor: '#1f2937' }}
        >
          <div className="flex items-center gap-2 text-white">
            <AlertTriangle size={16} className="text-amber-400" />
            <h2 className="text-[16px] font-semibold">Exception inbox</h2>
          </div>

          <div className="mt-4 space-y-3">
            {!isLoading && exceptions.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-5 text-[13px] leading-6 text-[#94a3b8]">
                No live exceptions are open. That is the right end state: agents working the queue,
                humans only stepping in when confidence drops or context is missing.
              </div>
            )}

            {exceptions.map((item) => (
              <div
                key={item.exceptionId}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-semibold text-white">{item.summary}</div>
                    <div className="mt-1 text-[12px] leading-5 text-[#94a3b8]">
                      {item.workspaceName}
                      {item.payerName ? ` • ${item.payerName}` : ''}
                      {item.claimRef ? ` • ${item.claimRef}` : ''}
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] ${toneForSeverity(item.severity)}`}
                  >
                    {labelize(item.severity)}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 text-[12px] leading-6 text-[#cbd5e1]">
                  <div>
                    <span className="text-[#64748b]">Type: </span>
                    {labelize(item.exceptionType)}
                  </div>
                  <div>
                    <span className="text-[#64748b]">Recommended action: </span>
                    {item.recommendedHumanAction ?? 'Review case'}
                  </div>
                  <div>
                    <span className="text-[#64748b]">SLA: </span>
                    {formatDate(item.slaAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl border p-5"
        style={{ background: '#0b1220', borderColor: '#1f2937' }}
      >
        <div className="flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-violet-400" />
            <h2 className="text-[16px] font-semibold">Eligibility lane</h2>
          </div>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-violet-300">
            Live
          </span>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-[#94a3b8]">
          Medicare HETS 270/271 eligibility verification. Auto-close when coverage is confirmed, escalate when it cannot be resolved autonomously.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
              Work queue
            </div>
            {!isLoading && eligibilityWorkItems.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-4 text-[13px] leading-6 text-[#94a3b8]">
                No eligibility work items open. Submit via{' '}
                <code className="rounded bg-[#162033] px-1 py-0.5 text-[#93c5fd]">POST /api/rcm/lanes/eligibility/intake</code>.
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
                    <div className="text-[12px] leading-5 text-[#94a3b8]">
                      {item.workspaceName}
                      {item.payerName ? ` • ${item.payerName}` : ''}
                      {item.memberId ? ` • ID: ${item.memberId}` : ''}
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
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-[12px] leading-6 text-[#cbd5e1] md:grid-cols-3">
                  <div>
                    <div className="text-[#64748b]">Amount at risk</div>
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

          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
              Exceptions + connectors
            </div>
            {!isLoading && eligibilityExceptions.length === 0 && eligibilityConnectors.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-4 text-[13px] leading-6 text-[#94a3b8]">
                No open exceptions. Connectors loading.
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
                <div className="mt-1 text-[12px] leading-5 text-[#94a3b8]">
                  {item.workspaceName}
                  {item.payerName ? ` • ${item.payerName}` : ''}
                </div>
                <div className="mt-2 text-[12px] text-[#cbd5e1]">
                  <span className="text-[#64748b]">Action: </span>
                  {item.recommendedHumanAction ?? 'Review case'}
                </div>
              </div>
            ))}
            {eligibilityConnectors.map((connector) => (
              <div
                key={connector.key}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#93c5fd]">
                    {connector.label}
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] ${
                      connector.status === 'live'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    {connector.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="mt-1 text-[12px] leading-5 text-[#94a3b8]">{connector.notes}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl border p-5"
        style={{ background: '#0b1220', borderColor: '#1f2937' }}
      >
        <div className="flex items-center gap-2 text-white">
          <Building2 size={16} className="text-emerald-400" />
          <h2 className="text-[16px] font-semibold">Active workspaces</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.length === 0 && !isLoading ? (
            <div className="rounded-2xl border border-dashed border-[#22304a] bg-[#0a1120] p-5 text-[13px] leading-6 text-[#94a3b8]">
              No RCM workspaces yet. The API is ready to create them once the first design partner is onboarded.
            </div>
          ) : (
            workspaces.map((workspace) => (
              <div
                key={workspace.workspaceId}
                className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4"
              >
                <div className="text-[14px] font-semibold text-white">{workspace.name}</div>
                <div className="mt-1 text-[12px] leading-5 text-[#94a3b8]">
                  {workspace.workspaceType}
                  {workspace.specialty ? ` • ${workspace.specialty}` : ''}
                </div>

                <div className="mt-4 grid gap-2 text-[12px] leading-6 text-[#cbd5e1]">
                  <div>
                    <span className="text-[#64748b]">Open work: </span>
                    {workspace.openWorkItems}
                  </div>
                  <div>
                    <span className="text-[#64748b]">Human review: </span>
                    {workspace.humanReviewCount}
                  </div>
                  <div>
                    <span className="text-[#64748b]">Amount at risk: </span>
                    {formatCurrency(workspace.amountAtRiskOpen)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {billingFamilies.map((family) => (
          <div
            key={family.title}
            className="rounded-2xl border p-5"
            style={{ background: '#0b1220', borderColor: '#1f2937' }}
          >
            <div className="flex items-center gap-2 text-white">
              <Building2 size={16} className="text-emerald-400" />
              <h2 className="text-[16px] font-semibold">{family.title}</h2>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-[#94a3b8]">{family.copy}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {family.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em]"
                  style={{ borderColor: '#22304a', color: '#93c5fd', background: '#0f172a' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        {agentRoles.map((role) => (
          <div
            key={role.title}
            className="rounded-2xl border p-5"
            style={{ background: '#0b1220', borderColor: '#1f2937' }}
          >
            <div className="flex items-center gap-2 text-white">
              <Layers size={15} className="text-sky-400" />
              <h3 className="text-[15px] font-semibold">{role.title}</h3>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-[#94a3b8]">{role.copy}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-4">
          <div
            className="rounded-2xl border p-5"
            style={{ background: '#0b1220', borderColor: '#1f2937' }}
          >
            <div className="flex items-center gap-2 text-white">
              <Cpu size={16} className="text-sky-400" />
              <h2 className="text-[16px] font-semibold">Connector reality</h2>
            </div>
            <div className="mt-4 space-y-3">
              {connectorReality.map((item) => (
                connectors.length === 0 ? (
                  <div key={item.title} className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4">
                    <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#93c5fd]">
                      {item.title}
                    </div>
                    <div className="mt-2 text-[13px] leading-6 text-[#cbd5e1]">{item.copy}</div>
                  </div>
                ) : null
              ))}
              {connectors.map((connector) => (
                <div key={connector.key} className="rounded-2xl border border-[#162033] bg-[#0a1120] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#93c5fd]">
                      {connector.label}
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] ${
                        connector.status === 'live'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : connector.status === 'simulation'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                            : 'border-slate-500/30 bg-slate-500/10 text-slate-300'
                      }`}
                    >
                      {connector.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="mt-2 text-[13px] leading-6 text-[#cbd5e1]">{connector.notes}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {connector.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded-full border border-[#22304a] bg-[#0f172a] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[#cbd5e1]"
                      >
                        {capability.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="rounded-2xl border p-5"
            style={{ background: '#0b1220', borderColor: '#1f2937' }}
          >
            <div className="flex items-center gap-2 text-white">
              <Shield size={16} className="text-sky-400" />
              <h2 className="text-[16px] font-semibold">Runtime stance</h2>
            </div>
            <div className="mt-4 space-y-3">
              {runtimeStance.map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <ArrowRight size={14} className="mt-1 shrink-0 text-[#64748b]" />
                  <div className="text-[13px] leading-6 text-[#cbd5e1]">{item}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className="rounded-2xl border p-5"
          style={{ background: '#0b1220', borderColor: '#1f2937' }}
        >
          <div className="flex items-center gap-2 text-white">
            <Users size={16} className="text-violet-400" />
            <h2 className="text-[16px] font-semibold">Founder holes to keep visible</h2>
          </div>
          <div className="mt-4 space-y-3">
            {founderHoles.map((item) => (
              <div key={item} className="flex items-start gap-3">
                <ArrowRight size={14} className="mt-1 shrink-0 text-[#64748b]" />
                <div className="text-[13px] leading-6 text-[#cbd5e1]">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
