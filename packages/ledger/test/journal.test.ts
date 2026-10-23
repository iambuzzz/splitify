import { describe, expect, it } from 'vitest';
import {
  type ExpectedSource,
  LedgerError,
  LedgerJournal,
  breakdownExpense,
  computeBalances,
  reconcile,
  settlementPostings,
  settlementWarnings,
} from '../src';

const hotelV1 = breakdownExpense(
  {
    expenseId: 'hotel',
    kind: 'expense',
    currency: 'INR',
    total: 600000n,
    payers: [{ memberId: 'a', amount: 600000n }],
    split: { method: 'equal', members: ['a', 'b', 'c', 'd'] },
  },
  'INR',
).postings;
const hotelV2 = breakdownExpense(
  {
    expenseId: 'hotel',
    kind: 'expense',
    currency: 'INR',
    total: 600000n,
    payers: [{ memberId: 'a', amount: 600000n }],
    split: { method: 'shares', shares: [{ memberId: 'a', shares: '3' }, { memberId: 'b', shares: '3' }, { memberId: 'c', shares: '2' }, { memberId: 'd', shares: '3' }] },
  },
  'INR',
).postings;

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof LedgerError ? err.code : String(err);
  }
  return 'no error';
};

describe('LedgerJournal: append-only (I4)', () => {
  it('exposes no way to update or delete batches', () => {
    const journal = new LedgerJournal();
    const methods = Object.getOwnPropertyNames(LedgerJournal.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['batches', 'post', 'postings', 'reverse']);
    journal.post('expense', 'hotel', 1, hotelV1);
    expect(journal.batches()).toHaveLength(1);
  });

  it('returned batches and postings are frozen; mutation attempts throw', () => {
    const journal = new LedgerJournal();
    const batch = journal.post('expense', 'hotel', 1, hotelV1);
    const batches = journal.batches();
    expect(Object.isFrozen(batches)).toBe(true);
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.postings)).toBe(true);
    expect(Object.isFrozen(batch.postings[0])).toBe(true);
    expect(() => {
      (batch.postings[0] as { amount: bigint }).amount = 0n;
    }).toThrow(TypeError);
    expect(() => (batches as unknown as unknown[]).pop()).toThrow(TypeError);
    expect(() => (batch.postings as unknown as unknown[]).push({ memberId: 'x', amount: 1n })).toThrow(TypeError);
  });

  it('mutating the caller\'s input after posting does not change the journal', () => {
    const journal = new LedgerJournal();
    const input = hotelV1.map((p) => ({ ...p }));
    journal.post('expense', 'hotel', 1, input);
    input[0]!.amount = 999n;
    expect(journal.batches()[0]!.postings[0]!.amount).toBe(hotelV1[0]!.amount);
  });

  it('refuses unbalanced batches, double posts, and mismatched reversals', () => {
    const journal = new LedgerJournal();
    expect(errorCode(() => journal.post('expense', 'x', 1, [{ memberId: 'a', amount: 1n }]))).toBe('unbalanced');
    journal.post('expense', 'hotel', 1, hotelV1);
    expect(errorCode(() => journal.post('expense', 'hotel', 2, hotelV2))).toBe('already_posted');
    expect(errorCode(() => journal.reverse('expense', 'hotel', 2))).toBe('version_mismatch');
    expect(errorCode(() => journal.reverse('expense', 'nope', 1))).toBe('not_posted');
  });

  it('a duplicated settlement confirmation cannot be counted twice', () => {
    const journal = new LedgerJournal();
    journal.post('settlement', 's1', 1, settlementPostings('b', 'a', 150000n));
    expect(errorCode(() => journal.post('settlement', 's1', 1, settlementPostings('b', 'a', 150000n)))).toBe('already_posted');
    expect(computeBalances(journal.postings())).toEqual([
      { memberId: 'a', amount: -150000n },
      { memberId: 'b', amount: 150000n },
    ]);
  });

  it('an edit is recorded as reverse + post, preserving the full history', () => {
    const journal = new LedgerJournal();
    journal.post('expense', 'hotel', 1, hotelV1);
    journal.reverse('expense', 'hotel', 1);
    journal.post('expense', 'hotel', 2, hotelV2);
    expect(journal.batches().map((b) => [b.seq, b.direction, b.sourceVersion])).toEqual([
      [1, 'post', 1],
      [2, 'reverse', 1],
      [3, 'post', 2],
    ]);
    expect(computeBalances(journal.postings())).toEqual(computeBalances(hotelV2));
  });
});

