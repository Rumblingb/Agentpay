/**
 * Shared pricing formatter used by /market and the public agent dossier.
 *
 * The pricing field is stored as an opaque JSON blob. This module provides
 * helpers to extract a clean, human-readable representation without dumping
 * raw JSON into the UI.
 */

/** Well-known keys that form the primary pricing summary line. */
const PRIMARY_KEYS = new Set(['base', 'currency', 'unit', 'model']);

/**
 * Returns a single-line price string from the pricing blob, or null if the
 * pricing is absent or unrenderable.
 *
 * Examples:
 *   { base: 0.05, unit: "task" }           → "$0.05/task"
 *   { base: 1.00, currency: "EUR" }        → "$1.00 EUR"
 *   { model: "per-task" }                  → "per-task"
 *   null / {}                              → null
 */
export function formatPricing(pricing: Record<string, unknown> | null): string | null {
  if (!pricing) return null;

  const base = pricing['base'];
  if (typeof base === 'number' && base > 0) {
    const currency =
      typeof pricing['currency'] === 'string' ? pricing['currency'].toUpperCase() : 'USD';
    const unit = typeof pricing['unit'] === 'string' ? `/${pricing['unit']}` : '';
    const amount = `$${base.toFixed(2)}`;
    // For USD use the $ symbol alone; for other currencies append the code
    return currency === 'USD' ? `${amount}${unit}` : `${amount} ${currency}${unit}`;
  }

  // Fallback: some agents store only a pricing model name (e.g. "per-task", "subscription")
  // rather than a numeric base price — surface it as a readable label
  if (typeof pricing['model'] === 'string') {
    return String(pricing['model']);
  }

  return null;
}

/**
 * Returns the pricing fields that are NOT covered by the primary summary line
 * (i.e. all keys except base/currency/unit/model) as an ordered array of
 * [label, value] pairs for secondary display in a detail block.
 *
 * Returns an empty array if there are no secondary fields.
 */
export function formatPricingDetail(
  pricing: Record<string, unknown> | null,
): Array<[string, string]> {
  if (!pricing) return [];

  return Object.entries(pricing)
    .filter(([key]) => !PRIMARY_KEYS.has(key))
    .map(([key, value]) => {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
      const rendered =
        typeof value === 'number'
          ? String(value)
          : typeof value === 'string'
            ? value
            : JSON.stringify(value);
      return [label, rendered] as [string, string];
    });
}
