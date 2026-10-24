import { describe, expect, it } from 'vitest';
import { ME, type State, answersPayment, beforeClosing, canDelete, groupPhase, inbox, reducer, seed } from '../apps/client/src/data/model';

const role = (s: State, g: string, id: string) => s.roster[g]!.find((m) => m.id === id)!.role;

describe('finishing a group', () => {
  it('open until finished; finished while anyone owes or a payment waits; closed once square', () => {
    let s = seed();
    expect(groupPhase(s, 'goa')).toBe('open');
    expect(groupPhase(s, 'lunch')).toBe('closed'); // the seed's settled, finished lunch
    s = reducer(s, { type: 'finish_group', groupId: 'goa' });
    expect(groupPhase(s, 'goa')).toBe('finishing');
    const left = beforeClosing(s, 'goa');
    expect(left.transfers.length).toBeGreaterThan(0);
    expect(left.awaiting.map((p) => p.id)).toEqual(['p1']);
    expect(left.questions.map((q) => q.message.id)).toEqual(['q1']);
    expect(left.suggestions.map((x) => x.suggestion.id)).toEqual(['s1']);

    // Every suggested payment, recorded by its receiver (counts at once), plus the waiting one confirmed.
    s = reducer(s, { type: 'confirm_payment', id: 'p1' });
    for (const t of beforeClosing(s, 'goa').transfers) s = reducer(s, { type: 'record_payment', groupId: 'goa', from: t.from, to: t.to, amount: t.amount, via: 'cash' }, t.to);
    expect(groupPhase(s, 'goa')).toBe('closed');
    s = reducer(s, { type: 'reopen_group', groupId: 'goa' });
    expect(groupPhase(s, 'goa')).toBe('open');
  });
});

describe('owners and admins', () => {
  it('the owner hands the group over and stays on as an admin', () => {
    const s = reducer(seed(), { type: 'make_owner', groupId: 'goa', memberId: 'dev' });
    expect([role(s, 'goa', ME), role(s, 'goa', 'dev')]).toEqual(['admin', 'owner']);
  });

  it('an admin may delete anyone’s expense, and the expense says who did; a member only their own', () => {
    const s = seed();
    const dinner = s.expenses.find((e) => e.id === 'e2')!; // Bilal's, in Asha's group
    expect(canDelete(s, dinner)).toBe(true);
    expect(canDelete(s, dinner, 'chitra')).toBe(false);
    const after = reducer(s, { type: 'delete', id: 'e2' });
    expect(after.expenses.find((e) => e.id === 'e2')).toMatchObject({ deleted: true, deletedBy: ME });
    expect(reducer(s, { type: 'delete', id: 'e2' }, 'chitra').expenses.find((e) => e.id === 'e2')!.deleted).toBe(false);
  });

  it('a payment to someone who hasn’t joined is answered by the owner or an admin, and shows in their inbox', () => {
    let s = seed();
    // Neel (lunch) hasn't joined; Kabir says he paid Neel.
    s = { ...s, groups: s.groups.map((g) => (g.id === 'lunch' ? { ...g, finishedAt: undefined } : g)) };
    s = reducer(s, { type: 'record_payment', groupId: 'lunch', from: 'kabir', to: 'neel', amount: 10000n, via: 'upi' }, 'kabir');
    const p = s.payments.at(-1)!;
    expect(p.status).toBe('awaiting');
    expect(answersPayment(s, p)).toBe(true); // Asha owns lunch
    expect(answersPayment(s, p, 'isha')).toBe(false);
    expect(inbox(s).some((i) => i.paymentId === p.id && i.text === 'says they paid Neel ₹100')).toBe(true);
    s = reducer(s, { type: 'confirm_payment', id: p.id });
    expect(s.payments.at(-1)!.status).toBe('confirmed');
  });

  it('a payment marked by mistake is undone by the receiver; one still waiting is cancelled by whoever recorded it', () => {
    let s = reducer(seed(), { type: 'record_payment', groupId: 'goa', from: 'chitra', to: ME, amount: 10000n, via: 'cash' });
    const got = s.payments.at(-1)!;
    expect(got).toMatchObject({ status: 'confirmed', by: ME });
    expect(reducer(s, { type: 'void_payment', id: got.id }, 'chitra').payments.at(-1)!.status).toBe('confirmed');
    s = reducer(s, { type: 'void_payment', id: got.id });
    expect(s.payments.at(-1)!.status).toBe('voided');

    s = reducer(s, { type: 'record_payment', groupId: 'goa', from: ME, to: 'dev', amount: 10000n, via: 'upi' });
    const sent = s.payments.at(-1)!;
    expect(reducer(s, { type: 'withdraw_payment', id: sent.id }, 'dev').payments.at(-1)!.status).toBe('awaiting');
    expect(reducer(s, { type: 'withdraw_payment', id: sent.id }).payments.at(-1)!.status).toBe('declined');
  });
});
