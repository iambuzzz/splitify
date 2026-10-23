import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IdempotencyRegistry, canonicalize } from '../src';

describe('canonicalize', () => {
  it('ignores key order and distinguishes bigint from number', () => {
    expect(canonicalize({ b: 1, a: [2n, 'x'] })).toBe(canonicalize({ a: [2n, 'x'], b: 1 }));
    expect(canonicalize({ amount: 1n })).not.toBe(canonicalize({ amount: 1 }));
    expect(canonicalize({ amount: '1' })).not.toBe(canonicalize({ amount: 1 }));
  });

  it('rejects values that cannot be represented exactly', () => {
    for (const bad of [{ a: undefined }, { a: NaN }, { a: Infinity }, () => 1, Symbol('x')]) {
      expect(() => canonicalize(bad)).toThrow(TypeError);
    }
  });

  it('equal structures always canonicalize equally, regardless of key insertion order', () => {
    const payload = fc.dictionary(fc.string(), fc.oneof(fc.bigInt(), fc.string(), fc.integer(), fc.boolean(), fc.constant(null)));
    fc.assert(
      fc.property(payload, (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalize(reversed)).toBe(canonicalize(obj));
      }),
    );
  });
});

describe('IdempotencyRegistry (I7, reference model for the R1 table)', () => {
  const createExpense = { groupId: 'g1', title: 'Hotel', total: 600000n, payers: [{ memberId: 'a', amount: 600000n }] };

  it('the same key and payload replayed 100 times runs the command once', () => {
    const registry = new IdempotencyRegistry<string>();
    let runs = 0;
    const outcomes = Array.from({ length: 100 }, () =>
      registry.execute('key-1', { ...createExpense }, () => {
        runs += 1;
        return `expense-${runs}`;
      }),
    );
    expect(runs).toBe(1);
    expect(outcomes[0]).toEqual({ kind: 'executed', result: 'expense-1' });
    expect(outcomes.slice(1).every((o) => o.kind === 'replayed' && o.result === 'expense-1')).toBe(true);
  });

  it('reusing a key with a different payload is a conflict, not a silent replay', () => {
    const registry = new IdempotencyRegistry<string>();
    registry.execute('key-1', createExpense, () => 'expense-1');
    expect(registry.execute('key-1', { ...createExpense, total: 600001n }, () => 'expense-2')).toEqual({ kind: 'conflict' });
  });

  it('key order in the payload does not matter', () => {
    const registry = new IdempotencyRegistry<string>();
    registry.execute('k', { a: 1, b: 2n }, () => 'first');
    expect(registry.execute('k', { b: 2n, a: 1 }, () => 'second')).toEqual({ kind: 'replayed', result: 'first' });
  });

  it('a failed attempt is not stored, so the client can retry with the same key', () => {
    const registry = new IdempotencyRegistry<string>();
    expect(() =>
      registry.execute('k', createExpense, () => {
        throw new Error('database unavailable');
      }),
    ).toThrow('database unavailable');
    expect(registry.execute('k', createExpense, () => 'ok')).toEqual({ kind: 'executed', result: 'ok' });
  });
});
