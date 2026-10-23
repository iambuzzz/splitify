import { type CurrencyCode, exponentOf } from './currency';
import { MoneyError } from './errors';

const RATE = /^(\d+)(?:\.(\d{1,10}))?$/;

export interface Rate {
  numerator: bigint;
  denominator: bigint;
}

/** Parses a positive decimal exchange rate with at most 10 fractional digits. */
export function parseRate(rate: string): Rate {
  const match = RATE.exec(rate.trim());
  if (!match) throw new MoneyError('invalid_rate', `Invalid exchange rate: "${rate}"`);
  const [, whole = '0', fraction = ''] = match;
  const numerator = BigInt(whole + fraction);
  if (numerator === 0n) throw new MoneyError('invalid_rate', 'Exchange rate must be positive');
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

/**
 * Converts minor units of `from` into minor units of `to`, where `rate` is the number of
 * `to` major units per one `from` major unit. Rounds half away from zero.
 */
export function convertMinor(
  amount: bigint,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: string,
): bigint {
  const { numerator, denominator } = parseRate(rate);
  const scaledNumerator = amount * numerator * 10n ** BigInt(exponentOf(to));
  const scaledDenominator = denominator * 10n ** BigInt(exponentOf(from));
  return divideRoundHalfAwayFromZero(scaledNumerator, scaledDenominator);
}

function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n >= denominator) {
    return quotient + (numerator < 0n ? -1n : 1n);
  }
  return quotient;
}
