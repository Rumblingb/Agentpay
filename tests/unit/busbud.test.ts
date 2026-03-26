import { formatBusForClaude, isBusRoute, queryBus } from '../../apps/api-edge/src/lib/busbud';

describe('busbud', () => {
  it('recognises supported intercity bus corridors', () => {
    expect(isBusRoute('London', 'Bristol')).toBe(true);
    expect(isBusRoute('Bangkok', 'Chiang Mai')).toBe(true);
    expect(isBusRoute('Derby', 'Unknownville')).toBe(false);
  });

  it('returns scheduled services when no partner keys are configured', async () => {
    const result = await queryBus({} as any, 'London', 'Bristol', 'tomorrow', 'standard', 'morning');

    expect(result.origin).toBe('London Victoria Coach');
    expect(result.destination).toBe('Bristol Bus Station');
    expect(result.region).toBe('uk');
    expect(result.currency).toBe('GBP');
    expect(result.dataSource).toBe('bus_scheduled');
    expect(result.services.length).toBeGreaterThan(0);
  });

  it('formats bus schedules with data-source note and amenities', async () => {
    const result = await queryBus({} as any, 'Singapore', 'Kuala Lumpur', 'tomorrow');
    const formatted = formatBusForClaude(result);

    expect(formatted).toContain('Intercity Bus: Singapore Queen St Bus');
    expect(formatted).toContain('Indicative schedule');
    expect(formatted).toContain('AC');
  });
});
