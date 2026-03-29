import { logClientTelemetry } from './api';

export async function trackClientEvent(params: {
  event: string;
  screen: string;
  severity?: 'info' | 'warning' | 'error';
  message?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await logClientTelemetry(params).catch(() => {});
}
