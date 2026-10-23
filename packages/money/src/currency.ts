import { MoneyError } from './errors';

/**
 * ISO 4217 minor-unit exponents for the currencies we accept.
 * Values follow the ISO table, even where everyday usage differs (e.g. IDR, HUF).
 */
const EXPONENTS = {
  AED: 2, AUD: 2, BDT: 2, BRL: 2, CAD: 2, CHF: 2, CNY: 2, CZK: 2, DKK: 2, EUR: 2,
  GBP: 2, HKD: 2, HUF: 2, IDR: 2, INR: 2, LKR: 2, MVR: 2, MXN: 2, MYR: 2, NOK: 2,
  NPR: 2, NZD: 2, PHP: 2, PLN: 2, QAR: 2, SAR: 2, SEK: 2, SGD: 2, THB: 2, TRY: 2,
  USD: 2, ZAR: 2,
  CLP: 0, ISK: 0, JPY: 0, KRW: 0, VND: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
} as const;

export type CurrencyCode = keyof typeof EXPONENTS;

export const SUPPORTED_CURRENCIES = Object.keys(EXPONENTS) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(EXPONENTS, value);
}

export function assertCurrency(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new MoneyError('unknown_currency', `Unsupported currency: ${value}`);
  }
  return value;
}

/** Number of decimal places in one major unit (INR → 2, JPY → 0, KWD → 3). */
export function exponentOf(currency: CurrencyCode): number {
  return EXPONENTS[currency];
}
