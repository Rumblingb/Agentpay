import { fetchFxRate } from './api';

const RATE_TTL_MS = 60 * 60 * 1000;

const rateCache = new Map<string, { rate: number; ts: number }>();

export async function fetchRate(from: string, to: string): Promise<number | null> {
  const fromCode = from.trim().toLowerCase();
  const toCode = to.trim().toLowerCase();

  if (!fromCode || !toCode) return null;
  if (fromCode === toCode) return 1;

  const cacheKey = `${fromCode}:${toCode}`;
  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RATE_TTL_MS) {
    return cached.rate;
  }

  try {
    const rate = await fetchFxRate(fromCode, toCode);
    if (typeof rate !== 'number') return null;

    rateCache.set(cacheKey, { rate, ts: Date.now() });
    return rate;
  } catch {
    return null;
  }
}
