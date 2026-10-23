import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ExpectedSource,
  type ExpenseVersionInput,
  LedgerJournal,
  breakdownExpense,
  computeBalances,
  reconcile,
  settlementPostings,
  simplifyDebts,
} from '@app/ledger';
import {
  type Actor,
  type ExpenseAction,
  type ExpenseState,
  IdempotencyRegistry,
  REVIEW_OFF,
  type ReviewPolicy,
  type SettlementAction,
  type SettlementState,
  newDraft,
  recordSettlement,
  transitionExpense,
  transitionSettlement,
} from '@app/workflow';

/**
 * Simulates the R1 command path in memory: idempotency check → workflow transition → ledger
 * journal writes for the emitted effects. After every command the journal must reconcile with
 * the counted sources (I5), balances must sum to zero (I3), and replayed commands must not
 * change anything (I7).
 */
const MEMBERS = ['A', 'B', 'C', 'D'];
const actorFor = (id: string): Actor => ({ memberId: id, role: id === 'A' ? 'admin' : 'member' });

interface ExpenseRecord {
  state: ExpenseState;
  versions: Map<number, ExpenseVersionInput>;
}

class Group {
  readonly journal = new LedgerJournal();
  readonly expenses = new Map<string, ExpenseRecord>();
  readonly settlements = new Map<string, SettlementState>();
  readonly idempotency = new IdempotencyRegistry<boolean>();

  constructor(readonly policy: ReviewPolicy) {}

  content(id: string, owner: string, total: bigint, participants: string[]): ExpenseVersionInput {
    return {
      expenseId: id,
      kind: 'expense',
      currency: 'INR',
      total,
      payers: [{ memberId: owner, amount: total }],
      split: { method: 'equal', members: participants },
    };
  }

  createDraft(id: string, owner: string, total: bigint, participants: string[]): void {
    const versions = new Map([[1, this.content(id, owner, total, participants)]]);
    this.expenses.set(id, { state: newDraft([owner], total), versions });
  }

  affected(record: ExpenseRecord): string[] {
    const ids = new Set<string>();
    for (const v of [record.state.postedVersion, record.state.review?.version, record.state.version]) {
      const content = v === null || v === undefined ? undefined : record.versions.get(v);
      if (!content) continue;
      content.payers.forEach((p) => ids.add(p.memberId));
      if (content.split.method === 'equal') content.split.members.forEach((m) => ids.add(m));
    }
    return [...ids].filter((id) => MEMBERS.includes(id));
  }

  /** Returns true if the command changed state. */
  expenseCommand(id: string, action: ExpenseAction, actorId: string, newContent?: ExpenseVersionInput): boolean {
    const record = this.expenses.get(id)!;
    const result = transitionExpense(record.state, action, actorFor(actorId), { policy: this.policy, affected: this.affected(record) });
    if (!result.ok || result.duplicate) return false;
    if (action.type === 'edit') {
      const previous = record.versions.get(record.state.version)!;
      record.versions.set(result.state.version, action.material && newContent ? newContent : previous);
    }
    for (const effect of result.effects) {
      if (effect.kind === 'reverse') this.journal.reverse('expense', id, effect.version);
      if (effect.kind === 'post') {
        this.journal.post('expense', id, effect.version, breakdownExpense(record.versions.get(effect.version)!, 'INR').postings);
      }
    }
    record.state = result.state;
    return true;
  }

  recordPayment(id: string, from: string, to: string, amount: bigint, actorId: string): boolean {
    if (this.settlements.has(id)) return false;
    const result = recordSettlement({ from, to, amount }, actorFor(actorId));
    if (!result.ok) return false;
    this.settlements.set(id, result.state);
    if (result.effects.some((e) => e.kind === 'post')) this.journal.post('settlement', id, 1, settlementPostings(from, to, amount));
    return true;
  }

  settlementCommand(id: string, action: SettlementAction, actorId: string): boolean {
    const state = this.settlements.get(id);
    if (!state) return false;
    const result = transitionSettlement(state, action, actorFor(actorId));
    if (!result.ok || result.duplicate) return false;
    for (const effect of result.effects) {
      if (effect.kind === 'post') this.journal.post('settlement', id, 1, settlementPostings(state.from, state.to, state.amount));
      if (effect.kind === 'reverse') this.journal.reverse('settlement', id, 1);
    }
    this.settlements.set(id, result.state);
    return true;
  }

