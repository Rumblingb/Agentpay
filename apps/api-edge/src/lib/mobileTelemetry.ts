import { parseJsonb, type Sql } from './db';

export type MobileTelemetrySeverity = 'info' | 'warning' | 'error';

export interface MobileTelemetryInput {
  event: string;
  severity?: MobileTelemetrySeverity;
  screen: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  userAgent?: string | null;
}

export interface MobileTelemetryAlert {
  createdAt: string;
  event: string;
  severity: MobileTelemetrySeverity;
  screen: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
}

export interface MobileTelemetrySummary {
  windowHours: number;
  totals: {
    events: number;
    warnings: number;
    errors: number;
    screens: number;
  };
  funnel: {
    voiceCaptureStarted: number;
    voiceTranscribed: number;
    sttFailures: number;
    sttSuccessRate: number | null;
    planRequested: number;
    planReceived: number;
    planFailed: number;
    planSuccessRate: number | null;
    confirmShown: number;
    confirmApproved: number;
    confirmAutoApproved: number;
    confirmApprovalRate: number | null;
    executeStarted: number;
    executeSucceeded: number;
    executeFailed: number;
    executionSuccessRate: number | null;
  };
  recovery: {
    paymentRecoveryOpened: number;
    paymentRecoveryChecked: number;
    paymentRecoveryFailed: number;
    rerouteOfferAvailable: number;
    rerouteOfferViewed: number;
    rerouteOfferAccepted: number;
    rerouteAcceptanceRate: number | null;
    walletAvailable: number;
    walletOpened: number;
    walletOpenFailed: number;
    walletOpenRate: number | null;
    supportOpened: number;
    supportRequested: number;
    supportRequestFailed: number;
    notificationsOpened: number;
  };
  voice: {
    ttsPlayed: number;
    ttsFailed: number;
    ttsFallbackSystem: number;
  };
  topEvents: Array<{ event: string; count: number }>;
  screenCounts: Array<{ screen: string; count: number }>;
  recentAlerts: MobileTelemetryAlert[];
  eventCounts: Record<string, number>;
}

const ALERT_EVENTS = new Set<string>([
  'execute_failed',
  'execute_returned_no_actions',
  'payment_recovery_failed',
  'wallet_open_failed',
  'tts_failed',
  'stt_transcription_failed',
  'stt_empty_transcript',
  'voice_capture_failed',
  'voice_permission_denied',
  'support_requested',
  'support_request_failed',
]);

function clampWindowHours(windowHours?: number): number {
  if (!Number.isFinite(windowHours)) {
    return 24;
  }
  return Math.min(168, Math.max(1, Math.round(windowHours ?? 24)));
}

