import { describe, expect, it } from 'vitest';
import { type CurrencyCode, assertCurrency } from '@app/money';
import { type ExpenseVersionInput, type SplitInput, breakdownExpense } from '../src';
import golden from './golden/vectors.json';

// Vectors come from tools/reference/oracle.py, an independent Python implementation of the
// split/rounding/conversion spec. Agreement between the two is the evidence for I10.
type Row = { memberId: string; amount: string };
type RawSplit =
  | { method: 'equal'; members: string[] }
  | { method: 'exact'; amounts: Row[] }
  | { method: 'percent'; basisPoints: { memberId: string; basisPoints: number }[] }
  | { method: 'shares'; shares: { memberId: string; shares: string }[] };
interface Vector {
  input: { expenseId: string; kind: string; currency: string; total: string; rate?: string; payers: Row[]; split: RawSplit };
  ledgerCurrency: string;
  expected: { ledgerTotal: string; shares: Row[]; payers: Row[]; postings: Row[] };
}

const toRows = (rows: Row[]) => rows.map((r) => ({ memberId: r.memberId, amount: BigInt(r.amount) }));

function toSplit(split: RawSplit): SplitInput {
  return split.method === 'exact' ? { method: 'exact', amounts: toRows(split.amounts) } : split;
}

function toInput(v: Vector['input']): ExpenseVersionInput {
  return {
    expenseId: v.expenseId,
    kind: v.kind === 'refund' ? 'refund' : 'expense',
    currency: assertCurrency(v.currency),
    total: BigInt(v.total),
    payers: toRows(v.payers),
    split: toSplit(v.split),
    ...(v.rate ? { rate: v.rate } : {}),
  };
}

const vectors = (golden as { vectors: Vector[] }).vectors;

describe('golden vectors from the independent Python oracle (I10)', () => {
  it('has a meaningful number of vectors', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(300);
  });

  it.each(vectors.map((v) => [`${v.input.expenseId} → ${v.ledgerCurrency}`, v] as const))('%s', (_, v) => {
    const actual = breakdownExpense(toInput(v.input), v.ledgerCurrency as CurrencyCode);
    expect(actual).toEqual({
      ledgerTotal: BigInt(v.expected.ledgerTotal),
      shares: toRows(v.expected.shares),
      payers: toRows(v.expected.payers),
      postings: toRows(v.expected.postings),
    });
  });
});
