/**
 * Reconciliation Daemon
 *
 * Runs the financial reconciliation service on a configurable schedule
 * (default: every 15 minutes). Detects anomalies such as stale payments,
 * unmatched on-chain transactions, and escrow timeouts, then delegates
 * handling to an optional caller-supplied callback.
 *
 * @module services/reconciliationDaemon
 */

import { runReconciliation, getLastReport, type ReconciliationAnomaly } from './reconciliationService.js';
import { logger } from '../logger.js';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export interface DaemonConfig {
  /** How often to run reconciliation (ms). Defaults to 15 minutes. */
  intervalMs?: number;
  /** Called for each anomaly found during a reconciliation run. */
  onAnomaly?: (anomaly: ReconciliationAnomaly) => void;
}

let daemonTimer: ReturnType<typeof setInterval> | null = null;

async function tick(onAnomaly?: (anomaly: ReconciliationAnomaly) => void): Promise<void> {
  try {
    const report = await runReconciliation();
    logger.info(
      {
        runId: report.runId,
        durationMs: report.durationMs,
        anomaliesFound: report.stats.anomaliesFound,
        criticalAnomalies: report.stats.criticalAnomalies,
      },
      'Reconciliation run complete',
    );

    if (onAnomaly && report.anomalies.length > 0) {
      for (const anomaly of report.anomalies) {
        try {
          onAnomaly(anomaly);
        } catch (cbErr) {
          logger.error({ err: cbErr }, 'onAnomaly callback threw an error');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Reconciliation daemon tick failed');
  }
}

/**
 * Start the reconciliation daemon.
 * No-op if the daemon is already running.
 */
export function startReconciliationDaemon(config?: DaemonConfig): void {
  if (daemonTimer !== null) {
    logger.warn('Reconciliation daemon is already running — skipping start');
    return;
  }

  const intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const onAnomaly = config?.onAnomaly as ((anomaly: ReconciliationAnomaly) => void) | undefined;

  logger.info({ intervalMs }, 'Starting reconciliation daemon');

  daemonTimer = setInterval(() => {
    void tick(onAnomaly);
  }, intervalMs);

  // Allow Node.js to exit even if the timer is still pending.
  if (daemonTimer.unref) {
    daemonTimer.unref();
  }
}

/**
 * Stop the reconciliation daemon.
 * No-op if the daemon is not running.
 */
export function stopReconciliationDaemon(): void {
  if (daemonTimer === null) {
    return;
  }
  clearInterval(daemonTimer);
  daemonTimer = null;
  logger.info('Reconciliation daemon stopped');
}

/** Returns true if the daemon is currently running. */
export function isDaemonRunning(): boolean {
  return daemonTimer !== null;
}

export { getLastReport };