function toRate(numerator: number, denominator: number): number | null {
  if (!denominator) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

function count(eventCounts: Map<string, number>, event: string): number {
  return eventCounts.get(event) ?? 0;
}

export function shouldAlertOnMobileTelemetry(
  event: string,
  severity: MobileTelemetrySeverity = 'info',
): boolean {
  return severity === 'error' || ALERT_EVENTS.has(event);
}

export async function ensureMobileTelemetryTable(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS bro_mobile_telemetry (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      screen TEXT NOT NULL,
      message TEXT NULL,
      metadata JSONB NULL,
      user_agent TEXT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS bro_mobile_telemetry_created_at_idx
    ON bro_mobile_telemetry (created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS bro_mobile_telemetry_event_idx
    ON bro_mobile_telemetry (event, created_at DESC)
  `;
}

export async function recordMobileTelemetry(sql: Sql, input: MobileTelemetryInput): Promise<void> {
  await ensureMobileTelemetryTable(sql);

  await sql`
    INSERT INTO bro_mobile_telemetry (
      event,
      severity,
      screen,
      message,
      metadata,
      user_agent
    ) VALUES (
      ${input.event},
      ${input.severity ?? 'info'},
      ${input.screen},
      ${input.message ?? null},
      ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb,
      ${input.userAgent ?? null}
    )
  `;
}

export async function summarizeMobileTelemetry(sql: Sql, windowHours = 24): Promise<MobileTelemetrySummary> {
  const safeWindowHours = clampWindowHours(windowHours);
  await ensureMobileTelemetryTable(sql);

  const [totalsRow] = await sql<{
    total: number | string;
    warnings: number | string;
    errors: number | string;
    screens: number | string;
  }[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE severity = 'warning')::int AS warnings,
      COUNT(*) FILTER (WHERE severity = 'error')::int AS errors,
      COUNT(DISTINCT screen)::int AS screens
    FROM bro_mobile_telemetry
    WHERE created_at > NOW() - (${safeWindowHours} * INTERVAL '1 hour')
  `;

  const eventRows = await sql<{
    event: string;
    count: number | string;
  }[]>`
    SELECT event, COUNT(*)::int AS count
    FROM bro_mobile_telemetry
    WHERE created_at > NOW() - (${safeWindowHours} * INTERVAL '1 hour')
    GROUP BY event
    ORDER BY count DESC, event ASC
  `;

  const screenRows = await sql<{
    screen: string;
    count: number | string;
  }[]>`
    SELECT screen, COUNT(*)::int AS count
    FROM bro_mobile_telemetry
    WHERE created_at > NOW() - (${safeWindowHours} * INTERVAL '1 hour')
    GROUP BY screen
    ORDER BY count DESC, screen ASC
  `;

  const recentRows = await sql<{
    created_at: string;
    event: string;
    severity: MobileTelemetrySeverity;
    screen: string;
    message: string | null;
    metadata: unknown;
  }[]>`
    SELECT created_at, event, severity, screen, message, metadata
    FROM bro_mobile_telemetry
    WHERE created_at > NOW() - (${safeWindowHours} * INTERVAL '1 hour')
    ORDER BY created_at DESC
    LIMIT 120
  `;

  const eventCounts = new Map<string, number>(
    eventRows.map((row) => [row.event, Number(row.count) || 0]),
  );

  const voiceCaptureStarted = count(eventCounts, 'voice_capture_started');
  const voiceTranscribed = count(eventCounts, 'voice_transcribed');
  const sttFailures = count(eventCounts, 'stt_transcription_failed') + count(eventCounts, 'stt_empty_transcript');
  const planRequested = count(eventCounts, 'plan_requested');
  const planReceived = count(eventCounts, 'plan_received');
  const planFailed = count(eventCounts, 'plan_failed');
  const confirmShown = count(eventCounts, 'confirm_shown');
  const confirmApproved = count(eventCounts, 'confirm_approved');
  const confirmAutoApproved = count(eventCounts, 'confirm_auto_approved');
  const executeStarted = count(eventCounts, 'execute_started');
  const executeSucceeded = count(eventCounts, 'execute_succeeded');
  const executeFailed = count(eventCounts, 'execute_failed') + count(eventCounts, 'execute_returned_no_actions');

  const paymentRecoveryOpened = count(eventCounts, 'payment_recovery_opened');
  const paymentRecoveryChecked = count(eventCounts, 'payment_recovery_checked');
  const paymentRecoveryFailed = count(eventCounts, 'payment_recovery_failed');
  const rerouteOfferAvailable = count(eventCounts, 'reroute_offer_available');
  const rerouteOfferViewed = count(eventCounts, 'reroute_offer_viewed');
  const rerouteOfferAccepted = count(eventCounts, 'reroute_offer_accepted');
  const walletAvailable = count(eventCounts, 'wallet_available');
  const walletOpened = count(eventCounts, 'wallet_opened');
  const walletOpenFailed = count(eventCounts, 'wallet_open_failed');
  const supportOpened = count(eventCounts, 'support_opened');
  const supportRequested = count(eventCounts, 'support_requested');
  const supportRequestFailed = count(eventCounts, 'support_request_failed');
  const notificationsOpened = count(eventCounts, 'notification_opened');

  const ttsPlayed = count(eventCounts, 'tts_played');
  const ttsFailed = count(eventCounts, 'tts_failed');
  const ttsFallbackSystem = count(eventCounts, 'tts_fallback_system');

  const recentAlerts = recentRows
    .filter((row) => shouldAlertOnMobileTelemetry(row.event, row.severity) || row.severity === 'warning')
    .slice(0, 25)
    .map((row) => ({
      createdAt: row.created_at,
      event: row.event,
      severity: row.severity,
      screen: row.screen,
      message: row.message,
      metadata: parseJsonb<Record<string, unknown> | null>(row.metadata, null),
    }));

  return {
    windowHours: safeWindowHours,
    totals: {
      events: Number(totalsRow?.total ?? 0),
      warnings: Number(totalsRow?.warnings ?? 0),
      errors: Number(totalsRow?.errors ?? 0),
      screens: Number(totalsRow?.screens ?? 0),
    },
    funnel: {
      voiceCaptureStarted,
      voiceTranscribed,
      sttFailures,
      sttSuccessRate: toRate(voiceTranscribed, voiceCaptureStarted),
      planRequested,
      planReceived,
      planFailed,
      planSuccessRate: toRate(planReceived, planRequested),
      confirmShown,
      confirmApproved,
      confirmAutoApproved,
      confirmApprovalRate: toRate(confirmApproved + confirmAutoApproved, confirmShown + confirmAutoApproved),
      executeStarted,
      executeSucceeded,
      executeFailed,
      executionSuccessRate: toRate(executeSucceeded, executeStarted),
    },
    recovery: {
      paymentRecoveryOpened,
      paymentRecoveryChecked,
      paymentRecoveryFailed,
      rerouteOfferAvailable,
      rerouteOfferViewed,
      rerouteOfferAccepted,
      rerouteAcceptanceRate: toRate(rerouteOfferAccepted, rerouteOfferAvailable),
      walletAvailable,
      walletOpened,
      walletOpenFailed,
      walletOpenRate: toRate(walletOpened, walletAvailable),
      supportOpened,
      supportRequested,
      supportRequestFailed,
      notificationsOpened,
    },
    voice: {
      ttsPlayed,
      ttsFailed,
      ttsFallbackSystem,
    },
    topEvents: eventRows.slice(0, 12).map((row) => ({
      event: row.event,
      count: Number(row.count) || 0,
    })),
    screenCounts: screenRows.map((row) => ({
      screen: row.screen,
      count: Number(row.count) || 0,
    })),
    recentAlerts,
    eventCounts: Object.fromEntries(eventRows.map((row) => [row.event, Number(row.count) || 0])),
  };
}
