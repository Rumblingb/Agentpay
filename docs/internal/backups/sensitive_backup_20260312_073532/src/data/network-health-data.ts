// PRODUCTION FIX — NETWORK HEALTH DATA
// Shared TVS (Total Value Secured) mock data used by the NetworkHealthChart
// component and backend tests. Extracted into a plain .ts file so Jest can
// import it without needing a JSX transform.

/** Single TVS time-series data point. */
export interface TvsDataPoint {
  name: string;
  tvs: number;
}

/**
 * Default TVS mock data — mirrors the current 40 txs / $454 baseline.
 * Replace with live data from /api/stats in production.
 */
export const DEFAULT_TVS_DATA: TvsDataPoint[] = [
  { name: 'Feb 20', tvs: 120 },
  { name: 'Feb 25', tvs: 280 },
  { name: 'Mar 01', tvs: 410 },
  { name: 'Mar 04', tvs: 454 },
];
