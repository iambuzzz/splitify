import { type CurrencyCode, exponentOf } from './currency';
import { MoneyError } from './errors';

/** Upper bound for a single amount in minor units (₹1,000,00,00,000.00 for INR). */
export const MAX_MINOR = 10n ** 12n;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parses a user-entered decimal string ("1234.5") into minor units.
 * Rejects more decimals than the currency allows instead of rounding silently.
 * Grouping separators and signs must be stripped by the caller.
 */
export function parseAmount(input: string, currency: CurrencyCode): bigint {
  const match = DECIMAL.exec(input.trim());
  if (!match) {
    throw new MoneyError('invalid_amount', `Not a decimal amount: "${input}"`);
  }
  const [, whole = '0', fraction = ''] = match;
  const exponent = exponentOf(currency);
  if (fraction.length > exponent) {
    throw new MoneyError(
      'too_many_decimals',
      `${currency} allows at most ${exponent} decimal places`,
    );
  }
  const minor = BigInt(whole + fraction.padEnd(exponent, '0'));
  assertInRange(minor);
  return minor;
}

/** Formats minor units as a plain decimal string ("1234.50"). Locale formatting belongs to the UI. */
export function formatAmount(minor: bigint, currency: CurrencyCode): string {
  const exponent = exponentOf(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}${exponent > 0 ? `.${fraction}` : ''}`;
}

export function assertInRange(minor: bigint): void {
  if (minor < -MAX_MINOR || minor > MAX_MINOR) {
    throw new MoneyError('amount_out_of_range', `Amount exceeds ${MAX_MINOR} minor units`);
  }
}

export function sum(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}
