import { describe, expect, it } from 'vitest';
import { type Actor, type SettlementState, recordSettlement, transitionSettlement } from '../src';

// B pays A ₹1,500. C is an unrelated member; G is a group admin.
const A: Actor = { memberId: 'A', role: 'member' };
const B: Actor = { memberId: 'B', role: 'member' };
const C: Actor = { memberId: 'C', role: 'member' };
const G: Actor = { memberId: 'G', role: 'admin' };
const payment = { from: 'B', to: 'A', amount: 150000n };

const awaiting = (): SettlementState => {
  const r = recordSettlement(payment, B);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const confirmed = (): SettlementState => {
  const r = transitionSettlement(awaiting(), { type: 'confirm' }, A);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('recording a settlement', () => {
  it('"I paid" by the payer waits for the receiver and does not count yet', () => {
    expect(recordSettlement(payment, B)).toEqual({
      ok: true,
      state: { ...payment, recordedBy: 'B', status: 'awaiting_confirmation' },
      effects: [],
    });
  });

  it('"they paid me" by the receiver counts immediately', () => {
    expect(recordSettlement(payment, A)).toMatchObject({ ok: true, state: { status: 'confirmed' }, effects: [{ kind: 'post' }] });
  });

  it('only the two parties can record it; self-payments and non-positive amounts are refused', () => {
    expect(recordSettlement(payment, C)).toEqual({ ok: false, error: 'forbidden' });
    expect(recordSettlement(payment, G)).toEqual({ ok: false, error: 'forbidden' });
    expect(recordSettlement({ from: 'A', to: 'A', amount: 1n }, A)).toEqual({ ok: false, error: 'invalid_state' });
    expect(recordSettlement({ ...payment, amount: 0n }, B)).toEqual({ ok: false, error: 'invalid_state' });
    expect(recordSettlement({ ...payment, amount: -5n }, B)).toEqual({ ok: false, error: 'invalid_state' });
  });
});

describe('settlement transitions', () => {
  it('only the receiver can confirm; confirming posts exactly once', () => {
    expect(transitionSettlement(awaiting(), { type: 'confirm' }, B)).toEqual({ ok: false, error: 'forbidden' });
    expect(transitionSettlement(awaiting(), { type: 'confirm' }, G)).toEqual({ ok: false, error: 'forbidden' });
    expect(transitionSettlement(awaiting(), { type: 'confirm' }, A)).toMatchObject({ ok: true, effects: [{ kind: 'post' }] });
    // A retried confirm (double tap, network retry) is a no-op, not a second posting.
    expect(transitionSettlement(confirmed(), { type: 'confirm' }, A)).toMatchObject({ ok: true, duplicate: true, effects: [] });
  });

  it('the receiver can decline with a reason; nothing is posted', () => {
    expect(transitionSettlement(awaiting(), { type: 'decline', reason: '' }, A)).toEqual({ ok: false, error: 'reason_required' });
    expect(transitionSettlement(awaiting(), { type: 'decline', reason: 'Not received' }, A)).toMatchObject({
      ok: true,
      state: { status: 'declined' },
      effects: [],
    });
  });

  it('the recorder can withdraw before confirmation', () => {
    expect(transitionSettlement(awaiting(), { type: 'withdraw' }, A)).toEqual({ ok: false, error: 'forbidden' });
    expect(transitionSettlement(awaiting(), { type: 'withdraw' }, B)).toMatchObject({ state: { status: 'withdrawn' }, effects: [] });
    expect(transitionSettlement(confirmed(), { type: 'withdraw' }, B)).toEqual({ ok: false, error: 'invalid_state' });
  });

  it('a confirmed payment can be voided by the receiver only, reversing it', () => {
    expect(transitionSettlement(confirmed(), { type: 'void', reason: 'Bounced' }, B)).toEqual({ ok: false, error: 'forbidden' });
    expect(transitionSettlement(confirmed(), { type: 'void', reason: '' }, A)).toEqual({ ok: false, error: 'reason_required' });
    expect(transitionSettlement(confirmed(), { type: 'void', reason: 'UPI reversed' }, A)).toMatchObject({
      state: { status: 'voided' },
      effects: [{ kind: 'reverse' }],
    });
    expect(transitionSettlement(awaiting(), { type: 'void', reason: 'x' }, A)).toEqual({ ok: false, error: 'invalid_state' });
  });

  it('closed settlements accept nothing further', () => {
    for (const status of ['declined', 'withdrawn', 'voided'] as const) {
      const state = { ...awaiting(), status };
      for (const action of [{ type: 'confirm' }, { type: 'decline', reason: 'x' }, { type: 'withdraw' }, { type: 'void', reason: 'x' }] as const) {
        expect(transitionSettlement(state, action, A).ok || transitionSettlement(state, action, B).ok).toBe(false);
      }
    }
  });
});
