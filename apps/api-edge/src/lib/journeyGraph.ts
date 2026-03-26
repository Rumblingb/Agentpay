import type { JourneyGraph, JourneyGraphChange, JourneyGraphNode } from '../../../../packages/bro-trip/index';

type GraphLegInput = {
  jobId: string;
  status: string;
  mode: 'rail' | 'bus' | 'flight' | 'hotel' | 'other';
  label: string;
  from?: string | null;
  to?: string | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  operator?: string | null;
  bookingRef?: string | null;
};

function normalizeLegStatus(status: string): JourneyGraphNode['status'] {
  if (status === 'completed' || status === 'confirmed' || status === 'verified') return 'completed';
  if (status === 'failed' || status === 'expired' || status === 'rejected') return 'attention';
  if (status === 'securing' || status === 'pending') return 'securing';
  return 'booked';
}

function modeLabel(mode: GraphLegInput['mode']): string {
  switch (mode) {
    case 'rail': return 'rail leg';
    case 'bus': return 'coach leg';
    case 'flight': return 'flight leg';
    case 'hotel': return 'hotel stay';
    default: return 'journey leg';
  }
}

export function buildJourneyGraph(
  legs: GraphLegInput[],
  overallStatus: string,
): JourneyGraph {
  const nodes: JourneyGraphNode[] = legs.map((leg, index) => ({
    id: leg.jobId,
    mode: leg.mode === 'other' ? 'mixed' : leg.mode,
    label: leg.label || `Leg ${index + 1}`,
    status: normalizeLegStatus(leg.status),
    origin: leg.from ?? undefined,
    destination: leg.to ?? undefined,
    departureTime: leg.departureTime ?? undefined,
    arrivalTime: leg.arrivalTime ?? undefined,
    operator: leg.operator ?? undefined,
    bookingRef: leg.bookingRef ?? undefined,
    dependsOn: index > 0 ? [legs[index - 1].jobId] : [],
  }));

  const completedLegs = nodes.filter((node) => node.status === 'completed').length;
  const activeNode = nodes.find((node) => node.status === 'securing' || node.status === 'attention')
    ?? nodes.find((node) => node.status === 'booked');
  const nextNode = activeNode
    ? nodes[nodes.findIndex((node) => node.id === activeNode.id) + 1]
    : undefined;

  const changes: JourneyGraphChange[] = [];
  const attentionNode = nodes.find((node) => node.status === 'attention');
  if (attentionNode) {
    changes.push({
      id: `change-${attentionNode.id}-attention`,
      kind: 'status',
      title: `${attentionNode.label} needs attention`,
      body: `Bro flagged this ${modeLabel(legs.find((leg) => leg.jobId === attentionNode.id)?.mode ?? 'other')} for manual review.`,
      severity: 'warning',
    });
  }

  const securingNode = nodes.find((node) => node.status === 'securing');
  if (securingNode) {
    changes.push({
      id: `change-${securingNode.id}-securing`,
      kind: 'status',
      title: `${securingNode.label} is being secured`,
      body: 'Payment is confirmed and Bro is pushing this leg through fulfilment.',
      severity: 'info',
    });
  }

  if (!attentionNode && !securingNode && completedLegs === nodes.length && nodes.length > 0) {
    changes.push({
      id: 'change-all-confirmed',
      kind: 'status',
      title: 'All legs confirmed',
      body: 'Every booked leg in this journey is in a healthy state.',
      severity: 'success',
    });
  }

  if (nextNode) {
    changes.push({
      id: `change-${nextNode.id}-next`,
      kind: nextNode.mode === 'hotel' ? 'arrival' : 'connection',
      title: 'What is next',
      body: nextNode.origin && nextNode.destination
        ? `${nextNode.label}: ${nextNode.origin} -> ${nextNode.destination}.`
        : `${nextNode.label} is the next step in this journey.`,
      severity: 'info',
    });
  }

  return {
    version: 1,
    status: overallStatus === 'failed' ? 'attention' : 'active',
    totalLegs: nodes.length,
    completedLegs,
    activeLegId: activeNode?.id,
    nextLegId: nextNode?.id,
    nodes,
    changes,
  };
}
