/**
 * Behavioral Oracle — Fraud detection and automated intervention.
 *
 * Detects:
 *   - Predatory disputes (agent repeatedly disputes to avoid payment)
 *   - Looping transactions (rapid A→B→A patterns)
 *   - Wash trading (self-dealing through intermediaries)
 *   - Rapid escalation (too many disputes in a short window)
 *
 * On critical alert: auto-pause agent + reputation penalty.
 *
 * Prisma migration comment — run the SQL below to create the table:
 *
 *   CREATE TABLE IF NOT EXISTS behavior_alerts (
 *     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     agent_id        TEXT NOT NULL,
 *     alert_type      TEXT NOT NULL
 *                     CHECK (alert_type IN (
 *                       'PREDATORY_DISPUTE','LOOPING_TX','WASH_TRADING','RAPID_ESCALATION'
 *                     )),
 *     severity        TEXT NOT NULL DEFAULT 'low'
 *                     CHECK (severity IN ('low','medium','high','critical')),
 *     description     TEXT,
 *     auto_paused     BOOLEAN DEFAULT FALSE,
 *     reputation_penalty INT DEFAULT 0,
 *     metadata        JSONB DEFAULT '{}',
 *     created_at      TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * @module behavioral-oracle
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertType = 'PREDATORY_DISPUTE' | 'LOOPING_TX' | 'WASH_TRADING' | 'RAPID_ESCALATION';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface BehaviorAlert {
  id: string;
  agentId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  description: string;
  autoPaused: boolean;
  reputationPenalty: number;
  createdAt: Date;
}

export interface AgentBehaviorProfile {
  agentId: string;
  disputeCount: number;
  totalEscrows: number;
  recentTransactions: TransactionRecord[];
}

export interface TransactionRecord {
  from: string;
  to: string;
  amount: number;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Constants / Thresholds
// ---------------------------------------------------------------------------

const PREDATORY_DISPUTE_THRESHOLD = 0.5;   // > 50 % dispute rate
const RAPID_ESCALATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const RAPID_ESCALATION_COUNT = 3;           // 3+ disputes in 24h
const LOOPING_TX_MIN_ROUNDS = 3;            // 3+ round-trips = suspicious
const CRITICAL_REPUTATION_PENALTY = -50;
const HIGH_REPUTATION_PENALTY = -25;

// ---------------------------------------------------------------------------
// In-memory store (replace with DB when table is migrated)
// ---------------------------------------------------------------------------

let alertStore: BehaviorAlert[] = [];
let alertIdCounter = 1;

function generateAlertId(): string {
  return `alert-${Date.now()}-${alertIdCounter++}`;
}

/** Reset store — useful for tests */
export function _resetStore(): void {
  alertStore = [];
  alertIdCounter = 1;
}

// ---------------------------------------------------------------------------
// Detection functions (pure — no DB dependency)
// ---------------------------------------------------------------------------

/**
 * Detect predatory disputes: agent disputes > 50 % of escrows.
 */
export function detectPredatoryDisputes(profile: AgentBehaviorProfile): BehaviorAlert | null {
  if (profile.totalEscrows < 2) return null; // not enough data
  const rate = profile.disputeCount / profile.totalEscrows;
  if (rate <= PREDATORY_DISPUTE_THRESHOLD) return null;

  const severity: AlertSeverity = rate >= 0.8 ? 'critical' : 'high';
  const penalty = severity === 'critical' ? CRITICAL_REPUTATION_PENALTY : HIGH_REPUTATION_PENALTY;

  const alert: BehaviorAlert = {
    id: generateAlertId(),
    agentId: profile.agentId,
    alertType: 'PREDATORY_DISPUTE',
    severity,
    description: `Agent has a ${(rate * 100).toFixed(0)}% dispute rate across ${profile.totalEscrows} escrows`,
    autoPaused: severity === 'critical',
    reputationPenalty: penalty,
    createdAt: new Date(),
  };

  alertStore.push(alert);
  return alert;
}

