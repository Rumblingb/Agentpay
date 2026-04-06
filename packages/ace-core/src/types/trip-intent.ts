export type TripIntentSource = 'direct_human' | 'delegated_agent'

export type TripIntentStatus =
  | 'draft'
  | 'planned'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'live'
  | 'completed'
  | 'failed'

export type TripIntent = {
  id: string // int_xxx
  principalId: string
  operatorId: string
  source: TripIntentSource
  objective: string // natural language outcome
  constraints?: {
    latestArrival?: string // ISO 8601
    budgetMax?: number // GBP pence
    preferredModes?: string[] // 'rail' | 'flight' | 'cab' | 'bus'
    avoidModes?: string[]
    passengerCount?: number
  }
  status: TripIntentStatus
  planId?: string // populated after /plan
  journeySessionId?: string // populated after /execute
  createdAt: string
  updatedAt: string
}