  expected(): ExpectedSource[] {
    const sources: ExpectedSource[] = [];
    for (const [id, { state, versions }] of this.expenses) {
      if (state.postedVersion === null) continue;
      sources.push({
        sourceType: 'expense',
        sourceId: id,
        sourceVersion: state.postedVersion,
        postings: breakdownExpense(versions.get(state.postedVersion)!, 'INR').postings,
      });
    }
    for (const [id, s] of this.settlements) {
      if (s.status === 'confirmed') {
        sources.push({ sourceType: 'settlement', sourceId: id, sourceVersion: 1, postings: settlementPostings(s.from, s.to, s.amount) });
      }
    }
    return sources;
  }

  assertConsistent(): void {
    const report = reconcile(this.expected(), this.journal.batches());
    expect(report.issues).toEqual([]);
    const balances = computeBalances(this.journal.postings());
    expect(balances.reduce((a, b) => a + b.amount, 0n)).toBe(0n);
  }
}

describe('Goa trip, end to end', () => {
  it('expenses, a reviewed edit, a dispute, a deletion and settlements keep the ledger consistent', () => {
    const g = new Group({ enabled: true, thresholdMinor: 500000n, approvalsRequired: 1 });
    // Hotel ₹6,000 paid by A for all four; needs review (≥ ₹5,000).
    g.createDraft('hotel', 'A', 600000n, MEMBERS);
    g.expenseCommand('hotel', { type: 'submit', baseVersion: 1 }, 'A');
    expect(g.journal.batches()).toHaveLength(0); // pending review: not counted
    g.expenseCommand('hotel', { type: 'approve', version: 1 }, 'B');
    g.assertConsistent();

    // Dinner ₹2,400 paid by B, below threshold: counts immediately.
    g.createDraft('dinner', 'B', 240000n, ['A', 'B', 'C']);
    g.expenseCommand('dinner', { type: 'submit', baseVersion: 1 }, 'B');
    g.assertConsistent();

    // C disputes the hotel; A edits it (C arrived late) → review → approved by D.
    g.expenseCommand('hotel', { type: 'dispute', baseVersion: 1, reason: 'I arrived a day later' }, 'C');
    const nights = { ...g.content('hotel', 'A', 600000n, MEMBERS), split: { method: 'shares' as const, shares: [
      { memberId: 'A', shares: '3' }, { memberId: 'B', shares: '3' }, { memberId: 'C', shares: '2' }, { memberId: 'D', shares: '3' },
    ] } };
    g.expenseCommand('hotel', { type: 'edit', baseVersion: 1, material: true, ledgerTotal: 600000n }, 'A', nights);
    expect(g.expenses.get('hotel')!.state.postedVersion).toBe(1); // old version still counted
    g.expenseCommand('hotel', { type: 'approve', version: 2 }, 'D');
    expect(g.expenses.get('hotel')!.state).toMatchObject({ postedVersion: 2, disputedBy: [] });
    g.assertConsistent();

    // A wrong taxi expense is deleted.
    g.createDraft('taxi', 'C', 90000n, MEMBERS);
    g.expenseCommand('taxi', { type: 'submit', baseVersion: 1 }, 'C');
    g.expenseCommand('taxi', { type: 'delete', baseVersion: 1 }, 'C');
    g.assertConsistent();

    // Settle up using the suggested transfers; payer-recorded payments wait for confirmation.
    const transfers = simplifyDebts(computeBalances(g.journal.postings()));
    transfers.forEach((t, i) => {
      g.recordPayment(`pay-${i}`, t.from, t.to, t.amount, t.from);
      g.assertConsistent();
      // Network retry of the confirmation: posted once only.
      g.settlementCommand(`pay-${i}`, { type: 'confirm' }, t.to);
      g.settlementCommand(`pay-${i}`, { type: 'confirm' }, t.to);
      g.assertConsistent();
    });
    expect(computeBalances(g.journal.postings())).toEqual([]);

    // A bounced payment is voided by its receiver: the debt comes back, exactly.
    const first = transfers[0]!;
    g.settlementCommand('pay-0', { type: 'void', reason: 'UPI reversed' }, first.to);
    g.assertConsistent();
    expect(computeBalances(g.journal.postings())).toEqual(
      [
        { memberId: first.from, amount: -first.amount },
        { memberId: first.to, amount: first.amount },
      ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1)),
    );
  });
});

