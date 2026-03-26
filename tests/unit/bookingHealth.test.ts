import { deriveBookingHealth } from '../../apps/api-edge/src/lib/bookingHealth';

describe('deriveBookingHealth', () => {
  it('flags payment_confirmed jobs as ready_for_dispatch when stale', () => {
    const metadata = {
      paymentConfirmed: true,
      paymentConfirmedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };

    const result = deriveBookingHealth('confirmed', metadata);

    expect(result.recoveryBucket).toBe('ready_for_dispatch');
    expect(result.shouldEscalate).toBe(true);
  });

  it('flags securing jobs as stuck_securing when dispatch is stale', () => {
    const metadata = {
      paymentConfirmed: true,
      openclawDispatched: true,
      openclawDispatchedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    };

    const result = deriveBookingHealth('confirmed', metadata);

    expect(result.recoveryBucket).toBe('stuck_securing');
    expect(result.shouldEscalate).toBe(true);
  });

  it('treats issued bookings as healthy terminal success', () => {
    const result = deriveBookingHealth('completed', { bookingState: 'issued' });

    expect(result.recoveryBucket).toBe('issued');
    expect(result.shouldEscalate).toBe(false);
  });
});
