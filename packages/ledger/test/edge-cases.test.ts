import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_MINOR, MoneyError } from '@app/money';
import {
  type ExpenseVersionInput,
  LedgerError,
  LedgerJournal,
  breakdownExpense,
  computeBalances,
  reconcile,
  reversePostings,
  simplifyDebts,
} from '../src';

const sumOf = (rows: readonly { amount: bigint }[]) => rows.reduce((a, r) => a + r.amount, 0n);
const expense = (over: Partial<ExpenseVersionInput>): ExpenseVersionInput => ({
  expenseId: 'e1',
  kind: 'expense',
  currency: 'INR',
  total: 300000n,
  payers: [{ memberId: 'a', amount: 300000n }],
  split: { method: 'equal', members: ['a', 'b', 'c'] },
  ...over,
});

describe('refunds', () => {
  it('a foreign refund with multiple payers mirrors the original expense exactly', () => {
    const original = expense({
      currency: 'EUR',
      total: 25000n,
      rate: '90.4567',
      payers: [
        { memberId: 'a', amount: 15000n },
        { memberId: 'b', amount: 10000n },
      ],
      split: { method: 'percent', basisPoints: [{ memberId: 'a', basisPoints: 3333 }, { memberId: 'b', basisPoints: 3333 }, { memberId: 'c', basisPoints: 3334 }] },
    });
    const forward = breakdownExpense(original, 'INR');
    const refund = breakdownExpense({ ...original, kind: 'refund' }, 'INR');
    expect(refund.ledgerTotal).toBe(forward.ledgerTotal);
    expect(refund.postings).toEqual(reversePostings(forward.postings));
    expect(computeBalances([...forward.postings, ...refund.postings])).toEqual([]);
  });

  it('a partial refund leaves the remainder correctly split', () => {
    const paid = breakdownExpense(expense({ total: 300000n }), 'INR').postings;
    const refunded = breakdownExpense(
      expense({ expenseId: 'r1', kind: 'refund', total: 60000n, payers: [{ memberId: 'a', amount: 60000n }] }),
      'INR',
    ).postings;
    const direct = breakdownExpense(expense({ expenseId: 'net', total: 240000n, payers: [{ memberId: 'a', amount: 240000n }] }), 'INR').postings;
    expect(computeBalances([...paid, ...refunded])).toEqual(computeBalances(direct));
  });
});

describe('multi-currency', () => {
  it('works with a zero-decimal ledger currency (JPY)', () => {
    const b = breakdownExpense(expense({ currency: 'INR', total: 100000n, rate: '1.7854', payers: [{ memberId: 'a', amount: 100000n }] }), 'JPY');
    // ₹1,000.00 × 1.7854 = ¥1,785.4 → ¥1,785
    expect(b.ledgerTotal).toBe(1785n);
    expect(sumOf(b.shares)).toBe(1785n);
    expect(sumOf(b.postings)).toBe(0n);
  });

  it('works with a three-decimal ledger currency (KWD)', () => {
    const b = breakdownExpense(expense({ currency: 'INR', total: 333333n, rate: '0.0037', payers: [{ memberId: 'a', amount: 333333n }] }), 'KWD');
    // ₹3,333.33 × 0.0037 = 12.333321 KWD → 12.333
    expect(b.ledgerTotal).toBe(12333n);
    expect(sumOf(b.shares)).toBe(12333n);
  });

  it('rejects a foreign expense that rounds to nothing in the ledger currency', () => {
    expect(() => breakdownExpense(expense({ currency: 'INR', total: 20n, rate: '0.01', payers: [{ memberId: 'a', amount: 20n }] }), 'JPY')).toThrow(
      LedgerError,
    );
  });

  it('a rate correction is a material change: reverse + repost moves balances to the new rate', () => {
    const atCardRate = expense({ currency: 'USD', total: 10000n, rate: '83.10', payers: [{ memberId: 'a', amount: 10000n }] });
    const corrected = { ...atCardRate, rate: '84.05' };
    const journal = new LedgerJournal();
    journal.post('expense', 'e1', 1, breakdownExpense(atCardRate, 'INR').postings);
    journal.reverse('expense', 'e1', 1);
    const v2 = breakdownExpense(corrected, 'INR').postings;
    journal.post('expense', 'e1', 2, v2);
    expect(computeBalances(journal.postings())).toEqual(computeBalances(v2));
    expect(reconcile([{ sourceType: 'expense', sourceId: 'e1', sourceVersion: 2, postings: v2 }], journal.batches()).ok).toBe(true);
    expect(breakdownExpense(corrected, 'INR').ledgerTotal).toBe(840500n);
  });

  it('the same-currency path ignores any rate that was passed', () => {
    expect(breakdownExpense(expense({ rate: '99' }), 'INR')).toEqual(breakdownExpense(expense({}), 'INR'));
  });
});

