import { LedgerError } from './errors';
import { type Posting, reversePostings } from './postings';

export type SourceType = 'expense' | 'settlement';

/** One atomic write to the ledger: all postings for a source version, or their reversal. */
export interface JournalBatch {
  readonly seq: number;
  readonly sourceType: SourceType;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly direction: 'post' | 'reverse';
  readonly postings: readonly Readonly<Posting>[];
}

/**
 * Append-only ledger: the reference model for the R1 database table. There is no way to update
 * or delete a batch; corrections are new `reverse` + `post` batches (I4). Each source can have
 * at most one version posted at a time, so replays of the same post (e.g. a duplicated
 * settlement confirmation) are refused rather than double-counted.
 */
export class LedgerJournal {
  readonly #batches: JournalBatch[] = [];
  readonly #posted = new Map<string, JournalBatch>();

  post(sourceType: SourceType, sourceId: string, sourceVersion: number, postings: readonly Posting[]): JournalBatch {
    const key = sourceKey(sourceType, sourceId);
    if (this.#posted.has(key)) {
      throw new LedgerError('already_posted', `${key} already has version ${this.#posted.get(key)!.sourceVersion} posted`);
    }
    let total = 0n;
    for (const p of postings) total += p.amount;
    if (total !== 0n) throw new LedgerError('unbalanced', `Postings for ${key} sum to ${total}, expected 0`);

    const batch = this.#append({ sourceType, sourceId, sourceVersion, direction: 'post', postings });
    this.#posted.set(key, batch);
    return batch;
  }

  reverse(sourceType: SourceType, sourceId: string, sourceVersion: number): JournalBatch {
    const key = sourceKey(sourceType, sourceId);
    const posted = this.#posted.get(key);
    if (!posted) throw new LedgerError('not_posted', `${key} has nothing posted to reverse`);
    if (posted.sourceVersion !== sourceVersion) {
      throw new LedgerError('version_mismatch', `${key} has version ${posted.sourceVersion} posted, not ${sourceVersion}`);
    }
    const batch = this.#append({
      sourceType,
      sourceId,
      sourceVersion,
      direction: 'reverse',
      postings: reversePostings(posted.postings),
    });
    this.#posted.delete(key);
    return batch;
  }

  /** All batches in write order. The returned array and its contents are frozen. */
  batches(): readonly JournalBatch[] {
    return Object.freeze([...this.#batches]);
  }

  postings(): Posting[] {
    return this.#batches.flatMap((b) => b.postings.map((p) => ({ ...p })));
  }

  #append(batch: Omit<JournalBatch, 'seq'>): JournalBatch {
    const frozen: JournalBatch = Object.freeze({
      ...batch,
      seq: this.#batches.length + 1,
      postings: Object.freeze(batch.postings.map((p) => Object.freeze({ memberId: p.memberId, amount: p.amount }))),
    });
    this.#batches.push(frozen);
    return frozen;
  }
}

export function sourceKey(sourceType: SourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}