describe('random command sequences', () => {
  const memberArb = fc.constantFrom(...MEMBERS);
  const expenseId = fc.constantFrom('e1', 'e2', 'e3');
  const command = fc.oneof(
    {
      weight: 1,
      arbitrary: fc.record({
      kind: fc.constant('create' as const),
      id: expenseId,
      owner: memberArb,
      total: fc.bigInt({ min: 1n, max: 2_000_000n }),
      participants: fc.subarray(MEMBERS, { minLength: 1 }),
      }),
    },
    {
      weight: 5,
      arbitrary: fc.record({
      kind: fc.constant('expense' as const),
      id: expenseId,
      actor: memberArb,
      // Most real commands come from the expense owner; others still test authorisation.
      asOwner: fc.integer({ min: 0, max: 9 }).map((n) => n < 6),
      type: fc.constantFrom('submit', 'submit', 'edit', 'edit', 'edit', 'approve', 'approve', 'decline', 'withdraw_review', 'delete', 'delete', 'restore', 'dispute', 'withdraw_dispute'),
      material: fc.boolean(),
      stale: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
      total: fc.bigInt({ min: 1n, max: 2_000_000n }),
      participants: fc.subarray(MEMBERS, { minLength: 1 }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
      kind: fc.constant('pay' as const),
      id: fc.constantFrom('s1', 's2', 's3'),
      from: memberArb,
      to: memberArb,
      amount: fc.bigInt({ min: 1n, max: 1_000_000n }),
      byReceiver: fc.boolean(),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
      kind: fc.constant('settle' as const),
      id: fc.constantFrom('s1', 's2', 's3'),
      actor: memberArb,
      type: fc.constantFrom('confirm', 'confirm', 'decline', 'withdraw', 'void'),
      }),
    },
  );

  it('the journal reconciles after every command, and replays change nothing (I3, I5, I7)', () => {
    const seen = { expensePosts: 0, expenseReversals: 0, settlementPosts: 0, settlementReversals: 0, replays: 0 };
    fc.assert(
      fc.property(
        fc.array(fc.tuple(command, fc.boolean()), { minLength: 20, maxLength: 120 }),
        fc.boolean(),
        (commands, reviewOn) => {
          const g = new Group(reviewOn ? { enabled: true, thresholdMinor: 500000n, approvalsRequired: 2 } : REVIEW_OFF);
          let n = 0;

          const apply = (c: (typeof commands)[number][0]): boolean => {
            switch (c.kind) {
              case 'create':
                if (g.expenses.has(c.id)) return false;
                g.createDraft(c.id, c.owner, c.total, c.participants);
                return true;
              case 'expense': {
                const record = g.expenses.get(c.id);
                if (!record) return false;
                const baseVersion = record.state.version - (c.stale ? 1 : 0);
                const reviewVersion = record.state.review?.version ?? record.state.version;
                const action: ExpenseAction =
                  c.type === 'edit'
                    ? { type: 'edit', baseVersion, material: c.material, ledgerTotal: c.total }
                    : c.type === 'approve' || c.type === 'decline'
                      ? c.type === 'approve'
                        ? { type: 'approve', version: reviewVersion }
                        : { type: 'decline', version: reviewVersion, reason: 'no' }
                      : c.type === 'withdraw_review' || c.type === 'withdraw_dispute'
                        ? { type: c.type }
                        : c.type === 'dispute'
                          ? { type: 'dispute', baseVersion, reason: 'wrong' }
                          : { type: c.type, baseVersion };
                const owner = record.versions.get(1)!.payers[0]!.memberId;
                const actor = c.asOwner && c.type !== 'approve' && c.type !== 'decline' && c.type !== 'dispute' ? owner : c.actor;
                return g.expenseCommand(c.id, action, actor, g.content(c.id, owner, c.total, c.participants));
              }
              case 'pay':
                return g.recordPayment(c.id, c.from, c.to, c.amount, c.byReceiver ? c.to : c.from);
              case 'settle':
                return g.settlementCommand(
                  c.id,
                  c.type === 'decline' || c.type === 'void' ? { type: c.type, reason: 'x' } : { type: c.type },
                  c.actor,
                );
            }
          };

          for (const [c, replay] of commands) {
            const key = `cmd-${n++}`;
            g.idempotency.execute(key, c, () => apply(c));
            g.assertConsistent();
            if (replay) {
              // A client retry with the same key and payload: nothing may change.
              const before = g.journal.batches().length;
              const outcome = g.idempotency.execute(key, c, () => apply(c));
              expect(outcome.kind).toBe('replayed');
              expect(g.journal.batches()).toHaveLength(before);
              seen.replays += 1;
            }
          }
          for (const b of g.journal.batches()) {
            if (b.sourceType === 'expense') seen[b.direction === 'post' ? 'expensePosts' : 'expenseReversals'] += 1;
            else seen[b.direction === 'post' ? 'settlementPosts' : 'settlementReversals'] += 1;
          }
        },
      ),
      { numRuns: 1500 },
    );
    // Guard against a vacuous property: the random commands must reach the interesting paths.
    // Typical counts per run are in the hundreds; 20 is a floor that will not flake.
    for (const [path, count] of Object.entries(seen)) expect(count, path).toBeGreaterThan(20);
  });
});
