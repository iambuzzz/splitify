import { type ReviewPolicy, needsReview, reviewSatisfied } from './policy';
import { type Actor, type MemberId, type Result, fail } from './types';

export type ExpenseStatus = 'draft' | 'in_review' | 'active' | 'deleted';

export interface PendingReview {
  /** `create`: a new expense awaiting OKs (not counted). `edit`: a material change to an active expense (old version stays counted). */
  kind: 'create' | 'edit';
  /** Version whose material content is under review; decisions must name it. */
  version: number;
  ledgerTotal: bigint;
  authorId: MemberId;
  approvals: readonly MemberId[];
}

export interface ExpenseState {
  status: ExpenseStatus;
  /** Latest saved version number, bumped by every edit. */
  version: number;
  /** Version whose postings are in the ledger, or null when the expense is not counted. */
  postedVersion: number | null;
  /** Ledger-currency total of `postedVersion` (or of the draft before it is posted). */
  ledgerTotal: bigint;
  /** Members who may edit directly: the creator, and the payer if different. */
  ownerIds: readonly MemberId[];
  disputedBy: readonly MemberId[];
  review: PendingReview | null;
  /** Set on delete when a posted version existed, so restore can repost it. */
  restorableVersion: number | null;
}

export interface ExpenseContext {
  policy: ReviewPolicy;
  /** Current group members whose share or payment this expense touches (old or new version). */
  affected: readonly MemberId[];
}

/**
 * Member actions carry `baseVersion`, the expense version the client was looking at. If the
 * expense has changed since, the action is refused with `stale_version` (HTTP 409) instead of
 * silently overwriting someone else's change. Review decisions name the version under review.
 */
export type ExpenseAction =
  | { type: 'submit'; baseVersion: number }
  | { type: 'edit'; baseVersion: number; material: boolean; ledgerTotal: bigint }
  | { type: 'approve'; version: number }
  | { type: 'decline'; version: number; reason: string }
  | { type: 'withdraw_review' }
  | { type: 'reevaluate_review' }
  | { type: 'delete'; baseVersion: number }
  | { type: 'restore'; baseVersion: number }
  | { type: 'dispute'; baseVersion: number; reason: string }
  | { type: 'withdraw_dispute' };

export type ExpenseEffect =
  | { kind: 'post'; version: number }
  | { kind: 'reverse'; version: number }
  | { kind: 'review_requested'; version: number }
  | { kind: 'review_closed'; outcome: 'approved' | 'declined' | 'withdrawn' | 'restarted' }
  | { kind: 'admin_override'; action: 'delete' | 'restore' }
  | { kind: 'disputes_cleared' };

export type ExpenseResult = Result<ExpenseState, ExpenseEffect>;

export function newDraft(ownerIds: readonly MemberId[], ledgerTotal: bigint): ExpenseState {
  return {
    status: 'draft',
    version: 1,
    postedVersion: null,
    ledgerTotal,
    ownerIds,
    disputedBy: [],
    review: null,
    restorableVersion: null,
  };
}

/**
 * Applies one action to an expense. Pure: the caller persists the new state and executes the
 * effects (ledger postings, notifications) in the same transaction.
 */