describe('reconcile (I5)', () => {
  const expected = (postings = hotelV2, version = 2): ExpectedSource[] => [
    { sourceType: 'expense', sourceId: 'hotel', sourceVersion: version, postings },
  ];

  it('passes when the journal holds exactly the counted versions', () => {
    const journal = new LedgerJournal();
    journal.post('expense', 'hotel', 1, hotelV1);
    journal.reverse('expense', 'hotel', 1);
    journal.post('expense', 'hotel', 2, hotelV2);
    expect(reconcile(expected(), journal.batches())).toEqual({ ok: true, issues: [] });
  });

  it('detects a missing posting', () => {
    expect(reconcile(expected(), []).issues).toEqual([{ sourceKey: 'expense:hotel', issue: 'missing' }]);
  });

  it('detects a stale version left posted (edit not reposted)', () => {
    const journal = new LedgerJournal();
    journal.post('expense', 'hotel', 1, hotelV1);
    const report = reconcile(expected(), journal.batches());
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toEqual({ sourceKey: 'expense:hotel', issue: 'wrong_version', expected: 2, posted: 1 });
    expect(report.issues.some((i) => i.issue === 'amount_mismatch')).toBe(true);
  });

  it('detects postings for a source that should not count (e.g. a deleted expense)', () => {
    const journal = new LedgerJournal();
    journal.post('expense', 'hotel', 1, hotelV1);
    expect(reconcile([], journal.batches()).issues).toEqual([
      { sourceKey: 'expense:hotel', issue: 'unexpected', postedVersion: 1 },
    ]);
  });

  it('detects amounts that differ from the recomputed version (e.g. engine change or tampering)', () => {
    const journal = new LedgerJournal();
    journal.post('expense', 'hotel', 2, hotelV1); // wrong postings recorded under version 2
    const report = reconcile(expected(), journal.batches());
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.every((i) => i.issue === 'amount_mismatch')).toBe(true);
  });

  it('detects a reversal that does not cancel its post (corrupted batch)', () => {
    const tampered = [
      { seq: 1, sourceType: 'expense' as const, sourceId: 'x', sourceVersion: 1, direction: 'post' as const, postings: [{ memberId: 'a', amount: 5n }, { memberId: 'b', amount: -5n }] },
      { seq: 2, sourceType: 'expense' as const, sourceId: 'x', sourceVersion: 1, direction: 'reverse' as const, postings: [{ memberId: 'a', amount: -4n }, { memberId: 'b', amount: 4n }] },
    ];
    const report = reconcile([], tampered);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({ sourceKey: 'expense:x', issue: 'amount_mismatch', memberId: 'a', expected: 0n, actual: 1n });
  });
});

describe('settlementWarnings', () => {
  const balances = [
    { memberId: 'a', amount: 450000n },
    { memberId: 'b', amount: -150000n },
    { memberId: 'c', amount: -300000n },
  ];
  it('is silent for a payment within both balances', () => {
    expect(settlementWarnings(balances, 'b', 'a', 150000n)).toEqual([]);
  });
  it('warns on over-payment by either side', () => {
    expect(settlementWarnings(balances, 'b', 'a', 200000n)).toEqual(['payer_owes_less']);
    expect(settlementWarnings(balances, 'c', 'b', 1n)).toEqual(['receiver_is_owed_less']);
    expect(settlementWarnings(balances, 'a', 'b', 1n)).toEqual(['payer_owes_less', 'receiver_is_owed_less']);
  });
});
