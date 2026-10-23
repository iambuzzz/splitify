import { describe, expect, it } from 'vitest';
import { type Actor, type SuggestionState, transitionSuggestion } from '../src';

const OWNER: Actor = { memberId: 'A', role: 'member' };
const AUTHOR: Actor = { memberId: 'C', role: 'member' };
const ADMIN: Actor = { memberId: 'G', role: 'admin' };
const open: SuggestionState = { status: 'open', authorId: 'C', baseVersion: 3 };
const ctx = (currentExpenseVersion = 3) => ({ expenseOwnerIds: ['A'], currentExpenseVersion });

describe('suggestions', () => {
  it('the expense owner accepts with one tap, producing an edit to apply', () => {
    expect(transitionSuggestion(open, { type: 'accept' }, OWNER, ctx())).toEqual({
      ok: true,
      state: { ...open, status: 'accepted' },
      effects: [{ kind: 'apply_edit', baseVersion: 3 }],
    });
  });

  it('nobody but the expense owner can accept or decline, including admins', () => {
    for (const actor of [AUTHOR, ADMIN]) {
      expect(transitionSuggestion(open, { type: 'accept' }, actor, ctx())).toEqual({ ok: false, error: 'forbidden' });
      expect(transitionSuggestion(open, { type: 'decline', reason: 'no' }, actor, ctx())).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
  });

  it('accepting against a changed expense is refused as stale', () => {
    expect(transitionSuggestion(open, { type: 'accept' }, OWNER, ctx(4))).toEqual({ ok: false, error: 'stale_version' });
    expect(transitionSuggestion(open, { type: 'mark_outdated' }, null, ctx(4))).toMatchObject({
      ok: true,
      state: { status: 'outdated' },
    });
    expect(transitionSuggestion(open, { type: 'mark_outdated' }, null, ctx(3))).toEqual({
      ok: false,
      error: 'invalid_state',
    });
  });

  it('declines need a reason; only the author withdraws', () => {
    expect(transitionSuggestion(open, { type: 'decline', reason: '' }, OWNER, ctx())).toEqual({
      ok: false,
      error: 'reason_required',
    });
    expect(transitionSuggestion(open, { type: 'decline', reason: 'Breakfast was separate' }, OWNER, ctx())).toEqual({
      ok: true,
      state: { ...open, status: 'declined' },
      effects: [],
    });
    expect(transitionSuggestion(open, { type: 'withdraw' }, OWNER, ctx())).toEqual({ ok: false, error: 'forbidden' });
    expect(transitionSuggestion(open, { type: 'withdraw' }, AUTHOR, ctx())).toMatchObject({ state: { status: 'withdrawn' } });
  });

  it('closed suggestions accept no further actions', () => {
    for (const status of ['accepted', 'declined', 'withdrawn', 'outdated'] as const) {
      expect(transitionSuggestion({ ...open, status }, { type: 'accept' }, OWNER, ctx())).toEqual({
        ok: false,
        error: 'invalid_state',
      });
    }
  });
});
