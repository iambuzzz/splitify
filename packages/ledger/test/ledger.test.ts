import fc from 'fast-check';
import { MAX_MINOR, MoneyError } from '@app/money';
import { describe, expect, it } from 'vitest';
import {
  type ExpenseVersionInput,
  LedgerError,
  type Posting,
  type SplitInput,
  breakdownExpense,
  computeBalances,
  computeShares,
  reversePostings,
  settlementPostings,
  simplifyDebts,
} from '../src';

const sumOf = (rows: readonly { amount: bigint }[]) => rows.reduce((a, r) => a + r.amount, 0n);
const MEMBERS = ['m-a', 'm-b', 'm-c', 'm-d', 'm-e', 'm-f', 'm-g', 'm-h'];

/** Random valid split for `total` over a random subset of members. */
const splitFor = (total: bigint): fc.Arbitrary<SplitInput> =>
  fc.subarray(MEMBERS, { minLength: 1 }).chain((members) =>
    fc.oneof(
      fc.constant<SplitInput>({ method: 'equal', members }),
      fc
        .array(fc.integer({ min: 0, max: 400 }), { minLength: members.length, maxLength: members.length })
        .filter((ws) => ws.some((w) => w > 0))
        .map<SplitInput>((ws) => ({
          method: 'shares',
          shares: members.map((memberId, i) => ({
            memberId,
            shares: `${Math.floor(ws[i]! / 100)}.${String(ws[i]! % 100).padStart(2, '0')}`,
          })),
        })),
      fc.array(fc.nat(), { minLength: members.length, maxLength: members.length }).map<SplitInput>((rs) => {
        // Turn random numbers into basis points summing to exactly 10,000.
        const weightSum = rs.reduce((a, b) => a + b + 1, 0);
        const points = rs.map((r) => Math.floor(((r + 1) * 10_000) / weightSum));
        points[0]! += 10_000 - points.reduce((a, b) => a + b, 0);
        return { method: 'percent', basisPoints: members.map((memberId, i) => ({ memberId, basisPoints: points[i]! })) };
      }),
      fc.constant<SplitInput>({
        method: 'exact',
        amounts: members.map((memberId, i) => ({
          memberId,
          amount: i === 0 ? total - (total / BigInt(members.length)) * BigInt(members.length - 1) : total / BigInt(members.length),
        })),
      }),
    ),
  );

const expenseArb: fc.Arbitrary<ExpenseVersionInput> = fc
  .record({
    expenseId: fc.uuid(),
    kind: fc.constantFrom<'expense' | 'refund'>('expense', 'refund'),
    total: fc.bigInt({ min: 1n, max: 10n ** 10n }),
    foreign: fc.boolean(),
    rate: fc.integer({ min: 1, max: 99_999_999 }).map((n) => (n / 10_000).toFixed(4)),
  })
  .chain(({ expenseId, kind, total, foreign, rate }) =>
    fc.record({
      split: splitFor(total),
      payerCount: fc.integer({ min: 1, max: 3 }),
    }).map(({ split, payerCount }) => {
      const payerIds = MEMBERS.slice(0, payerCount);
      const base = total / BigInt(payerCount);
      const payers = payerIds
        .map((memberId, i) => ({ memberId, amount: i === 0 ? total - base * BigInt(payerCount - 1) : base }))
        .filter((p) => p.amount > 0n);
      return {
        expenseId,
        kind,
        currency: foreign ? ('EUR' as const) : ('INR' as const),
        total,
        payers: payers.length > 0 ? payers : [{ memberId: 'm-a', amount: total }],
        split,
        ...(foreign ? { rate } : {}),
      };
    }),
  )
  .filter((e) => {
    try {
      breakdownExpense(e, 'INR');
      return true;
    } catch (err) {
      // Converted totals may legitimately round to zero or exceed the per-amount cap;
      // anything else is a real failure and must surface.
      return !(
        (err instanceof LedgerError && err.code === 'invalid_total') ||
        (err instanceof MoneyError && err.code === 'amount_out_of_range')
      );
    }
  });