describe('who paid vs who shares', () => {
  it('a payer who is not a participant is owed the full amount', () => {
    const { postings } = breakdownExpense(
      expense({ payers: [{ memberId: 'p', amount: 300000n }], split: { method: 'equal', members: ['a', 'b', 'c'] } }),
      'INR',
    );
    expect(postings).toEqual([
      { memberId: 'a', amount: -100000n },
      { memberId: 'b', amount: -100000n },
      { memberId: 'c', amount: -100000n },
      { memberId: 'p', amount: 300000n },
    ]);
  });

  it('paying only for yourself produces no postings', () => {
    const { postings } = breakdownExpense(expense({ split: { method: 'equal', members: ['a'] } }), 'INR');
    expect(postings).toEqual([]);
  });

  it('exact splits may give someone a zero share', () => {
    const { shares } = breakdownExpense(
      expense({ split: { method: 'exact', amounts: [{ memberId: 'a', amount: 300000n }, { memberId: 'b', amount: 0n }] } }),
      'INR',
    );
    expect(shares).toEqual([
      { memberId: 'a', amount: 300000n },
      { memberId: 'b', amount: 0n },
    ]);
  });

  it('handles large groups (50 members) exactly', () => {
    const members = Array.from({ length: 50 }, (_, i) => `m${String(i).padStart(2, '0')}`);
    const { shares, postings } = breakdownExpense(
      expense({ total: 999999n, payers: [{ memberId: 'm00', amount: 999999n }], split: { method: 'equal', members } }),
      'INR',
    );
    expect(sumOf(shares)).toBe(999999n);
    expect(sumOf(postings)).toBe(0n);
    expect(new Set(shares.map((s) => s.amount))).toEqual(new Set([19999n, 20000n]));
  });
});

describe('limits', () => {
  it('accepts the maximum amount and rejects one unit more', () => {
    expect(sumOf(breakdownExpense(expense({ total: MAX_MINOR, payers: [{ memberId: 'a', amount: MAX_MINOR }] }), 'INR').shares)).toBe(MAX_MINOR);
    expect(() => breakdownExpense(expense({ total: MAX_MINOR + 1n, payers: [{ memberId: 'a', amount: MAX_MINOR + 1n }] }), 'INR')).toThrow(
      MoneyError,
    );
  });

  it('rejects a conversion that would exceed the maximum', () => {
    expect(() =>
      breakdownExpense(expense({ currency: 'KWD', total: MAX_MINOR, rate: '270', payers: [{ memberId: 'a', amount: MAX_MINOR }] }), 'INR'),
    ).toThrow(MoneyError);
  });

  it('rejects non-positive payer amounts and duplicate payers', () => {
    expect(() => breakdownExpense(expense({ payers: [{ memberId: 'a', amount: 300001n }, { memberId: 'b', amount: -1n }] }), 'INR')).toThrow(
      /positive/,
    );
    expect(() =>
      breakdownExpense(expense({ payers: [{ memberId: 'a', amount: 150000n }, { memberId: 'a', amount: 150000n }] }), 'INR'),
    ).toThrow(/twice/);
  });
});

describe('simplifyDebts', () => {
  it('is independent of input order', () => {
    const balance = fc
      .array(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), { minLength: 1, maxLength: 10 })
      .map((amounts) => {
        const rows = amounts.map((amount, i) => ({ memberId: `m${i}`, amount }));
        rows.push({ memberId: 'z', amount: -sumOf(rows) });
        return rows;
      });
    fc.assert(
      fc.property(balance, (rows) => {
        expect(simplifyDebts([...rows].reverse())).toEqual(simplifyDebts(rows));
      }),
    );
  });
});
