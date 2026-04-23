/**
 * RCM Confidence Tuner
 *
 * Adaptively adjusts autonomy thresholds based on historical override rates.
 * Reads from rcm_vendor_metrics and records outcomes to improve auto-close accuracy.
 */

import type { Env } from '../types';
import { createDb } from './db';

export interface ConfidenceThresholds {
  autoClose: number;
  retry: number;
}

export const BASE_THRESHOLDS: ConfidenceThresholds = { autoClose: 80, retry: 60 };

export function computeAdjustedThresholds(
  totalAutoClosed: number,
  totalAutoCloseOverridden: number,
): ConfidenceThresholds {
  const overrideRate = totalAutoCloseOverridden / Math.max(totalAutoClosed, 1);
  let autoClose = BASE_THRESHOLDS.autoClose;

  if (overrideRate > 0.25) {
    autoClose = Math.min(92, autoClose + 10);
  } else if (overrideRate > 0.15) {
    autoClose = Math.min(92, autoClose + 5);
  } else if (overrideRate < 0.05 && totalAutoClosed >= 20) {
    autoClose = Math.max(75, autoClose - 2);
  }

  return { autoClose, retry: BASE_THRESHOLDS.retry };
}

export async function getAdjustedThresholds(env: Env, laneKey: string): Promise<ConfidenceThresholds> {
  const sql = createDb(env);
  try {
    const rows = await sql<Array<{ total: string | null; overridden: string | null }>>`
      SELECT
        SUM((score_payload->>'auto_close_total')::int)    AS total,
        SUM((score_payload->>'auto_close_overridden')::int) AS overridden
      FROM rcm_vendor_metrics
      WHERE period_start >= NOW() - INTERVAL '90 days'
        AND score_payload->>'lane_key' = ${laneKey}
    `;
    const row = rows[0];
    if (!row || row.total === null) return BASE_THRESHOLDS;
    return computeAdjustedThresholds(
      parseInt(row.total ?? '0', 10),
      parseInt(row.overridden ?? '0', 10),
    );
  } catch {
    return BASE_THRESHOLDS;
  } finally {
    await sql.end();
  }
}

export async function recordConnectorOutcome(
  env: Env,
  laneKey: string,
  connectorKey: string,
  outcome: 'auto_close_confirmed' | 'auto_close_overridden' | 'escalation_required',
): Promise<void> {
  const sql = createDb(env);
  try {
    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const periodStartStr = periodStart.toISOString();

    if (outcome === 'auto_close_confirmed') {
      await sql`
        INSERT INTO rcm_vendor_metrics (
          id, agent_id, period_start, period_end, score_payload, created_at, updated_at
        )
        VALUES (
          ${crypto.randomUUID()},
          ${'autonomy_loop'},
          ${periodStartStr},
          ${periodStartStr},
          ${JSON.stringify({ lane_key: laneKey, connector_key: connectorKey, auto_close_total: 1, auto_close_overridden: 0, escalation_total: 0 })}::jsonb,
          NOW(), NOW()
        )
        ON CONFLICT (agent_id, period_start)
        DO UPDATE SET
          score_payload = rcm_vendor_metrics.score_payload ||
            jsonb_build_object(
              'lane_key', ${laneKey},
              'connector_key', ${connectorKey},
              'auto_close_total', COALESCE((rcm_vendor_metrics.score_payload->>'auto_close_total')::int, 0) + 1
            ),
          updated_at = NOW()
      `;
    } else if (outcome === 'auto_close_overridden') {
      await sql`
        INSERT INTO rcm_vendor_metrics (
          id, agent_id, period_start, period_end, score_payload, created_at, updated_at
        )
        VALUES (
          ${crypto.randomUUID()},
          ${'autonomy_loop'},
          ${periodStartStr},
          ${periodStartStr},
          ${JSON.stringify({ lane_key: laneKey, connector_key: connectorKey, auto_close_total: 1, auto_close_overridden: 1, escalation_total: 0 })}::jsonb,
          NOW(), NOW()
        )
        ON CONFLICT (agent_id, period_start)
        DO UPDATE SET
          score_payload = rcm_vendor_metrics.score_payload ||
            jsonb_build_object(
              'lane_key', ${laneKey},
              'connector_key', ${connectorKey},
              'auto_close_total', COALESCE((rcm_vendor_metrics.score_payload->>'auto_close_total')::int, 0) + 1,
              'auto_close_overridden', COALESCE((rcm_vendor_metrics.score_payload->>'auto_close_overridden')::int, 0) + 1
            ),
          updated_at = NOW()
      `;
    } else {
      // escalation_required
      await sql`
        INSERT INTO rcm_vendor_metrics (
          id, agent_id, period_start, period_end, score_payload, created_at, updated_at
        )
        VALUES (
          ${crypto.randomUUID()},
          ${'autonomy_loop'},
          ${periodStartStr},
          ${periodStartStr},
          ${JSON.stringify({ lane_key: laneKey, connector_key: connectorKey, auto_close_total: 0, auto_close_overridden: 0, escalation_total: 1 })}::jsonb,
          NOW(), NOW()
        )
        ON CONFLICT (agent_id, period_start)
        DO UPDATE SET
          score_payload = rcm_vendor_metrics.score_payload ||
            jsonb_build_object(
              'lane_key', ${laneKey},
              'connector_key', ${connectorKey},
              'escalation_total', COALESCE((rcm_vendor_metrics.score_payload->>'escalation_total')::int, 0) + 1
            ),
          updated_at = NOW()
      `;
    }
  } catch (err) {
    console.warn('[rcm-confidence-tuner] recordConnectorOutcome failed:', err instanceof Error ? err.message : err);
  } finally {
    await sql.end();
  }
}