export function transitionExpense(
  state: ExpenseState,
  action: ExpenseAction,
  actor: Actor,
  ctx: ExpenseContext,
): ExpenseResult {
  const isOwner = state.ownerIds.includes(actor.memberId);
  const isGroupAdmin = actor.role === 'owner' || actor.role === 'admin';
  if ('baseVersion' in action && action.baseVersion !== state.version) return fail('stale_version');

  switch (action.type) {
    case 'submit': {
      if (state.status !== 'draft') return fail('invalid_state');
      if (!isOwner) return fail('forbidden');
      if (needsReview(ctx.policy, state.ledgerTotal)) {
        return startReview(state, 'create', state.version, state.ledgerTotal, actor.memberId, ctx);
      }
      return ok({ ...state, status: 'active', postedVersion: state.version }, [
        { kind: 'post', version: state.version },
      ]);
    }

    case 'edit': {
      if (state.status === 'deleted') return fail('invalid_state');
      if (!isOwner) return fail('forbidden');
      const version = state.version + 1;

      if (state.status === 'draft') {
        return ok({ ...state, version, ledgerTotal: action.ledgerTotal }, []);
      }

      if (state.review) {
        // Edits while a review is open change the version under review.
        if (!action.material) return ok({ ...state, version }, []);
        const restarted = startReview(
          { ...state, version },
          state.review.kind,
          version,
          action.ledgerTotal,
          actor.memberId,
          ctx,
        );
        if (!restarted.ok) return restarted;
        return { ...restarted, effects: [{ kind: 'review_closed', outcome: 'restarted' }, ...restarted.effects] };
      }

      // Active expense.
      if (!action.material) return ok({ ...state, version }, []);
      const reviewAmount = action.ledgerTotal > state.ledgerTotal ? action.ledgerTotal : state.ledgerTotal;
      if (needsReview(ctx.policy, reviewAmount)) {
        return startReview({ ...state, version }, 'edit', version, action.ledgerTotal, actor.memberId, ctx);
      }
      return ok(
        { ...state, version, postedVersion: version, ledgerTotal: action.ledgerTotal, disputedBy: [] },
        repostEffects(state.postedVersion!, version, state.disputedBy.length > 0),
      );
    }

    case 'approve':
    case 'decline': {
      const review = state.review;
      if (!review) return fail('invalid_state');
      if (action.version !== review.version) return fail('stale_version');
      const eligible = eligibleReviewers(ctx.affected, review.authorId);
      if (!eligible.includes(actor.memberId)) return fail('not_eligible');

      if (action.type === 'decline') {
        if (action.reason.trim() === '') return fail('reason_required');
        return ok(review.kind === 'create' ? { ...state, status: 'draft', review: null } : { ...state, review: null }, [
          { kind: 'review_closed', outcome: 'declined' },
        ]);
      }

      if (review.approvals.includes(actor.memberId)) return { ok: true, state, effects: [], duplicate: true };
      const updated = { ...review, approvals: [...review.approvals, actor.memberId] };
      if (!reviewSatisfied(updated.approvals, eligible, ctx.policy.approvalsRequired)) {
        return ok({ ...state, review: updated }, []);
      }
      return completeReview({ ...state, review: updated });
    }

    case 'reevaluate_review': {
      // Called by the system when membership changes; passes the review if the remaining
      // eligible members no longer require more approvals.
      const review = state.review;
      if (!review) return fail('invalid_state');
      const eligible = eligibleReviewers(ctx.affected, review.authorId);
      if (!reviewSatisfied(review.approvals, eligible, ctx.policy.approvalsRequired)) {
        return ok(state, []);
      }
      return completeReview(state);
    }

    case 'withdraw_review': {
      const review = state.review;
      if (!review) return fail('invalid_state');
      if (actor.memberId !== review.authorId) return fail('forbidden');
      return ok(review.kind === 'create' ? { ...state, status: 'draft', review: null } : { ...state, review: null }, [
        { kind: 'review_closed', outcome: 'withdrawn' },
      ]);
    }

    case 'delete': {
      if (state.status === 'deleted') return fail('invalid_state');
      // Group admins may remove abusive or spam entries; it is audited and announced.
      const asAdmin = !isOwner && isGroupAdmin && state.status !== 'draft';
      if (!isOwner && !asAdmin) return fail('forbidden');
      const effects: ExpenseEffect[] = [];
      if (state.postedVersion !== null) effects.push({ kind: 'reverse', version: state.postedVersion });
      if (state.review) effects.push({ kind: 'review_closed', outcome: 'withdrawn' });
      if (asAdmin) effects.push({ kind: 'admin_override', action: 'delete' });
      return ok(
        {
          ...state,
          status: 'deleted',
          postedVersion: null,
          review: null,
          disputedBy: [],
          restorableVersion: state.postedVersion,
        },
        effects,
      );
    }

    case 'restore': {
      if (state.status !== 'deleted' || state.restorableVersion === null) return fail('invalid_state');
      const asAdmin = !isOwner && isGroupAdmin;
      if (!isOwner && !asAdmin) return fail('forbidden');
      const version = state.restorableVersion;
      const effects: ExpenseEffect[] = [{ kind: 'post', version }];
      if (asAdmin) effects.push({ kind: 'admin_override', action: 'restore' });
      return ok({ ...state, status: 'active', postedVersion: version, restorableVersion: null }, effects);
    }

    case 'dispute': {
      if (state.status !== 'active') return fail('invalid_state');
      if (isOwner || !ctx.affected.includes(actor.memberId)) return fail('not_eligible');
      if (action.reason.trim() === '') return fail('reason_required');
      if (state.disputedBy.includes(actor.memberId)) return { ok: true, state, effects: [], duplicate: true };
      return ok({ ...state, disputedBy: [...state.disputedBy, actor.memberId] }, []);
    }

    case 'withdraw_dispute': {
      if (!state.disputedBy.includes(actor.memberId)) return fail('invalid_state');
      return ok({ ...state, disputedBy: state.disputedBy.filter((id) => id !== actor.memberId) }, []);
    }
  }
}

export function eligibleReviewers(affected: readonly MemberId[], authorId: MemberId): MemberId[] {
  return affected.filter((id) => id !== authorId);
}

function startReview(
  state: ExpenseState,
  kind: PendingReview['kind'],
  version: number,
  ledgerTotal: bigint,
  authorId: MemberId,
  ctx: ExpenseContext,
): ExpenseResult {
  const review: PendingReview = { kind, version, ledgerTotal, authorId, approvals: [] };
  const next: ExpenseState = { ...state, status: kind === 'create' ? 'in_review' : state.status, review };
  // Nobody else is affected (e.g. a solo expense): the review passes immediately.
  if (reviewSatisfied([], eligibleReviewers(ctx.affected, authorId), ctx.policy.approvalsRequired)) {
    return completeReview(next);
  }
  return ok(next, [{ kind: 'review_requested', version }]);
}

function completeReview(state: ExpenseState): ExpenseResult {
  const review = state.review!;
  const closed: ExpenseEffect = { kind: 'review_closed', outcome: 'approved' };
  if (review.kind === 'create') {
    return ok(
      { ...state, status: 'active', postedVersion: review.version, ledgerTotal: review.ledgerTotal, review: null },
      [closed, { kind: 'post', version: review.version }],
    );
  }
  return ok(
    { ...state, postedVersion: review.version, ledgerTotal: review.ledgerTotal, review: null, disputedBy: [] },
    [closed, ...repostEffects(state.postedVersion!, review.version, state.disputedBy.length > 0)],
  );
}

function repostEffects(from: number, to: number, hadDisputes: boolean): ExpenseEffect[] {
  const effects: ExpenseEffect[] = [
    { kind: 'reverse', version: from },
    { kind: 'post', version: to },
  ];
  if (hadDisputes) effects.push({ kind: 'disputes_cleared' });
  return effects;
}

function ok(state: ExpenseState, effects: ExpenseEffect[]): ExpenseResult {
  return { ok: true, state, effects };
}
