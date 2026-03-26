import { rankFlightsByMemory, rankHotelsByMemory } from '../../apps/api-edge/src/lib/customerMemory';

describe('customer memory ranking', () => {
  it('prefers the historical carrier on the usual route', () => {
    const ranked = rankFlightsByMemory(
      [
        {
          carrier: 'Other Air',
          stops: 0,
          totalAmount: 120,
          origin: 'LHR',
          destination: 'JFK',
        },
        {
          carrier: 'British Airways',
          stops: 1,
          totalAmount: 130,
          origin: 'LHR',
          destination: 'JFK',
        },
      ] as never,
      {
        preferredCarrier: 'british airways',
        usualRoute: { origin: 'LHR', destination: 'JFK', count: 3 },
      },
      { origin: 'LHR', destination: 'JFK' },
    );

    expect(ranked[0]?.carrier).toBe('British Airways');
  });

  it('prefers the saved hotel area in the requested city', () => {
    const ranked = rankHotelsByMemory(
      [
        { name: 'Budget Central', area: 'Paddington', ratePerNight: 160 },
        { name: 'Preferred Stay', area: 'Soho', ratePerNight: 180 },
      ] as never,
      {
        preferredHotelArea: 'soho',
        preferredHotelCity: 'london',
      },
      { city: 'London' },
    );

    expect(ranked[0]?.name).toBe('Preferred Stay');
  });
});