describe('computeShares', () => {
  it('Σ shares = total for every split method (I1)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }).chain((total) => fc.tuple(fc.constant(total), splitFor(total))),
        fc.uuid(),
        ([total, split], seed) => {
          expect(sumOf(computeShares(total, split, seed))).toBe(total);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it('handles the hotel late-arrival case with nights as shares', () => {
    const shares = computeShares(
      600000n,
      {
        method: 'shares',
        shares: [
          { memberId: 'a', shares: '3' },
          { memberId: 'b', shares: '3' },
          { memberId: 'c', shares: '2' },
          { memberId: 'd', shares: '3' },
        ],
      },
      'hotel-1',
    );
    expect(sumOf(shares)).toBe(600000n);
    expect(shares.find((s) => s.memberId === 'c')!.amount).toBe(109091n);
  });

  it('rejects inconsistent input with specific errors', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return (err as LedgerError).code;
      }
      return 'no error';
    };
    expect(code(() => computeShares(0n, { method: 'equal', members: ['a'] }, 's'))).toBe('invalid_total');
    expect(code(() => computeShares(100n, { method: 'equal', members: [] }, 's'))).toBe('no_participants');
    expect(code(() => computeShares(100n, { method: 'equal', members: ['a', 'a'] }, 's'))).toBe('duplicate_member');
    expect(
      code(() => computeShares(100n, { method: 'exact', amounts: [{ memberId: 'a', amount: 60n }, { memberId: 'b', amount: 30n }] }, 's')),
    ).toBe('exact_mismatch');
    expect(
      code(() => computeShares(100n, { method: 'percent', basisPoints: [{ memberId: 'a', basisPoints: 5000 }, { memberId: 'b', basisPoints: 4000 }] }, 's')),
    ).toBe('percent_mismatch');
    expect(
      code(() => computeShares(100n, { method: 'percent', basisPoints: [{ memberId: 'a', basisPoints: 5000.5 }, { memberId: 'b', basisPoints: 4999.5 }] }, 's')),
    ).toBe('invalid_share');
    expect(
      code(() => computeShares(100n, { method: 'percent', basisPoints: [{ memberId: 'a', basisPoints: 10100 }, { memberId: 'b', basisPoints: -100 }] }, 's')),
    ).toBe('invalid_share');
    expect(code(() => computeShares(100n, { method: 'exact', amounts: [{ memberId: 'a', amount: 150n }, { memberId: 'b', amount: -50n }] }, 's'))).toBe(
      'invalid_share',
    );
    expect(code(() => computeShares(100n, { method: 'shares', shares: [{ memberId: 'a', shares: '1.234' }] }, 's'))).toBe('invalid_share');
    expect(code(() => computeShares(100n, { method: 'shares', shares: [{ memberId: 'a', shares: '0' }] }, 's'))).toBe('invalid_share');
  });
});

