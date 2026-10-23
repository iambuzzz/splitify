import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Actor,
  type ExpenseAction,
  type ExpenseContext,
  type ExpenseResult,
  type ExpenseState,
  REVIEW_OFF,
  type ReviewPolicy,
  newDraft,
  transitionExpense,
} from '../src';

// A pays for A, B, C, D. A is the expense owner; G is a group admin not on the expense.
const A: Actor = { memberId: 'A', role: 'member' };
const B: Actor = { memberId: 'B', role: 'member' };
const C: Actor = { memberId: 'C', role: 'member' };
const G: Actor = { memberId: 'G', role: 'admin' };
const AFFECTED = ['A', 'B', 'C', 'D'];

const review = (approvalsRequired = 1, thresholdMinor = 500000n): ReviewPolicy => ({
  enabled: true,
  thresholdMinor,
  approvalsRequired,
});
const ctx = (policy: ReviewPolicy = REVIEW_OFF, affected = AFFECTED): ExpenseContext => ({ policy, affected });

/** An action as a client would send it after loading the latest state (baseVersion filled in). */
type Intent = ExpenseAction extends infer T ? (T extends { baseVersion: number } ? Omit<T, 'baseVersion'> : T) : never;

function withBase(state: ExpenseState, intent: Intent): ExpenseAction {
  return (
    ['submit', 'edit', 'delete', 'restore', 'dispute'].includes(intent.type)
      ? { ...intent, baseVersion: state.version }
      : intent
  ) as ExpenseAction;
}

function act(state: ExpenseState, intent: Intent, actor: Actor, c: ExpenseContext = ctx()): ExpenseResult {
  return transitionExpense(state, withBase(state, intent), actor, c);
}

function run(state: ExpenseState, steps: [Intent, Actor, ExpenseContext?][]): ExpenseState {
  for (const [intent, actor, c] of steps) {
    const result = act(state, intent, actor, c);
    if (!result.ok) throw new Error(`${intent.type} by ${actor.memberId} failed: ${result.error}`);
    state = result.state;
  }
  return state;
}

const hotel = () => newDraft(['A'], 600000n);
const active = () => run(hotel(), [[{ type: 'submit' }, A]]);

