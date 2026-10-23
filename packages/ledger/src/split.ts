import { allocate, assertInRange } from '@app/money';
import { LedgerError } from './errors';

/** Group-scoped member id; the ledger never references user accounts directly. */
export type MemberId = string;

export interface Share {
  memberId: MemberId;
  amount: bigint;
}

export type SplitInput =
  | { method: 'equal'; members: readonly MemberId[] }
  /** Exact minor-unit amounts; must sum to the total. */
  | { method: 'exact'; amounts: readonly Share[] }
  /** Basis points (1% = 100); must sum to 10,000. */
  | { method: 'percent'; basisPoints: readonly { memberId: MemberId; basisPoints: number }[] }
  /** Relative weights such as nights stayed or "2 shares for a couple"; up to 2 decimals. */
  | { method: 'shares'; shares: readonly { memberId: MemberId; shares: string }[] };

const SHARES = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Splits a positive total among participants. Output is sorted by member id and always sums
 * exactly to `total`. `seed` (the expense id) drives the fair rounding tie-break.
 */
export function computeShares(total: bigint, split: SplitInput, seed: string): Share[] {
  if (total <= 0n) throw new LedgerError('invalid_total', 'Total must be positive');
  assertInRange(total);

  switch (split.method) {
    case 'equal': {
      const members = sortedUnique(split.members);
      return zip(members, allocate(total, members.map(() => 1n), members, seed));
    }
    case 'exact': {
      const rows = sortedRows(split.amounts);
      let assigned = 0n;
      for (const row of rows) {
        if (row.amount < 0n) throw new LedgerError('invalid_share', 'Exact amounts cannot be negative');
        assigned += row.amount;
      }
      if (assigned !== total) {
        throw new LedgerError('exact_mismatch', `Exact amounts sum to ${assigned}, expected ${total}`);
      }
      return rows.map(({ memberId, amount }) => ({ memberId, amount }));
    }
    case 'percent': {
      const rows = sortedRows(split.basisPoints);
      let points = 0;
      for (const row of rows) {
        if (!Number.isInteger(row.basisPoints) || row.basisPoints < 0) {
          throw new LedgerError('invalid_share', 'Percentages must be whole basis points');
        }
        points += row.basisPoints;
      }
      if (points !== 10_000) {
        throw new LedgerError('percent_mismatch', `Percentages sum to ${points / 100}%, expected 100%`);
      }
      const members = rows.map((r) => r.memberId);
      return zip(members, allocate(total, rows.map((r) => BigInt(r.basisPoints)), members, seed));
    }
    case 'shares': {
      const rows = sortedRows(split.shares);
      const weights = rows.map((r) => parseShares(r.shares));
      if (weights.every((w) => w === 0n)) {
        throw new LedgerError('invalid_share', 'At least one member needs a positive share');
      }
      const members = rows.map((r) => r.memberId);
      return zip(members, allocate(total, weights, members, seed));
    }
  }
}

/** Shares as hundredths, e.g. "1.5" → 150n. */
function parseShares(value: string): bigint {
  const match = SHARES.exec(value.trim());
  if (!match) throw new LedgerError('invalid_share', `Invalid share: "${value}"`);
  const [, whole = '0', fraction = ''] = match;
  return BigInt(whole + fraction.padEnd(2, '0'));
}

function sortedUnique(members: readonly MemberId[]): MemberId[] {
  if (members.length === 0) throw new LedgerError('no_participants', 'Choose at least one participant');
  if (new Set(members).size !== members.length) {
    throw new LedgerError('duplicate_member', 'A member appears twice in the split');
  }
  return [...members].sort();
}

function sortedRows<T extends { memberId: MemberId }>(rows: readonly T[]): T[] {
  sortedUnique(rows.map((r) => r.memberId));
  return [...rows].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

function zip(members: MemberId[], amounts: bigint[]): Share[] {
  return members.map((memberId, i) => ({ memberId, amount: amounts[i]! }));
}
