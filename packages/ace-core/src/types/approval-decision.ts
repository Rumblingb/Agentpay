export type ApprovalActor = 'human' | 'agent' | 'policy_auto'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated'

export type ApprovalDecision = {
  id: string // apv_xxx
  tripIntentId: string
  requiredFrom: ApprovalActor
  reason: string
  status: ApprovalStatus
  decidedBy?: string // principalId or operatorId
  decidedAt?: string
  createdAt: string
}
