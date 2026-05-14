export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN',
] as const;
export type CurrencyCode = typeof CURRENCIES[number];

export interface CurrencyMeta {
  symbol: string;
  name: string;
  decimals: number;      // summary display (cards, charts)
  detailDecimals: number; // table rows where amounts are small
}

export const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  USD: { symbol: '$',    name: 'US Dollar',        decimals: 2, detailDecimals: 4 },
  EUR: { symbol: '€',    name: 'Euro',             decimals: 2, detailDecimals: 4 },
  GBP: { symbol: '£',    name: 'British Pound',    decimals: 2, detailDecimals: 4 },
  JPY: { symbol: '¥',    name: 'Japanese Yen',     decimals: 0, detailDecimals: 2 },
  CAD: { symbol: 'CA$',  name: 'Canadian Dollar',  decimals: 2, detailDecimals: 4 },
  AUD: { symbol: 'A$',   name: 'Australian Dollar',decimals: 2, detailDecimals: 4 },
  CHF: { symbol: 'Fr ',  name: 'Swiss Franc',      decimals: 2, detailDecimals: 4 },
  CNY: { symbol: '¥',    name: 'Chinese Yuan',     decimals: 2, detailDecimals: 4 },
  INR: { symbol: '₹',    name: 'Indian Rupee',     decimals: 0, detailDecimals: 2 },
  MXN: { symbol: 'MX$',  name: 'Mexican Peso',     decimals: 2, detailDecimals: 4 },
};

export function convertUsd(usd: number, currency: CurrencyCode, rates: Record<string, number>): number {
  return usd * (rates[currency] ?? 1);
}

export function formatCostSummary(usd: number, currency: CurrencyCode, rates: Record<string, number>): string {
  const meta = CURRENCY_META[currency];
  return `${meta.symbol}${convertUsd(usd, currency, rates).toFixed(meta.decimals)}`;
}

export function formatCostDetail(usd: number, currency: CurrencyCode, rates: Record<string, number>): string {
  const meta = CURRENCY_META[currency];
  return `${meta.symbol}${convertUsd(usd, currency, rates).toFixed(meta.detailDecimals)}`;
}
