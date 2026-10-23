import { type Actor, type MemberId, type Result, fail } from './types';

/**
 * `awaiting_confirmation`: the payer says they paid; not counted until the receiver confirms.
 * `confirmed`: counted. `voided`: a confirmed payment the receiver later reports as not received
 * (its postings are reversed). `verified` is deliberately absent: it requires payment-provider
 * evidence, which v1 does not have.
 */
export type SettlementStatus = 'awaiting_confirmation' | 'confirmed' | 'declined' | 'withdrawn' | 'voided';

export interface SettlementState {
  status: SettlementStatus;
  from: MemberId;
  to: MemberId;
  amount: bigint;
  recordedBy: MemberId;
}

export type SettlementAction =
  | { type: 'confirm' }
  | { type: 'decline'; reason: string }
  | { type: 'withdraw' }
  | { type: 'void'; reason: string };

export type SettlementEffect = { kind: 'post' } | { kind: 'reverse' };

export type SettlementResult = Result<SettlementState, SettlementEffect>;

/**
 * Records a payment. A payment recorded by the receiver ("B paid me") counts immediately; one
 * recorded by the payer ("I paid B") waits for the receiver to confirm.
 */
export function recordSettlement(
  input: { from: MemberId; to: MemberId; amount: bigint },
  actor: Actor,
): SettlementResult {
  if (input.from === input.to || input.amount <= 0n) return fail('invalid_state');
  if (actor.memberId !== input.from && actor.memberId !== input.to) return fail('forbidden');
  const byReceiver = actor.memberId === input.to;
  return {
    ok: true,
    state: { ...input, recordedBy: actor.memberId, status: byReceiver ? 'confirmed' : 'awaiting_confirmation' },
    effects: byReceiver ? [{ kind: 'post' }] : [],
  };
}

export function transitionSettlement(
  state: SettlementState,
  action: SettlementAction,
  actor: Actor,
): SettlementResult {
  const isReceiver = actor.memberId === state.to;

  switch (action.type) {
    case 'confirm': {
      if (state.status === 'confirmed' && isReceiver) return { ok: true, state, effects: [], duplicate: true };
      if (state.status !== 'awaiting_confirmation') return fail('invalid_state');
      if (!isReceiver) return fail('forbidden');
      return { ok: true, state: { ...state, status: 'confirmed' }, effects: [{ kind: 'post' }] };
    }
    case 'decline': {
      if (state.status !== 'awaiting_confirmation') return fail('invalid_state');
      if (!isReceiver) return fail('forbidden');
      if (action.reason.trim() === '') return fail('reason_required');
      return { ok: true, state: { ...state, status: 'declined' }, effects: [] };
    }
    case 'withdraw': {
      if (state.status !== 'awaiting_confirmation') return fail('invalid_state');
      if (actor.memberId !== state.recordedBy) return fail('forbidden');
      return { ok: true, state: { ...state, status: 'withdrawn' }, effects: [] };
    }
    case 'void': {
      if (state.status !== 'confirmed') return fail('invalid_state');
      if (!isReceiver) return fail('forbidden');
      if (action.reason.trim() === '') return fail('reason_required');
      return { ok: true, state: { ...state, status: 'voided' }, effects: [{ kind: 'reverse' }] };
    }
  }
}
