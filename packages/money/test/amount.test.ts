import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_MINOR,
  MoneyError,
  SUPPORTED_CURRENCIES,
  assertCurrency,
  assertInRange,
  convertMinor,
  exponentOf,
  formatAmount,
  parseAmount,
  parseRate,
  sum,
} from '../src';

describe('currency', () => {
  it('knows ISO exponents', () => {
    expect(exponentOf('INR')).toBe(2);
    expect(exponentOf('JPY')).toBe(0);
    expect(exponentOf('KWD')).toBe(3);
  });

  it('accepts every supported code', () => {
    for (const code of SUPPORTED_CURRENCIES) expect(assertCurrency(code)).toBe(code);
  });

  it('rejects unknown codes', () => {
    expect(() => assertCurrency('XYZ')).toThrow(MoneyError);
    expect(() => assertCurrency('toString')).toThrow(MoneyError);
  });
});

describe('parseAmount / formatAmount', () => {
  it('parses decimal strings into minor units', () => {
    expect(parseAmount('6000', 'INR')).toBe(600000n);
    expect(parseAmount('12.5', 'INR')).toBe(1250n);
    expect(parseAmount('0.05', 'INR')).toBe(5n);
    expect(parseAmount('1500', 'JPY')).toBe(1500n);
    expect(parseAmount('1.234', 'KWD')).toBe(1234n);
  });

  it('refuses to round silently', () => {
    expect(() => parseAmount('12.345', 'INR')).toThrow(/at most 2/);
    expect(() => parseAmount('10.5', 'JPY')).toThrow(MoneyError);
  });

  it('rejects malformed and out-of-range input', () => {
    for (const bad of ['', '-5', '1,000', '1e3', '.5', '5.', 'abc', 'NaN']) {
      expect(() => parseAmount(bad, 'INR')).toThrow(MoneyError);
    }
    expect(() => parseAmount('10000000001', 'INR')).toThrow(/exceeds/);
  });

  it('round-trips for every supported currency', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_CURRENCIES),
        fc.bigInt({ min: 0n, max: MAX_MINOR }),
        (currency, minor) => {
          expect(parseAmount(formatAmount(minor, currency), currency)).toBe(minor);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it('formats negatives and zero-exponent currencies', () => {
    expect(formatAmount(-1250n, 'INR')).toBe('-12.50');
    expect(formatAmount(5n, 'INR')).toBe('0.05');
    expect(formatAmount(1500n, 'JPY')).toBe('1500');
    expect(formatAmount(7n, 'KWD')).toBe('0.007');
  });
});

describe('sum and range', () => {
  it('sums bigints exactly', () => {
    expect(sum([])).toBe(0n);
    expect(sum([MAX_MINOR, MAX_MINOR, -1n])).toBe(2n * MAX_MINOR - 1n);
  });

  it('enforces the per-amount range in both directions', () => {
    expect(() => assertInRange(MAX_MINOR)).not.toThrow();
    expect(() => assertInRange(-MAX_MINOR)).not.toThrow();
    expect(() => assertInRange(MAX_MINOR + 1n)).toThrow(MoneyError);
    expect(() => assertInRange(-MAX_MINOR - 1n)).toThrow(MoneyError);
  });
});

describe('convertMinor', () => {
  it('converts between exponents', () => {
    // €100.00 at 90.5 INR/EUR = ₹9,050.00
    expect(convertMinor(10000n, 'EUR', 'INR', '90.5')).toBe(905000n);
    // ¥1,500 at 0.56 INR/JPY = ₹840.00
    expect(convertMinor(1500n, 'JPY', 'INR', '0.56')).toBe(84000n);
    // ₹1,000.00 at 0.0037 KWD/INR = 3.700 KWD
    expect(convertMinor(100000n, 'INR', 'KWD', '0.0037')).toBe(3700n);
  });

  it('rounds half away from zero', () => {
    // 1 cent × 0.5 = 0.5 paise → 1
    expect(convertMinor(1n, 'USD', 'INR', '0.5')).toBe(1n);
    expect(convertMinor(-1n, 'USD', 'INR', '0.5')).toBe(-1n);
    expect(convertMinor(1n, 'USD', 'INR', '0.4999999999')).toBe(0n);
  });

  it('is the identity at rate 1 for the same exponent', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -MAX_MINOR, max: MAX_MINOR }), (minor) => {
        expect(convertMinor(minor, 'USD', 'INR', '1')).toBe(minor);
      }),
    );
  });

  it('validates rates', () => {
    for (const bad of ['0', '0.0', '-1', '1.12345678901', 'abc', '']) {
      expect(() => parseRate(bad)).toThrow(MoneyError);
    }
    expect(parseRate('83.25')).toEqual({ numerator: 8325n, denominator: 100n });
  });
});
