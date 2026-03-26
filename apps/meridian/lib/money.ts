const ZERO_DECIMAL_CURRENCIES = new Set([
  'INR',
  'JPY',
  'KRW',
  'VND',
  'IDR',
]);

export function isZeroDecimalCurrency(code?: string | null): boolean {
  return !!code && ZERO_DECIMAL_CURRENCIES.has(code.toUpperCase());
}

export function formatMoneyAmount(amount: number, code?: string | null): string {
  const resolved = (code ?? 'GBP').toUpperCase();
  if (isZeroDecimalCurrency(resolved)) {
    if (resolved === 'INR') return Math.round(amount).toLocaleString('en-IN');
    return Math.round(amount).toLocaleString('en-US');
  }
  return amount.toFixed(2);
}

export function formatMoney(amount: number, symbol?: string | null, code?: string | null): string {
  return `${symbol ?? ''}${formatMoneyAmount(amount, code)}`;
}
