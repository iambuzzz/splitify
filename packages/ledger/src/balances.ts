import { MAX_MINOR } from '@app/money';
import { LedgerError } from './errors';
import type { Posting } from './postings';
import type { MemberId } from './split';

export interface Balance {
  memberId: MemberId;
  /** Positive: is owed money. Negative: owes money. */
  amount: bigint;
}

export interface Transfer {
  from: MemberId;
  to: MemberId;
  amount: bigint;
}

/** Sums postings per member. Members with a zero balance are omitted. */
export function computeBalances(postings: Iterable<Posting>): Balance[] {
  const totals = new Map<MemberId, bigint>();
  for (const { memberId, amount } of postings) {
    totals.set(memberId, (totals.get(memberId) ?? 0n) + amount);
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount !== 0n)
    .map(([memberId, amount]) => ({ memberId, amount }))
    .sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

/**
 * Suggests transfers that settle every balance: repeatedly matches the largest debtor with the
 * largest creditor. Produces at most n − 1 transfers, except that a transfer larger than the
 * per-amount cap (MAX_MINOR) is split into several, so every suggestion can be recorded as a
 * settlement. This is a derived view only; it is never written to the ledger.
 */
export function simplifyDebts(balances: readonly Balance[]): Transfer[] {
  let total = 0n;
  for (const b of balances) total += b.amount;
  if (total !== 0n) throw new LedgerError('unbalanced', `Balances sum to ${total}, expected 0`);

  const creditors = balances.filter((b) => b.amount > 0n).map((b) => ({ ...b }));
  const debtors = balances.filter((b) => b.amount < 0n).map((b) => ({ ...b, amount: -b.amount }));
  const byLargest = (a: Balance, b: Balance) =>
    a.amount === b.amount ? (a.memberId < b.memberId ? -1 : 1) : a.amount > b.amount ? -1 : 1;

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byLargest);
    debtors.sort(byLargest);
    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = creditor.amount < debtor.amount ? creditor.amount : debtor.amount;
    for (let left = amount; left > 0n; left -= left > MAX_MINOR ? MAX_MINOR : left) {
      transfers.push({ from: debtor.memberId, to: creditor.memberId, amount: left > MAX_MINOR ? MAX_MINOR : left });
    }
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0n) creditors.shift();
    if (debtor.amount === 0n) debtors.shift();
  }
  return transfers;
}

export type SettlementWarning = 'payer_owes_less' | 'receiver_is_owed_less';

/**
 * Over-payments are allowed (people round up, or pay ahead), but the UI warns first. Returns
 * which side of the payment exceeds the current balances.
 */
export function settlementWarnings(
  balances: readonly Balance[],
  from: MemberId,
  to: MemberId,
  amount: bigint,
): SettlementWarning[] {
  const balanceOf = (id: MemberId) => balances.find((b) => b.memberId === id)?.amount ?? 0n;
  const payerOwes = balanceOf(from) < 0n ? -balanceOf(from) : 0n;
  const receiverIsOwed = balanceOf(to) > 0n ? balanceOf(to) : 0n;
  const warnings: SettlementWarning[] = [];
  if (amount > payerOwes) warnings.push('payer_owes_less');
  if (amount > receiverIsOwed) warnings.push('receiver_is_owed_less');
  return warnings;
}
