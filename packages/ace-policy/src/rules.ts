import type { TravelPolicy, Operator, TripIntent, OperatorPermission } from '../ace-core/src/index'
import type { PolicyDecision } from './engine'

/**
 * canOperatorAct — checks whether an operator has permission to perform
 * a given action for a principal, given the current policy.
 */
export function canOperatorAct(
  operator: Operator,
  action: string,
  policy: TravelPolicy,
): boolean {
  // Revoked operators never act
  if (operator.revokedAt) return false

  // Expired delegation never acts
  if (operator.delegationExpiresAt) {
    if (new Date(operator.delegationExpiresAt) < new Date()) return false
  }

  const permission: OperatorPermission | undefined = policy.operatorPermissions.find(
    (p) => p.operatorId === operator.id,
  )

  if (!permission) return false
  return permission.allowedActions.includes(action)
}

/**
 * getApprovalRequirement — determines what approval gate applies to a given
 * trip intent under a given policy.
 *
 * Ladder:
 *   auto          → safe, in-policy, low-cost, known mode
 *   human_confirm → expensive, risky, airport, flight, family booking, out-of-pattern
 *   escalate      → policy conflict, insufficient authority, document mismatch
 */
export function getApprovalRequirement(
  intent: TripIntent,
  policy: TravelPolicy,
): PolicyDecision {
  const modes = intent.constraints?.preferredModes ?? []
  const budgetGbp = intent.constraints?.budgetMax != null
    ? intent.constraints.budgetMax / 100
    : null

  // Flights always require human confirmation unless explicitly policy-allowed
  if (modes.includes('flight')) {
    if (policy.requireHumanApprovalForFlights) {
      return {
        mode: 'human_confirm',
        reason: 'Flight bookings always require your confirmation.',
      }
    }
  }

  // Rail within auto-book limit
  if (
    (modes.length === 0 || modes.includes('rail')) &&
    policy.autoBookRailUnderGbp != null &&
    budgetGbp != null &&
    budgetGbp <= policy.autoBookRailUnderGbp
  ) {
    return {
      mode: 'auto',
      reason: `Rail booking within your £${policy.autoBookRailUnderGbp} auto-book limit.`,
    }
  }

  // Rail exceeds auto-book limit → human confirm
  if (
    policy.autoBookRailUnderGbp != null &&
    budgetGbp != null &&
    budgetGbp > policy.autoBookRailUnderGbp
  ) {
    return {
      mode: 'human_confirm',
      reason: `Cost exceeds your £${policy.autoBookRailUnderGbp} auto-book limit.`,
    }
  }

  // No policy configured → default to human confirm (safe)
  return {
    mode: 'human_confirm',
    reason: 'No auto-book policy configured for this trip type.',
  }
}

/**
 * canAutoBook — true if the intent can proceed without any human approval.
 */
export function canAutoBook(intent: TripIntent, policy: TravelPolicy): boolean {
  const decision = getApprovalRequirement(intent, policy)
  return decision.mode === 'auto'
}

/**
 * evaluateOperatorSpendLimit — checks whether a delegated operator's spend
 * limit allows the proposed trip budget.
 */
export function evaluateOperatorSpendLimit(
  operator: Operator,
  intent: TripIntent,
  policy: TravelPolicy,
): PolicyDecision {
  const permission = policy.operatorPermissions.find(
    (p) => p.operatorId === operator.id,
  )

  if (!permission) {
    return {
      mode: 'escalate',
      reason: 'Operator has no delegated permissions for this principal.',
      code: 'NO_OPERATOR_PERMISSION',
    }
  }

  const budgetGbp = intent.constraints?.budgetMax != null
    ? intent.constraints.budgetMax / 100
    : null

  if (permission.spendLimitGbp != null && budgetGbp != null) {
    if (budgetGbp > permission.spendLimitGbp) {
      return {
        mode: 'escalate',
        reason: `Proposed cost £${budgetGbp} exceeds your operator's delegated limit of £${permission.spendLimitGbp}.`,
        code: 'OPERATOR_SPEND_LIMIT_EXCEEDED',
      }
    }

    if (
      permission.requiresHumanConfirmAboveGbp != null &&
      budgetGbp > permission.requiresHumanConfirmAboveGbp
    ) {
      return {
        mode: 'human_confirm',
        reason: `Cost requires your confirmation above £${permission.requiresHumanConfirmAboveGbp}.`,
      }
    }
  }

  return getApprovalRequirement(intent, policy)
}
