/**
 * Public merchant identifiers and API keys.
 *
 * Live docs and Cursor snippets advertise:
 *   merchantId: mer_<uuid>
 *   apiKey:     apk_<64 hex>
 *
 * The database still stores the raw UUID in merchants.id. key_prefix is the
 * first 8 characters of the public apiKey so auth can look the row up.
 * The PBKDF2 hash is derived from the full public apiKey (including apk_).
 */

export const MERCHANT_ID_PREFIX = 'mer_';
export const MERCHANT_API_KEY_PREFIX = 'apk_';

export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateMerchantApiKey(): { apiKey: string; keyPrefix: string } {
  const apiKey = `${MERCHANT_API_KEY_PREFIX}${randomHex(32)}`;
  return {
    apiKey,
    keyPrefix: apiKey.slice(0, 8),
  };
}

export function formatPublicMerchantId(id: string): string {
  return id.startsWith(MERCHANT_ID_PREFIX) ? id : `${MERCHANT_ID_PREFIX}${id}`;
}

export function parsePublicMerchantId(id: string): string {
  return id.startsWith(MERCHANT_ID_PREFIX) ? id.slice(MERCHANT_ID_PREFIX.length) : id;
}

export function isPublicMerchantApiKey(apiKey: string): boolean {
  return apiKey.startsWith(MERCHANT_API_KEY_PREFIX) && apiKey.length > MERCHANT_API_KEY_PREFIX.length;
}
