import { queryBus, queryGlobalRail } from '../../apps/api-edge/src/lib/globalGround';

describe('globalGround', () => {
  it('normalises global rail fares into GBP rather than leaking local currency face values', async () => {
    const result = await queryGlobalRail({} as any, 'Tokyo', 'Osaka', 'tomorrow');

    expect(result.currency).toBe('GBP');
    expect(result.services.length).toBeGreaterThan(0);
    expect(result.services[0]?.estimatedFareGbp).toBeGreaterThan(10);
    expect(result.services[0]?.estimatedFareGbp).toBeLessThan(200);
  });

  it('normalises global bus fares into GBP rather than treating THB as GBP', async () => {
    const result = await queryBus({} as any, 'Bangkok', 'Chiang Mai', 'tomorrow');

    expect(result.currency).toBe('GBP');
    expect(result.services.length).toBeGreaterThan(0);
    expect(result.services[0]?.estimatedFareGbp).toBeGreaterThanOrEqual(1);
    expect(result.services[0]?.estimatedFareGbp).toBeLessThan(50);
  });
});
