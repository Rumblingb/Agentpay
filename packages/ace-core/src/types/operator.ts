export type OperatorType =
  | 'human'
  | 'personal_agent'
  | 'specialist_agent'
  | 'household_operator'

export type Operator = {
  id: string // opr_xxx
  type: OperatorType
  name: string
  principalId: string
  permissionsId: string
  delegationExpiresAt?: string
  revokedAt?: string
  createdAt: string
}
