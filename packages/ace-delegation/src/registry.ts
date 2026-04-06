import type { Operator, OperatorType } from '../ace-core/src/index'
import type { AllowedAction } from './scopes'
import { validateActions } from './scopes'

export type RegisterOperatorInput = {
  principalId: string
  type: OperatorType
  name: string
  allowedActions: string[]
  spendLimitGbp?: number
  requiresHumanConfirmAboveGbp?: number
  expiresAt?: string // ISO 8601
}

export type OperatorRecord = Operator & {
  allowedActions: AllowedAction[]
  spendLimitGbp?: number
  requiresHumanConfirmAboveGbp?: number
}

/**
 * buildOperatorId — generates a deterministic-prefix operator ID.
 * In production this should be a DB-generated primary key; this helper
 * is used for in-memory / test scenarios.
 */
export function buildOperatorId(): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `opr_${rand}`
}

/**
 * buildPermissionsId — generates an ID for the permissions record.
 */
export function buildPermissionsId(): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `prm_${rand}`
}

/**
 * createOperatorRecord — constructs an OperatorRecord from registration input.
 * Does not persist; callers are responsible for storage.
 */
export function createOperatorRecord(input: RegisterOperatorInput): OperatorRecord {
  const now = new Date().toISOString()
  return {
    id: buildOperatorId(),
    type: input.type,
    name: input.name,
    principalId: input.principalId,
    permissionsId: buildPermissionsId(),
    allowedActions: validateActions(input.allowedActions),
    spendLimitGbp: input.spendLimitGbp,
    requiresHumanConfirmAboveGbp: input.requiresHumanConfirmAboveGbp,
    delegationExpiresAt: input.expiresAt,
    createdAt: now,
  }
}

/**
 * isOperatorActive — returns true if the operator is not revoked and
 * has not exceeded their delegation expiry.
 */
export function isOperatorActive(operator: Operator): boolean {
  if (operator.revokedAt) return false
  if (operator.delegationExpiresAt) {
    return new Date(operator.delegationExpiresAt) > new Date()
  }
  return true
}

/**
 * revokeOperator — returns a new operator record with revokedAt stamped.
 * Does not mutate the original; callers persist the updated record.
 */
export function revokeOperator(operator: OperatorRecord): OperatorRecord {
  return { ...operator, revokedAt: new Date().toISOString() }
}
