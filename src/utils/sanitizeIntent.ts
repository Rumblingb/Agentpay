/**
 * Strips sensitive fields from a payment intent before returning it to
 * public-facing endpoints such as the receipt viewer.
 *
 * Removed fields:
 *   - verificationToken  — internal proof-of-payment token
 *   - metadata.internal  — merchant-private metadata
 *   - merchant.walletAddress — financial routing detail
 *   - merchant.apiKeyHash    — credential hash
 */
export function sanitizeIntent(intent: Record<string, any>): Record<string, any> {
  const sanitized = { ...intent };

  delete sanitized.verificationToken;

  if (sanitized.metadata && typeof sanitized.metadata === 'object') {
    const meta = { ...sanitized.metadata };
    delete meta.internal;
    sanitized.metadata = meta;
  }

  if (sanitized.merchant && typeof sanitized.merchant === 'object') {
    const merchant = { ...sanitized.merchant };
    delete merchant.walletAddress;
    delete merchant.apiKeyHash;
    sanitized.merchant = merchant;
  }

  return sanitized;
}