describe('expense transitions: trust mode (review off)', () => {
  it('submit posts immediately', () => {
    const result = act(hotel(), { type: 'submit' }, A);
    expect(result).toMatchObject({ ok: true, state: { status: 'active', postedVersion: 1 } });
    expect(result.ok && result.effects).toEqual([{ kind: 'post', version: 1 }]);
  });

  it('only expense owners can submit or edit', () => {
    expect(act(hotel(), { type: 'submit' }, B)).toEqual({ ok: false, error: 'forbidden' });
    expect(act(active(), { type: 'edit', material: true, ledgerTotal: 1n }, G)).toEqual({ ok: false, error: 'forbidden' });
  });

  it('a material edit reverses the old version and posts the new one', () => {
    const result = act(active(), { type: 'edit', material: true, ledgerTotal: 540000n }, A);
    expect(result.ok && result.effects).toEqual([
      { kind: 'reverse', version: 1 },
      { kind: 'post', version: 2 },
    ]);
    expect(result.ok && result.state).toMatchObject({ version: 2, postedVersion: 2, ledgerTotal: 540000n });
  });

  it('a non-material edit bumps the version without touching the ledger', () => {
    const result = act(active(), { type: 'edit', material: false, ledgerTotal: 600000n }, A);
    expect(result.ok && result.effects).toEqual([]);
    expect(result.ok && result.state).toMatchObject({ version: 2, postedVersion: 1 });
  });

  it('disputes: affected non-owners only, need a reason, are idempotent, and clear on a material edit', () => {
    expect(act(active(), { type: 'dispute', reason: 'x' }, A)).toEqual({ ok: false, error: 'not_eligible' });
    expect(act(active(), { type: 'dispute', reason: 'x' }, G)).toEqual({ ok: false, error: 'not_eligible' });
    expect(act(active(), { type: 'dispute', reason: ' ' }, B)).toEqual({ ok: false, error: 'reason_required' });

    const disputed = run(active(), [[{ type: 'dispute', reason: 'I arrived a day later' }, C]]);
    expect(disputed.disputedBy).toEqual(['C']);
    expect(act(disputed, { type: 'dispute', reason: 'again' }, C)).toMatchObject({ duplicate: true });

    expect(act(disputed, { type: 'withdraw_dispute' }, B)).toEqual({ ok: false, error: 'invalid_state' });
    expect(run(disputed, [[{ type: 'withdraw_dispute' }, C]]).disputedBy).toEqual([]);

    const fixed = act(disputed, { type: 'edit', material: true, ledgerTotal: 550000n }, A);
    expect(fixed.ok && fixed.state.disputedBy).toEqual([]);
    expect(fixed.ok && fixed.effects).toContainEqual({ kind: 'disputes_cleared' });
  });

  it('delete reverses; restore reposts the same version', () => {
    const deleted = act(active(), { type: 'delete' }, A);
    expect(deleted.ok && deleted.effects).toEqual([{ kind: 'reverse', version: 1 }]);
    const restored = act(deleted.ok ? deleted.state : active(), { type: 'restore' }, A);
    expect(restored.ok && restored.effects).toEqual([{ kind: 'post', version: 1 }]);
  });

  it('a group admin can remove an expense they do not own, and it is flagged for audit', () => {
    const result = act(active(), { type: 'delete' }, G);
    expect(result.ok && result.effects).toContainEqual({ kind: 'admin_override', action: 'delete' });
    expect(act(active(), { type: 'delete' }, B)).toEqual({ ok: false, error: 'forbidden' });
    expect(act(hotel(), { type: 'delete' }, G)).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('concurrent edits (optimistic concurrency)', () => {
  it('the second of two edits based on the same version is refused, then succeeds after reloading', () => {
    const shared = newDraft(['A', 'B'], 600000n); // A created, B paid: both may edit
    const v1 = run(shared, [[{ type: 'submit' }, A]]);

    // Both phones loaded v1. A saves first.
    const first = transitionExpense(v1, { type: 'edit', baseVersion: 1, material: true, ledgerTotal: 540000n }, A, ctx());
    expect(first.ok).toBe(true);
    const v2 = first.ok ? first.state : v1;

    // B's edit was based on v1, so it must not silently overwrite A's change.
    expect(transitionExpense(v2, { type: 'edit', baseVersion: 1, material: true, ledgerTotal: 500000n }, B, ctx())).toEqual({
      ok: false,
      error: 'stale_version',
    });

    // After reloading (and seeing A's diff), B can re-apply on top of v2.
    const retried = transitionExpense(v2, { type: 'edit', baseVersion: 2, material: true, ledgerTotal: 500000n }, B, ctx());
    expect(retried.ok && retried.state).toMatchObject({ version: 3, postedVersion: 3 });
    expect(retried.ok && retried.effects).toEqual([
      { kind: 'reverse', version: 2 },
      { kind: 'post', version: 3 },
    ]);
  });

  it('stale deletes, restores, submits and disputes are refused too', () => {
    const v2 = run(active(), [[{ type: 'edit', material: false, ledgerTotal: 600000n }, A]]);
    expect(transitionExpense(v2, { type: 'delete', baseVersion: 1 }, A, ctx())).toEqual({ ok: false, error: 'stale_version' });
    expect(transitionExpense(v2, { type: 'dispute', baseVersion: 1, reason: 'x' }, B, ctx())).toEqual({
      ok: false,
      error: 'stale_version',
    });
    const draftV2 = run(hotel(), [[{ type: 'edit', material: true, ledgerTotal: 1n }, A]]);
    expect(transitionExpense(draftV2, { type: 'submit', baseVersion: 1 }, A, ctx())).toEqual({ ok: false, error: 'stale_version' });
    const deleted = run(v2, [[{ type: 'delete' }, A]]);
    expect(transitionExpense(deleted, { type: 'restore', baseVersion: 1 }, A, ctx())).toEqual({ ok: false, error: 'stale_version' });
  });
});

describe('expense transitions: review mode', () => {
  it('below the threshold, review is skipped', () => {
    const result = act(newDraft(['A'], 120000n), { type: 'submit' }, A, ctx(review()));
    expect(result.ok && result.state.status).toBe('active');
  });

  it('a new expense above the threshold is not counted until approved', () => {
    const pending = run(hotel(), [[{ type: 'submit' }, A, ctx(review())]]);
    expect(pending).toMatchObject({ status: 'in_review', postedVersion: null });

    const approved = act(pending, { type: 'approve', version: 1 }, B, ctx(review()));
    expect(approved.ok && approved.state).toMatchObject({ status: 'active', postedVersion: 1 });
    expect(approved.ok && approved.effects).toContainEqual({ kind: 'post', version: 1 });
  });

  it('the author cannot approve their own expense; non-affected members cannot either', () => {
    const pending = run(hotel(), [[{ type: 'submit' }, A, ctx(review())]]);
    expect(act(pending, { type: 'approve', version: 1 }, A, ctx(review()))).toEqual({ ok: false, error: 'not_eligible' });
    expect(act(pending, { type: 'approve', version: 1 }, G, ctx(review()))).toEqual({ ok: false, error: 'not_eligible' });
  });

  it('decisions are bound to a version: a material edit restarts review and discards OKs', () => {
    const policy = ctx(review(2));
    let state = run(hotel(), [
      [{ type: 'submit' }, A, policy],
      [{ type: 'approve', version: 1 }, B, policy],
      [{ type: 'edit', material: true, ledgerTotal: 650000n }, A, policy],
    ]);
    expect(state.review).toMatchObject({ version: 2, approvals: [] });
    expect(act(state, { type: 'approve', version: 1 }, C, policy)).toEqual({ ok: false, error: 'stale_version' });
    state = run(state, [
      [{ type: 'approve', version: 2 }, B, policy],
      [{ type: 'approve', version: 2 }, C, policy],
    ]);
    expect(state).toMatchObject({ status: 'active', postedVersion: 2, ledgerTotal: 650000n });
  });

  it('a non-material edit during review keeps existing OKs valid', () => {
    const policy = ctx(review(2));
    const state = run(hotel(), [
      [{ type: 'submit' }, A, policy],
      [{ type: 'approve', version: 1 }, B, policy],
      [{ type: 'edit', material: false, ledgerTotal: 600000n }, A, policy],
      [{ type: 'approve', version: 1 }, C, policy],
    ]);
    expect(state.status).toBe('active');
  });

  it('duplicate approvals are idempotent', () => {
    const policy = ctx(review(2));
    const once = run(hotel(), [
      [{ type: 'submit' }, A, policy],
      [{ type: 'approve', version: 1 }, B, policy],
    ]);
    const twice = act(once, { type: 'approve', version: 1 }, B, policy);
    expect(twice).toMatchObject({ ok: true, duplicate: true, effects: [] });
    expect(twice.ok && twice.state.review?.approvals).toEqual(['B']);
  });

  it('a decline returns a new expense to draft and needs a reason', () => {
    const pending = run(hotel(), [[{ type: 'submit' }, A, ctx(review())]]);
    expect(act(pending, { type: 'decline', version: 1, reason: '' }, B, ctx(review()))).toEqual({
      ok: false,
      error: 'reason_required',
    });
    const declined = run(pending, [[{ type: 'decline', version: 1, reason: 'Wrong hotel' }, B, ctx(review())]]);
    expect(declined).toMatchObject({ status: 'draft', review: null, postedVersion: null });
  });

  it('a material edit of an active expense keeps the old version counted until approved', () => {
    const policy = ctx(review());
    const pending = run(active(), [[{ type: 'edit', material: true, ledgerTotal: 700000n }, A, policy]]);
    expect(pending).toMatchObject({ status: 'active', postedVersion: 1, ledgerTotal: 600000n, review: { kind: 'edit', version: 2 } });

    const approved = act(pending, { type: 'approve', version: 2 }, C, policy);
    expect(approved.ok && approved.effects).toEqual([
      { kind: 'review_closed', outcome: 'approved' },
      { kind: 'reverse', version: 1 },
      { kind: 'post', version: 2 },
    ]);

    const declined = run(pending, [[{ type: 'decline', version: 2, reason: 'No' }, C, policy]]);
    expect(declined).toMatchObject({ status: 'active', postedVersion: 1, review: null });
  });

  it('a shrinking edit is reviewed when the old amount was above the threshold', () => {
    const pending = run(active(), [[{ type: 'edit', material: true, ledgerTotal: 100n }, A, ctx(review())]]);
    expect(pending.review).not.toBeNull();
  });

  it('members leaving shrink the requirement; with nobody eligible the review passes', () => {
    const policy = review(2);
    const pending = run(hotel(), [
      [{ type: 'submit' }, A, ctx(policy)],
      [{ type: 'approve', version: 1 }, B, ctx(policy)],
    ]);
    // C and D leave; only B remains eligible, and B already approved.
    const result = act(pending, { type: 'reevaluate_review' }, A, ctx(policy, ['A', 'B']));
    expect(result.ok && result.state.status).toBe('active');

    // Approvals from members who left no longer count.
    const stillPending = act(pending, { type: 'reevaluate_review' }, A, ctx(policy, ['A', 'C', 'D']));
    expect(stillPending.ok && stillPending.state.status).toBe('in_review');

    const solo = act(newDraft(['A'], 900000n), { type: 'submit' }, A, ctx(policy, ['A']));
    expect(solo.ok && solo.state.status).toBe('active');
  });

  it('only the author can withdraw a review', () => {
    const pending = run(hotel(), [[{ type: 'submit' }, A, ctx(review())]]);
    expect(act(pending, { type: 'withdraw_review' }, B, ctx(review()))).toEqual({ ok: false, error: 'forbidden' });
    expect(run(pending, [[{ type: 'withdraw_review' }, A, ctx(review())]]).status).toBe('draft');
  });
});

describe('expense invariants under random action sequences', () => {
  const actors = [A, B, C, G];
  const base = fc.integer({ min: 1, max: 8 });
  const actionArb: fc.Arbitrary<ExpenseAction> = fc.oneof(
    base.map<ExpenseAction>((baseVersion) => ({ type: 'submit', baseVersion })),
    fc
      .record({ baseVersion: base, material: fc.boolean(), ledgerTotal: fc.bigInt({ min: 1n, max: 2_000_000n }) })
      .map<ExpenseAction>((e) => ({ type: 'edit', ...e })),
    base.map<ExpenseAction>((version) => ({ type: 'approve', version })),
    base.map<ExpenseAction>((version) => ({ type: 'decline', version, reason: 'no' })),
    fc.constant<ExpenseAction>({ type: 'withdraw_review' }),
    fc.constant<ExpenseAction>({ type: 'reevaluate_review' }),
    base.map<ExpenseAction>((baseVersion) => ({ type: 'delete', baseVersion })),
    base.map<ExpenseAction>((baseVersion) => ({ type: 'restore', baseVersion })),
    base.map<ExpenseAction>((baseVersion) => ({ type: 'dispute', baseVersion, reason: 'wrong' })),
    fc.constant<ExpenseAction>({ type: 'withdraw_dispute' }),
  );

  it('ledger effects mirror postedVersion; only active expenses count; stale writes never apply (I5, I6, I8)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(actionArb, fc.constantFrom(...actors)), { maxLength: 60 }),
        fc.boolean(),
        fc.integer({ min: 1, max: 3 }),
        (steps, reviewOn, approvalsRequired) => {
          const c = ctx(reviewOn ? review(approvalsRequired, 300000n) : REVIEW_OFF);
          let state = hotel();
          let ledgerVersion: number | null = null;

          for (const [action, actor] of steps) {
            const result = transitionExpense(state, action, actor, c);
            if (!result.ok) {
              if ('baseVersion' in action && action.baseVersion !== state.version) {
                expect(result.error).toBe('stale_version');
              }
              continue;
            }
            if ('baseVersion' in action) expect(action.baseVersion).toBe(state.version);
            for (const effect of result.effects) {
              if (effect.kind === 'reverse') {
                expect(ledgerVersion).toBe(effect.version);
                ledgerVersion = null;
              }
              if (effect.kind === 'post') {
                expect(ledgerVersion).toBeNull();
                ledgerVersion = effect.version;
              }
            }
            expect(result.state.version).toBeGreaterThanOrEqual(state.version);
            state = result.state;
            expect(ledgerVersion).toBe(state.postedVersion);
            expect(state.postedVersion !== null).toBe(state.status === 'active');
            if (state.review) expect(state.review.approvals).not.toContain(state.review.authorId);
            expect(state.disputedBy).not.toContain('A');
          }
        },
      ),
      { numRuns: 4000 },
    );
  });
});
