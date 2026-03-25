const RATE_TTL_MS = 60 * 60 * 1000;

const rateCache = new Map<string, { rate: number; ts: number }>();

interface CurrencyApiResponse {
  [baseCurrency: string]: Record<string, number> | string;
}

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
    const response = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${fromCode}.json`,
    );
    if (!response.ok) return null;

    const payload = await response.json() as CurrencyApiResponse;
    const rates = payload[fromCode];
    if (!rates || typeof rates === 'string') return null;

    const rate = rates[toCode];
    if (typeof rate !== 'number') return null;

    rateCache.set(cacheKey, { rate, ts: Date.now() });
    return rate;
  } catch {
    return null;
  }
}
