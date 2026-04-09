import { logClientTelemetry } from './api';

const launchSessionId =
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `ace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const confirmApprovedAtByIntent = new Map<string, number>();

function enrichMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  return {
    session_id: launchSessionId,
    client_timestamp: new Date().toISOString(),
    ...(metadata ?? {}),
  };
}

export function getLaunchSessionId(): string {
  return launchSessionId;
}

export function rememberConfirmApproved(intentKey: string | null | undefined, approvedAt = Date.now()): void {
  const safeKey = intentKey?.trim();
  if (!safeKey) return;
  confirmApprovedAtByIntent.set(safeKey, approvedAt);
}

export function getRememberedConfirmApprovedAt(intentKey: string | null | undefined): number | null {
  const safeKey = intentKey?.trim();
  if (!safeKey) return null;
  return confirmApprovedAtByIntent.get(safeKey) ?? null;
}

export async function trackClientEvent(params: {
  event: string;
  screen: string;
  severity?: 'info' | 'warning' | 'error';
  message?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await logClientTelemetry({
    ...params,
    metadata: enrichMetadata(params.metadata),
  }).catch(() => {});
}
