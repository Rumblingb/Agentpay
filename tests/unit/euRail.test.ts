import { formatEuTrainsForClaude, isEuRoute, normaliseEuStation, queryEuRail } from '../../apps/api-edge/src/lib/euRail';

describe('euRail', () => {
  it('normalises major EU stations and detects EU routes', () => {
    expect(normaliseEuStation('paris')).toBe('Paris Gare du Nord');
    expect(normaliseEuStation('rome')).toBe('Roma Termini');
    expect(isEuRoute('Bristol', 'Rome')).toBe(true);
    expect(isEuRoute('Derby', 'Leeds')).toBe(false);
  });

  it('falls back to scheduled services when no live partner keys are configured', async () => {
    const result = await queryEuRail({} as any, 'Paris', 'Lyon', 'tomorrow', 'standard', 'morning');

    expect(result.origin).toBe('Paris Gare du Nord');
    expect(result.destination).toBe('Lyon Part-Dieu');
    expect(result.currency).toBe('EUR');
    expect(result.services.length).toBeGreaterThan(0);
    expect(result.error).toBe('advance_schedule');
    expect(result.services[0]?.operator).toContain('SNCF');
  });

  it('formats EU rail results with indicative note and euro fares', async () => {
    const result = await queryEuRail({} as any, 'Paris', 'Amsterdam', 'tomorrow');
    const formatted = formatEuTrainsForClaude(result);

    expect(formatted).toContain('EU Rail: Paris Gare du Nord');
    expect(formatted).toContain('Indicative schedule');
    expect(formatted).toContain('€');
  });
});
