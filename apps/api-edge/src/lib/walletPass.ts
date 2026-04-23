import { hmacSign, hmacVerify } from './hmac';

const DEFAULT_WALLET_PASS_TTL_SECONDS = 60 * 60 * 24 * 30;

function trimApiBase(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

function walletPassPayload(intentId: string, exp: number): string {
  return `wallet-pass:v1:${intentId}:${exp}`;
}

export async function createWalletPassSignature(intentId: string, exp: number, secret: string): Promise<string> {
  return hmacSign(walletPassPayload(intentId, exp), secret);
}

export async function verifyWalletPassSignature(intentId: string, exp: number, sig: string, secret: string): Promise<boolean> {
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Date.now() > exp * 1000) return false;
  return hmacVerify(walletPassPayload(intentId, exp), sig, secret);
}

export async function createSignedWalletPassUrl(params: {
  apiBaseUrl: string;
  intentId: string;
  secret: string;
  ttlSeconds?: number;
}): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + (params.ttlSeconds ?? DEFAULT_WALLET_PASS_TTL_SECONDS);
  const sig = await createWalletPassSignature(params.intentId, exp, params.secret);
  const url = new URL(`${trimApiBase(params.apiBaseUrl)}/api/wallet/pass/${params.intentId}`);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return url.toString();
}

