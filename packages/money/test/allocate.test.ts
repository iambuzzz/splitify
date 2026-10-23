import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MoneyError, allocate } from '../src';

const keysOf = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

const allocationInput = fc
  .integer({ min: 1, max: 12 })
  .chain((n) =>
    fc.record({
      total: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
      weights: fc
        .array(fc.bigInt({ min: 0n, max: 1_000_000n }), { minLength: n, maxLength: n })
        .filter((ws) => ws.some((w) => w > 0n)),
      seed: fc.string(),
    }),
  );

describe('allocate', () => {
  it('parts always sum exactly to the total (I1)', () => {
    fc.assert(
      fc.property(allocationInput, ({ total, weights, seed }) => {
        const parts = allocate(total, weights, keysOf(weights.length), seed);
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      }),
      { numRuns: 5000 },
    );
  });

  it('each part is the floor or ceiling of its exact proportional share', () => {
    fc.assert(
      fc.property(allocationInput, ({ total, weights, seed }) => {
        const parts = allocate(total, weights, keysOf(weights.length), seed);
        const weightSum = weights.reduce((a, b) => a + b, 0n);
        const abs = total < 0n ? -total : total;
        parts.forEach((part, i) => {
          const absPart = part < 0n ? -part : part;
          const floor = (abs * weights[i]!) / weightSum;
          expect(absPart === floor || absPart === floor + 1n).toBe(true);
        });
      }),
      { numRuns: 5000 },
    );
  });

  it('zero-weight members never receive anything', () => {
    fc.assert(
      fc.property(allocationInput, ({ total, weights, seed }) => {
        const parts = allocate(total, weights, keysOf(weights.length), seed);
        weights.forEach((w, i) => {
          if (w === 0n) expect(parts[i]).toBe(0n);
        });
      }),
    );
  });

  it('is deterministic and independent of input order', () => {
    fc.assert(
      fc.property(allocationInput, ({ total, weights, seed }) => {
        const keys = keysOf(weights.length);
        const forward = allocate(total, weights, keys, seed);
        const reversed = allocate(total, [...weights].reverse(), [...keys].reverse(), seed).reverse();
        expect(reversed).toEqual(forward);
      }),
    );
  });

  it('rotates leftover units fairly across expenses', () => {
    // ₹100.00 split 3 ways leaves 1 paisa over every time.
    const keys = ['a', 'b', 'c'];
    const extra = new Map(keys.map((k) => [k, 0]));
    const runs = 3000;
    for (let i = 0; i < runs; i++) {
      const parts = allocate(10000n, [1n, 1n, 1n], keys, `expense-${i}`);
      parts.forEach((p, j) => {
        if (p === 3334n) extra.set(keys[j]!, extra.get(keys[j]!)! + 1);
      });
    }
    for (const count of extra.values()) {
      expect(count).toBeGreaterThan(runs / 3 - 150);
      expect(count).toBeLessThan(runs / 3 + 150);
    }
  });

  it('rotates fairly with realistic member ids (UUIDs) and varied leftovers', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.uuid(), { minLength: 3, maxLength: 7 }), (keys) => {
        const n = keys.length;
        const extra = new Map(keys.map((k) => [k, 0]));
        const runs = 1400 * n;
        for (let i = 0; i < runs; i++) {
          const total = 10_000n * BigInt(n) + 1n; // always exactly one unit left over
          const parts = allocate(total, keys.map(() => 1n), keys, `e-${i}`);
          parts.forEach((p, j) => {
            if (p === 10_001n) extra.set(keys[j]!, extra.get(keys[j]!)! + 1);
          });
        }
        // Each member should receive the extra unit ~runs/n times; allow ±15%.
        for (const count of extra.values()) {
          expect(count).toBeGreaterThan((runs / n) * 0.85);
          expect(count).toBeLessThan((runs / n) * 1.15);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('splits a ₹6,000 hotel by nights (3,3,3,2)', () => {
    // Exact shares: 1636.36…, 1636.36…, 1636.36…, 1090.90… → 2 paise left over.
    // D has the largest remainder; one of A/B/C (chosen by the seeded tie-break) gets the other.
    const parts = allocate(600000n, [3n, 3n, 3n, 2n], ['a', 'b', 'c', 'd'], 'hotel');
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(600000n);
    expect(parts[3]).toBe(109091n);
    expect(parts.slice(0, 3).filter((p) => p === 163637n)).toHaveLength(1);
    expect(parts.slice(0, 3).filter((p) => p === 163636n)).toHaveLength(2);
  });

  it('rejects invalid weights', () => {
    expect(() => allocate(100n, [], [], 's')).toThrow(MoneyError);
    expect(() => allocate(100n, [0n, 0n], ['a', 'b'], 's')).toThrow(MoneyError);
    expect(() => allocate(100n, [1n, -1n], ['a', 'b'], 's')).toThrow(MoneyError);
    expect(() => allocate(100n, [1n, 1n], ['a', 'a'], 's')).toThrow(MoneyError);
    expect(() => allocate(100n, [1n], ['a', 'b'], 's')).toThrow(MoneyError);
  });
});
