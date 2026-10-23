import { type CurrencyCode, allocate, assertInRange, convertMinor } from '@app/money';
import { LedgerError } from './errors';
import { type MemberId, type Share, type SplitInput, computeShares } from './split';

export interface ExpenseVersionInput {
  expenseId: string;
  /** A refund (money received back) uses the same split with the signs inverted. */
  kind: 'expense' | 'refund';
  currency: CurrencyCode;
  /** Total in `currency` minor units. */
  total: bigint;
  payers: readonly Share[];
  split: SplitInput;
  /** Required when `currency` differs from the group's ledger currency; ledger units per 1 unit of `currency`. */
  rate?: string;
}

/**
 * A ledger posting: positive means the member is owed money, negative means they owe.
 * Postings for one source always sum to zero (I2).
 */
export interface Posting {
  memberId: MemberId;
  amount: bigint;
}

export interface ExpenseBreakdown {
  /** Total converted into the ledger currency. */
  ledgerTotal: bigint;
  shares: Share[];
  payers: Share[];
  postings: Posting[];
}

/**
 * Computes what each member paid and owes for one expense version, in the group's ledger
 * currency, plus the resulting net postings. Foreign totals are converted once, then shares
 * and payer amounts are re-allocated proportionally so every sum stays exact.
 */
export function breakdownExpense(
  expense: ExpenseVersionInput,
  ledgerCurrency: CurrencyCode,
): ExpenseBreakdown {
  const { expenseId, total } = expense;
  const originalShares = computeShares(total, expense.split, expenseId);
  const originalPayers = validatePayers(expense.payers, total);

  let ledgerTotal = total;
  let shares = originalShares;
  let payers = originalPayers;

  if (expense.currency !== ledgerCurrency) {
    if (!expense.rate) {
      throw new LedgerError('missing_rate', `An exchange rate from ${expense.currency} is required`);
    }
    ledgerTotal = convertMinor(total, expense.currency, ledgerCurrency, expense.rate);
    if (ledgerTotal <= 0n) {
      throw new LedgerError('invalid_total', 'Converted total rounds to zero');
    }
    assertInRange(ledgerTotal);
    shares = reallocate(ledgerTotal, originalShares, expenseId);
    payers = reallocate(ledgerTotal, originalPayers, `${expenseId}:payers`);
  }

  const sign = expense.kind === 'refund' ? -1n : 1n;
  const net = new Map<MemberId, bigint>();
  for (const { memberId, amount } of payers) net.set(memberId, (net.get(memberId) ?? 0n) + amount);
  for (const { memberId, amount } of shares) net.set(memberId, (net.get(memberId) ?? 0n) - amount);

  const postings = [...net.entries()]
    .filter(([, amount]) => amount !== 0n)
    .map(([memberId, amount]) => ({ memberId, amount: amount * sign }))
    .sort((a, b) => (a.memberId < b.memberId ? -1 : 1));

  return { ledgerTotal, shares, payers, postings };
}

/** The postings that cancel `postings`; used when an active version is replaced or deleted. */
export function reversePostings(postings: readonly Posting[]): Posting[] {
  return postings.map(({ memberId, amount }) => ({ memberId, amount: -amount }));
}

/** Postings for a confirmed settlement: the payer's debt shrinks, the receiver's credit shrinks. */
export function settlementPostings(from: MemberId, to: MemberId, amount: bigint): Posting[] {
  if (from === to) throw new LedgerError('invalid_payer', 'A member cannot pay themselves');
  if (amount <= 0n) throw new LedgerError('invalid_total', 'Settlement amount must be positive');
  assertInRange(amount);
  return [
    { memberId: from, amount },
    { memberId: to, amount: -amount },
  ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

function validatePayers(payers: readonly Share[], total: bigint): Share[] {
  if (payers.length === 0) throw new LedgerError('invalid_payer', 'Choose who paid');
  if (new Set(payers.map((p) => p.memberId)).size !== payers.length) {
    throw new LedgerError('duplicate_member', 'A payer appears twice');
  }
  let paid = 0n;
  for (const payer of payers) {
    if (payer.amount <= 0n) throw new LedgerError('invalid_payer', 'Payer amounts must be positive');
    paid += payer.amount;
  }
  if (paid !== total) {
    throw new LedgerError('payers_mismatch', `Payers sum to ${paid}, expected ${total}`);
  }
  return [...payers].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

function reallocate(total: bigint, rows: Share[], seed: string): Share[] {
  const members = rows.map((r) => r.memberId);
  const amounts = allocate(total, rows.map((r) => r.amount), members, seed);
  return members.map((memberId, i) => ({ memberId, amount: amounts[i]! }));
}
