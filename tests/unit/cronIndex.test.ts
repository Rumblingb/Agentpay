jest.mock('../../apps/api-edge/src/cron/liquidity', () => ({
  runLiquidityCron: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../apps/api-edge/src/cron/platformWatch', () => ({
  runPlatformWatch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../apps/api-edge/src/cron/flightWatch', () => ({
  runFlightWatch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../apps/api-edge/src/cron/reconciliation', () => ({
  runReconciliation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../apps/api-edge/src/cron/bookingRecovery', () => ({
  runBookingRecoveryCron: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../apps/api-edge/src/cron/mondayPattern', () => ({
  runMondayPattern: jest.fn().mockResolvedValue(undefined),
}));

import { scheduledHandler } from '../../apps/api-edge/src/cron';
import { runBookingRecoveryCron } from '../../apps/api-edge/src/cron/bookingRecovery';
import { runFlightWatch } from '../../apps/api-edge/src/cron/flightWatch';
import { runLiquidityCron } from '../../apps/api-edge/src/cron/liquidity';
import { runMondayPattern } from '../../apps/api-edge/src/cron/mondayPattern';
import { runPlatformWatch } from '../../apps/api-edge/src/cron/platformWatch';
import { runReconciliation } from '../../apps/api-edge/src/cron/reconciliation';

describe('scheduledHandler', () => {
  it('runs liquidity and disruption watches on the 5-minute cron', async () => {
    const waitUntil = jest.fn();
    await scheduledHandler({ cron: '*/5 * * * *' } as ScheduledEvent, {} as never, { waitUntil } as ExecutionContext);

    expect(runLiquidityCron).toHaveBeenCalled();
    expect(runPlatformWatch).toHaveBeenCalled();
    expect(runFlightWatch).toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(3);
  });

  it('runs reconciliation and booking recovery on the 15-minute cron', async () => {
    const waitUntil = jest.fn();
    await scheduledHandler({ cron: '*/15 * * * *' } as ScheduledEvent, {} as never, { waitUntil } as ExecutionContext);

    expect(runReconciliation).toHaveBeenCalled();
    expect(runBookingRecoveryCron).toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });

  it('runs the monday pattern job on the weekly cron', async () => {
    const waitUntil = jest.fn();
    await scheduledHandler({ cron: '0 9 * * 1' } as ScheduledEvent, {} as never, { waitUntil } as ExecutionContext);

    expect(runMondayPattern).toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
