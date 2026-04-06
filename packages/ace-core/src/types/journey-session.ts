export type BookingState =
  | 'planned'
  | 'payment_pending'
  | 'ticketed'
  | 'attention_required'
  | 'rerouting'
  | 'completed'

export type RerouteOption = {
  summary: string
  totalAmountGbp: number
  approvalRequired: boolean
  approvalReason?: string
}

export type JourneySession = {
  id: string // jrn_xxx
  tripIntentId: string
  principalId: string
  operatorId: string
  bookingState: BookingState
  policyId: string // which policy allowed this
  approvalId: string // which approval gate was used
  initiatedBy: 'human' | 'agent'
  liveState?: {
    departureTime?: string
    arrivalTime?: string
    platform?: string
    gate?: string
    disruption?: string
    rerouteOptions?: RerouteOption[]
  }
  notifications: string[] // notification IDs
  createdAt: string
  updatedAt: string
}
