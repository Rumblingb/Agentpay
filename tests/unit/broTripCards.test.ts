import { deriveProactiveCards, type TripContext } from '../../packages/bro-trip/index';

describe('deriveProactiveCards', () => {
  it('adds hotel check-in and checkout cards near a stay window', () => {
    const trip: TripContext = {
      version: 1,
      mode: 'hotel',
      phase: 'booked',
      status: 'active',
      title: 'Rome stay',
      destination: 'Rome',
      departureTime: '2026-03-28T20:00:00.000Z',
      arrivalTime: '2026-03-29T06:00:00.000Z',
      legs: [
        {
          id: 'hotel-leg',
          mode: 'hotel',
          label: 'Hotel Forum',
          destination: 'Rome',
          departureTime: '2026-03-28T20:00:00.000Z',
          arrivalTime: '2026-03-29T06:00:00.000Z',
          status: 'booked',
        },
      ],
    };

    const cards = deriveProactiveCards(trip, '2026-03-28T12:00:00.000Z');

    expect(cards.some((card) => card.kind === 'check_in' && /Hotel check-in/.test(card.title))).toBe(true);
    expect(cards.some((card) => card.kind === 'hotel_checkout')).toBe(true);
  });
});
