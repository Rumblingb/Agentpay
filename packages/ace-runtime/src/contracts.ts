import type { TripIntent, JourneySession } from '@ace/core'
import type { BookingLeg } from './adapters'

// ── Execution request / result ────────────────────────────────────────────────

export type ExecutionRequest = {
  intentId: string
  approvalId: string
  principalId: string
  operatorId: string
}

export type ExecutionResult = {
  success: boolean
  journeySessionId: string
  legs: BookingLeg[]
  totalAmountGbp: number
  error?: string
}

// ── Reroute ───────────────────────────────────────────────────────────────────

export type RerouteAction = {
  sessionId: string
  reason: string // e.g. "Train delayed 45 min"
  options: {
    summary: string
    legs: BookingLeg[]
    totalAmountGbp: number
    approvalRequired: boolean
    approvalReason?: string
  }[]
}

export type RerouteResult = {
  success: boolean
  selectedSummary: string
  newLegs: BookingLeg[]
  error?: string
}

// ── Rollback ──────────────────────────────────────────────────────────────────

export type RollbackAction = {
  sessionId: string
  reason: string
  refundExpected: boolean
}

export type RollbackResult = {
  success: boolean
  refundAmountGbp?: number
  error?: string
}

// ── Ticket retrieval ──────────────────────────────────────────────────────────

export type TicketRetrievalRequest = {
  sessionId: string
  bookingRef: string
  principalId: string
}

export type TicketRetrievalResult = {
  success: boolean
  ticketUrl?: string
  walletPassUrl?: string
  qrCode?: string
  error?: string
}
