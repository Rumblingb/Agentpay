export type AceEventType =
  | 'trip.planned'
  | 'trip.awaiting_approval'
  | 'trip.approved'
  | 'trip.rejected'
  | 'trip.executing'
  | 'trip.failed'
  | 'journey.live.updated'
  | 'journey.delay.detected'
  | 'journey.reroute.offered'
  | 'journey.ticket.issued'
  | 'journey.completed'
  | 'journey.attention.required'
  | 'operator.registered'
  | 'operator.revoked'
  | 'policy.updated'

export type AceEvent<T = unknown> = {
  type: AceEventType
  principalId: string
  sessionId?: string
  intentId?: string
  payload: T
  ts: string // ISO 8601
}

// ── Per-event payload shapes ──────────────────────────────────────────────────

export type TripPlannedPayload = {
  intentId: string
  summary: string
  totalAmountGbp: number
  approvalMode: 'auto' | 'human_confirm' | 'escalate'
}

export type TripApprovalPayload = {
  intentId: string
  approvalId: string
  decidedBy: string
}

export type JourneyLivePayload = {
  sessionId: string
  bookingState: string
  departureTime?: string
  arrivalTime?: string
  platform?: string
  disruption?: string
}

export type JourneyReroutePayload = {
  sessionId: string
  options: {
    summary: string
    totalAmountGbp: number
    approvalRequired: boolean
  }[]
}

export type OperatorEventPayload = {
  operatorId: string
  principalId: string
  name: string
}

export type PolicyUpdatedPayload = {
  principalId: string
  policyId: string
}
