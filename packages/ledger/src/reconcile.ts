import { computeBalances } from './balances';
import { type JournalBatch, type SourceType, sourceKey } from './journal';
import type { Posting } from './postings';
import type { MemberId } from './split';

/** What the ledger should contain for one counted source: an active expense version or a confirmed settlement. */
export interface ExpectedSource {
  sourceType: SourceType;
  sourceId: string;
  sourceVersion: number;
  postings: readonly Posting[];
}

export type SourceIssue =
  | { sourceKey: string; issue: 'missing' }
  | { sourceKey: string; issue: 'unexpected'; postedVersion: number }
  | { sourceKey: string; issue: 'wrong_version'; expected: number; posted: number }
  | { sourceKey: string; issue: 'amount_mismatch'; memberId: MemberId; expected: bigint; actual: bigint };

export interface ReconciliationReport {
  ok: boolean;
  issues: SourceIssue[];
}

/**
 * Checks invariant I5: the journal equals the postings of exactly the counted sources, no more
 * and no less. Run nightly in production (and after any incident); any issue pages on-call.
 */
export function reconcile(expected: readonly ExpectedSource[], batches: readonly JournalBatch[]): ReconciliationReport {
  // Replay the journal: which version of each source is currently posted, and its net effect.
  const posted = new Map<string, number>();
  const net = new Map<string, Posting[]>();
  for (const batch of batches) {
    const key = sourceKey(batch.sourceType, batch.sourceId);
    if (batch.direction === 'post') posted.set(key, batch.sourceVersion);
    else posted.delete(key);
    net.set(key, [...(net.get(key) ?? []), ...batch.postings]);
  }

  const issues: SourceIssue[] = [];
  const expectedKeys = new Set<string>();

  for (const source of expected) {
    const key = sourceKey(source.sourceType, source.sourceId);
    expectedKeys.add(key);
    const postedVersion = posted.get(key);
    if (postedVersion === undefined) {
      issues.push({ sourceKey: key, issue: 'missing' });
      continue;
    }
    if (postedVersion !== source.sourceVersion) {
      issues.push({ sourceKey: key, issue: 'wrong_version', expected: source.sourceVersion, posted: postedVersion });
    }
    issues.push(...amountDiffs(key, source.postings, net.get(key) ?? []));
  }

  for (const [key, postedVersion] of posted) {
    if (!expectedKeys.has(key)) issues.push({ sourceKey: key, issue: 'unexpected', postedVersion });
  }
  // Sources fully reversed must net to zero; anything left over is a leak.
  for (const [key, postings] of net) {
    if (!expectedKeys.has(key) && !posted.has(key)) issues.push(...amountDiffs(key, [], postings));
  }

  return { ok: issues.length === 0, issues };
}

function amountDiffs(key: string, expected: readonly Posting[], actual: readonly Posting[]): SourceIssue[] {
  const want = new Map(computeBalances(expected).map((b) => [b.memberId, b.amount]));
  const have = new Map(computeBalances(actual).map((b) => [b.memberId, b.amount]));
  const members = [...new Set([...want.keys(), ...have.keys()])].sort();
  return members
    .filter((m) => (want.get(m) ?? 0n) !== (have.get(m) ?? 0n))
    .map((memberId) => ({
      sourceKey: key,
      issue: 'amount_mismatch' as const,
      memberId,
      expected: want.get(memberId) ?? 0n,
      actual: have.get(memberId) ?? 0n,
    }));
}
