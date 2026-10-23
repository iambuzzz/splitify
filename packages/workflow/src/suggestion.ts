import { type Actor, type MemberId, type Result, fail } from './types';

export type SuggestionStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'outdated';

export interface SuggestionState {
  status: SuggestionStatus;
  authorId: MemberId;
  /** Expense version the suggestion was written against. */
  baseVersion: number;
}

export interface SuggestionContext {
  expenseOwnerIds: readonly MemberId[];
  currentExpenseVersion: number;
}

export type SuggestionAction =
  | { type: 'accept' }
  | { type: 'decline'; reason: string }
  | { type: 'withdraw' }
  /** System: the expense changed underneath the suggestion. */
  | { type: 'mark_outdated' };

/** `apply_edit`: the caller applies the suggested version as an owner edit (review policy still applies). */
export type SuggestionEffect = { kind: 'apply_edit'; baseVersion: number };

export type SuggestionResult = Result<SuggestionState, SuggestionEffect>;

export function transitionSuggestion(
  state: SuggestionState,
  action: SuggestionAction,
  actor: Actor | null,
  ctx: SuggestionContext,
): SuggestionResult {
  if (state.status !== 'open') return fail('invalid_state');

  switch (action.type) {
    case 'accept': {
      if (!actor || !ctx.expenseOwnerIds.includes(actor.memberId)) return fail('forbidden');
      if (ctx.currentExpenseVersion !== state.baseVersion) return fail('stale_version');
      return {
        ok: true,
        state: { ...state, status: 'accepted' },
        effects: [{ kind: 'apply_edit', baseVersion: state.baseVersion }],
      };
    }
    case 'decline': {
      if (!actor || !ctx.expenseOwnerIds.includes(actor.memberId)) return fail('forbidden');
      if (action.reason.trim() === '') return fail('reason_required');
      return { ok: true, state: { ...state, status: 'declined' }, effects: [] };
    }
    case 'withdraw': {
      if (!actor || actor.memberId !== state.authorId) return fail('forbidden');
      return { ok: true, state: { ...state, status: 'withdrawn' }, effects: [] };
    }
    case 'mark_outdated': {
      if (ctx.currentExpenseVersion === state.baseVersion) return fail('invalid_state');
      return { ok: true, state: { ...state, status: 'outdated' }, effects: [] };
    }
  }
}