describe('breakdownExpense', () => {
  it('postings sum to zero and shares/payers sum to the ledger total (I1, I2)', () => {
    fc.assert(
      fc.property(expenseArb, (expense) => {
        const { ledgerTotal, shares, payers, postings } = breakdownExpense(expense, 'INR');
        expect(sumOf(shares)).toBe(ledgerTotal);
        expect(sumOf(payers)).toBe(ledgerTotal);
        expect(sumOf(postings)).toBe(0n);
        expect(postings.every((p) => p.amount !== 0n)).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });

  it('is deterministic: the same version always yields the same postings (I10)', () => {
    fc.assert(
      fc.property(expenseArb, (expense) => {
        const copy = { ...expense, payers: expense.payers.map((p) => ({ ...p })), split: { ...expense.split } };
        expect(breakdownExpense(copy, 'INR')).toEqual(breakdownExpense(expense, 'INR'));
      }),
    );
  });

  it('A pays ₹6,000 hotel for four equally', () => {
    const { postings } = breakdownExpense(
      {
        expenseId: 'hotel',
        kind: 'expense',
        currency: 'INR',
        total: 600000n,
        payers: [{ memberId: 'a', amount: 600000n }],
        split: { method: 'equal', members: ['a', 'b', 'c', 'd'] },
      },
      'INR',
    );
    expect(postings).toEqual([
      { memberId: 'a', amount: 450000n },
      { memberId: 'b', amount: -150000n },
      { memberId: 'c', amount: -150000n },
      { memberId: 'd', amount: -150000n },
    ]);
  });

  it('a refund inverts the direction of money', () => {
    const base = {
      expenseId: 'r1',
      currency: 'INR' as const,
      total: 30000n,
      payers: [{ memberId: 'a', amount: 30000n }],
      split: { method: 'equal' as const, members: ['a', 'b', 'c'] },
    };
    const expense = breakdownExpense({ ...base, kind: 'expense' }, 'INR').postings;
    const refund = breakdownExpense({ ...base, kind: 'refund' }, 'INR').postings;
    expect(refund).toEqual(reversePostings(expense));
  });

  it('converts foreign expenses once, then splits exactly in the ledger currency', () => {
    // €100.00 at 90.1234 → ₹9,012.34 split 3 ways
    const { ledgerTotal, shares, postings } = breakdownExpense(
      {
        expenseId: 'dinner-paris',
        kind: 'expense',
        currency: 'EUR',
        total: 10000n,
        rate: '90.1234',
        payers: [{ memberId: 'a', amount: 10000n }],
        split: { method: 'equal', members: ['a', 'b', 'c'] },
      },
      'INR',
    );
    expect(ledgerTotal).toBe(901234n);
    expect(sumOf(shares)).toBe(901234n);
    expect(sumOf(postings)).toBe(0n);
  });

  it('requires a rate for foreign currencies and valid payers', () => {
    const base: ExpenseVersionInput = {
      expenseId: 'x',
      kind: 'expense',
      currency: 'EUR',
      total: 1000n,
      payers: [{ memberId: 'a', amount: 1000n }],
      split: { method: 'equal', members: ['a', 'b'] },
    };
    expect(() => breakdownExpense(base, 'INR')).toThrow(/exchange rate/);
    expect(() => breakdownExpense({ ...base, currency: 'INR', payers: [{ memberId: 'a', amount: 900n }] }, 'INR')).toThrow(
      /Payers sum/,
    );
    expect(() => breakdownExpense({ ...base, currency: 'INR', payers: [] }, 'INR')).toThrow(/who paid/);
  });
});

describe('ledger lifecycle', () => {
  it('edit = reversal + repost leaves exactly the new version in the ledger (I5)', () => {
    fc.assert(
      fc.property(expenseArb, expenseArb, (v1, v2Raw) => {
        const v2 = { ...v2Raw, expenseId: v1.expenseId };
        const p1 = breakdownExpense(v1, 'INR').postings;
        const p2 = breakdownExpense(v2, 'INR').postings;
        const ledger: Posting[] = [...p1, ...reversePostings(p1), ...p2];
        expect(computeBalances(ledger)).toEqual(computeBalances(p2));
      }),
      { numRuns: 1000 },
    );
  });

  it('group balances always sum to zero (I3) and simplified transfers settle everyone (I9)', () => {
    fc.assert(
      fc.property(fc.array(expenseArb, { minLength: 1, maxLength: 25 }), (expenses) => {
        const ledger = expenses.flatMap((e) => breakdownExpense(e, 'INR').postings);
        const balances = computeBalances(ledger);
        expect(sumOf(balances)).toBe(0n);

        const transfers = simplifyDebts(balances);
        // Each oversized balance may add extra chunks; otherwise at most n − 1 transfers.
        const oversized = transfers.filter((t) => t.amount === MAX_MINOR).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, balances.length - 1) + oversized);
        expect(transfers.every((t) => t.amount > 0n && t.amount <= MAX_MINOR && t.from !== t.to)).toBe(true);

        const settled = [...ledger, ...transfers.flatMap((t) => settlementPostings(t.from, t.to, t.amount))];
        expect(computeBalances(settled)).toEqual([]);
      }),
      { numRuns: 1000 },
    );
  });

  it('settlement postings move balances toward zero', () => {
    expect(settlementPostings('b', 'a', 150000n)).toEqual([
      { memberId: 'a', amount: -150000n },
      { memberId: 'b', amount: 150000n },
    ]);
    expect(() => settlementPostings('a', 'a', 1n)).toThrow(LedgerError);
    expect(() => settlementPostings('a', 'b', 0n)).toThrow(LedgerError);
  });

  it('splits a suggested transfer above the per-amount cap so it can still be recorded', () => {
    // Found by property testing: balances accumulated over many expenses can exceed the cap
    // that applies to any single amount.
    const big = MAX_MINOR * 2n + 5n;
    const transfers = simplifyDebts([
      { memberId: 'a', amount: big },
      { memberId: 'b', amount: -big },
    ]);
    expect(transfers).toEqual([
      { from: 'b', to: 'a', amount: MAX_MINOR },
      { from: 'b', to: 'a', amount: MAX_MINOR },
      { from: 'b', to: 'a', amount: 5n },
    ]);
    expect(() => transfers.map((t) => settlementPostings(t.from, t.to, t.amount))).not.toThrow();
  });

  it('refuses to simplify unbalanced input', () => {
    expect(() => simplifyDebts([{ memberId: 'a', amount: 1n }])).toThrow(/sum to 1/);
  });
});