/**
 * Detect looping transactions: A→B→A repeated patterns.
 */
export function detectLoopingTransactions(profile: AgentBehaviorProfile): BehaviorAlert | null {
  const txs = profile.recentTransactions;
  const pairCounts = new Map<string, number>();

  for (const tx of txs) {
    const pairKey = [tx.from, tx.to].sort().join('|');
    pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
  }

  for (const [pair, count] of pairCounts) {
    if (count >= LOOPING_TX_MIN_ROUNDS) {
      const alert: BehaviorAlert = {
        id: generateAlertId(),
        agentId: profile.agentId,
        alertType: 'LOOPING_TX',
        severity: count >= 6 ? 'critical' : 'medium',
        description: `Detected ${count} round-trip transactions between ${pair.replace('|', ' ↔ ')}`,
        autoPaused: count >= 6,
        reputationPenalty: count >= 6 ? CRITICAL_REPUTATION_PENALTY : -10,
        createdAt: new Date(),
      };
      alertStore.push(alert);
      return alert;
    }
  }

  return null;
}

/**
 * Detect wash trading: agent transacts with itself via intermediary.
 * Simplified: looks for A→B→A patterns where A is the profiled agent.
 */
export function detectWashTrading(profile: AgentBehaviorProfile): BehaviorAlert | null {
  const txs = profile.recentTransactions;
  const agentId = profile.agentId;

  // Find transactions where agent sends, then receives back from the same counterparty
  const outgoing = txs.filter((t) => t.from === agentId);
  const incoming = txs.filter((t) => t.to === agentId);

  for (const out of outgoing) {
    const matchingReturn = incoming.find(
      (inc) => inc.from === out.to && inc.timestamp > out.timestamp,
    );
    if (matchingReturn) {
      const alert: BehaviorAlert = {
        id: generateAlertId(),
        agentId,
        alertType: 'WASH_TRADING',
        severity: 'high',
        description: `Suspected wash trading: ${agentId} → ${out.to} → ${agentId}`,
        autoPaused: false,
        reputationPenalty: HIGH_REPUTATION_PENALTY,
        createdAt: new Date(),
      };
      alertStore.push(alert);
      return alert;
    }
  }

  return null;
}

/**
 * Detect rapid escalation: 3+ disputes in a 24-hour window.
 */
export function detectRapidEscalation(
  agentId: string,
  disputeTimestamps: Date[],
): BehaviorAlert | null {
  if (disputeTimestamps.length < RAPID_ESCALATION_COUNT) return null;

  // Sort newest first
  const sorted = [...disputeTimestamps].sort((a, b) => b.getTime() - a.getTime());

  for (let i = 0; i <= sorted.length - RAPID_ESCALATION_COUNT; i++) {
    const windowStart = sorted[i].getTime();
    const windowEnd = sorted[i + RAPID_ESCALATION_COUNT - 1].getTime();
    if (windowStart - windowEnd <= RAPID_ESCALATION_WINDOW_MS) {
      const alert: BehaviorAlert = {
        id: generateAlertId(),
        agentId,
        alertType: 'RAPID_ESCALATION',
        severity: 'critical',
        description: `${RAPID_ESCALATION_COUNT}+ disputes within 24 hours`,
        autoPaused: true,
        reputationPenalty: CRITICAL_REPUTATION_PENALTY,
        createdAt: new Date(),
      };
      alertStore.push(alert);
      return alert;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Get all alerts for a specific agent.
 */
export function getAlertsForAgent(agentId: string): BehaviorAlert[] {
  return alertStore.filter((a) => a.agentId === agentId);
}

/**
 * Get all critical alerts (for admin review).
 */
export function getCriticalAlerts(): BehaviorAlert[] {
  return alertStore.filter((a) => a.severity === 'critical');
}
