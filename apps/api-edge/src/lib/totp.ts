/**
 * TOTP / HOTP implementation for Cloudflare Workers.
 * RFC 6238 (TOTP) via RFC 4226 (HOTP) using HMAC-SHA1.
 * Uses crypto.subtle only — no Node.js built-ins.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const enc = new TextEncoder();

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(bytes);
}

async function hotp(secretBase32: string, counter: bigint): Promise<number> {
  const keyBytes = base32Decode(secretBase32);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const counterBytes = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { counterBytes[i] = Number(c & 0xffn); c >>= 8n; }
  const sig = await crypto.subtle.sign('HMAC', key, counterBytes);
  const h = new Uint8Array(sig);
  const offset = h[19] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) |
               ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return code % 1_000_000;
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function totpCode(secretBase32: string, timestampMs?: number): Promise<string> {
  const ts = BigInt(Math.floor((timestampMs ?? Date.now()) / 1000 / 30));
  return (await hotp(secretBase32, ts)).toString().padStart(6, '0');
}

export async function verifyTotpCode(secretBase32: string, code: string, windowSteps = 1): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const now = BigInt(Math.floor(Date.now() / 1000 / 30));
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    if ((await hotp(secretBase32, now + BigInt(delta))).toString().padStart(6, '0') === code) return true;
  }
  return false;
}

export function buildOtpAuthUri(secretBase32: string, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function b64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}
async function importAesKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64urlDecode(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptTotpSecret(secret: string, encKeyBase64: string): Promise<string> {
  const key = await importAesKey(encKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret));
  return `${b64urlEncode(iv.buffer)}.${b64urlEncode(ciphertext)}`;
}

export async function decryptTotpSecret(encrypted: string, encKeyBase64: string): Promise<string> {
  const [ivPart, cipherPart] = encrypted.split('.');
  if (!ivPart || !cipherPart) throw new Error('Invalid encrypted secret format');
  const key = await importAesKey(encKeyBase64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(ivPart) }, key, b64urlDecode(cipherPart),
  );
  return new TextDecoder().decode(plain);
}
