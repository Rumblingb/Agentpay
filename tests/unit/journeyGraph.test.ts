import { buildJourneyGraph } from '../../apps/api-edge/src/lib/journeyGraph';

describe('buildJourneyGraph', () => {
  it('returns completed status when all legs are complete', () => {
    const graph = buildJourneyGraph([
      {
        jobId: 'leg-1',
        status: 'completed',
        mode: 'rail',
        label: 'Train to Leeds',
        from: 'London',
        to: 'Leeds',
      },
      {
        jobId: 'leg-2',
        status: 'completed',
        mode: 'hotel',
        label: 'Hotel stay',
        from: 'Leeds',
        to: 'Leeds',
      },
    ], 'completed');

    expect(graph.status).toBe('completed');
    expect(graph.completedLegs).toBe(2);
    expect(graph.nextLegId).toBeUndefined();
  });

  it('surfaces the next incomplete leg', () => {
    const graph = buildJourneyGraph([
      {
        jobId: 'leg-1',
        status: 'completed',
        mode: 'rail',
        label: 'Train to airport',
        from: 'London',
        to: 'Heathrow',
      },
      {
        jobId: 'leg-2',
        status: 'booked',
        mode: 'flight',
        label: 'Flight to NYC',
        from: 'LHR',
        to: 'JFK',
      },
    ], 'pending');

    expect(graph.nextLegId).toBe('leg-2');
    expect(graph.changes.some((change) => change.title === 'What is next')).toBe(true);
  });
});
