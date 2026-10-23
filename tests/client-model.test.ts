import { describe, expect, it } from 'vitest';
import {
  ME,
  balanceOf,
  balancesOf,
  inbox,
  myTransfers,
  netAll,
  newMarks,
  reducer,
  seed,
  transfersOf,
  unreadThreads,
} from '../apps/client/src/data/model';

const sum = (s: ReturnType<typeof seed>, g: string) => balancesOf(s, g).reduce((a, b) => a + b.amount, 0n);

describe('client demo model (M1)', () => {
  it('seed matches the approved design numbers and every group balances', () => {
    const s = seed();
    expect(balanceOf(s, 'goa')).toBe(390000n);
    expect(balanceOf(s, 'flat')).toBe(-85000n);
    expect(balanceOf(s, 'lunch')).toBe(0n);
    expect(netAll(s)).toEqual({ net: 305000n, get: 390000n, pay: 85000n });
    for (const g of s.groups) expect(sum(s, g.id)).toBe(0n);
    expect(inbox(s).map((i) => i.kind).sort()).toEqual(['message', 'payment', 'question', 'suggestion']);
  });

  it('accepting a suggestion makes a new version; declining keeps the old one', () => {
    const s = seed();
    const accepted = reducer(s, { type: 'decide', id: 'e1', suggestionId: 's1', accept: true });
    expect(accepted.expenses.find((e) => e.id === 'e1')!.versions).toHaveLength(2);
    // Hotel ₹6,000 by nights 3/3/2/3: Asha's share is ₹1,636.36, so ₹6,000 − 1,636.36 − dinner 600 − taxi 300.
    expect(balanceOf(accepted, 'goa')).toBe(346364n);
    expect(sum(accepted, 'goa')).toBe(0n);
    const declined = reducer(s, { type: 'decide', id: 'e1', suggestionId: 's1', accept: false });
    expect(balanceOf(declined, 'goa')).toBe(390000n);
  });

  it('only the payer can edit or decide; others can only suggest', () => {
    const s = seed();
    expect(reducer(s, { type: 'edit_expense', id: 'e2', title: 'x', total: 1n, payer: 'bilal', split: { method: 'equal', members: [ME] } })).toBe(s);
    const sug = reducer(s, { type: 'suggest', id: 'e2', total: 200000n, split: { method: 'equal', members: [ME, 'bilal'] }, reason: 'Chitra skipped' });
    expect(sug.expenses.find((e) => e.id === 'e2')!.suggestions).toHaveLength(1);
    expect(balanceOf(sug, 'goa')).toBe(390000n);
  });

  it('payer-recorded payments wait for confirmation; receiver-recorded ones count at once', () => {
    const s = seed();
    const t = transfersOf(s, 'flat').find((x) => x.from === ME)!;
    const paid = reducer(s, { type: 'record_payment', groupId: 'flat', from: ME, to: t.to, amount: t.amount, via: 'upi' });
    expect(balanceOf(paid, 'flat')).toBe(-85000n);
    const confirmed = reducer(s, { type: 'confirm_payment', id: 'p1' });
    expect(balanceOf(confirmed, 'goa')).toBe(360000n);
    let all = s;
    for (const x of transfersOf(s, 'goa')) {
      all = reducer(all, { type: 'record_payment', groupId: 'goa', from: x.from, to: ME, amount: x.amount, via: 'cash' });
    }
    expect(balanceOf(all, 'goa')).toBe(0n);
  });

  it('myTransfers lists only the payments that involve me', () => {
    const s = seed();
    expect(myTransfers(s, 'flat').map((t) => [t.from, t.to, t.amount])).toEqual([
      [ME, 'meera', 50000n],
      [ME, 'rohan', 35000n],
    ]);
    expect(myTransfers(s, 'lunch')).toEqual([]);
  });

  it('deleting a settled expense reopens the balance (the UI warns before this)', () => {
    const s = reducer(seed(), { type: 'delete', id: 'l1' });
    expect(balanceOf(s, 'lunch')).toBe(-250000n);
    expect(balanceOf(reducer(s, { type: 'restore', id: 'l1' }), 'lunch')).toBe(0n);
  });

  it('new groups get the current user plus placeholder members', () => {
    const s = reducer(seed(), { type: 'add_group', id: 'g-manali', name: 'Manali', kind: 'trip', memberNames: ['Zoya', 'Arjun'] });
    expect(s.groups[0]!.members).toHaveLength(3);
    expect(s.groups[0]!.members[0]).toBe(ME);
  });
});

describe('dots: where something new came from', () => {
  it('marks the group, the expense and the person each new thing came through', () => {
    const s = seed();
    const m = newMarks(s);
    // Bilal's open question on the hotel, his payment to confirm, and his private message.
    expect([...m.groups]).toEqual(['goa']);
    expect(m.expenses.has('e1')).toBe(true);
    expect(m.people.has('goa|bilal')).toBe(true);
    expect([...m.settle]).toEqual(['goa']);
    expect(m.groups.has('flat')).toBe(false);
  });

  it('an expense thread stops being new once I have seen it or replied', () => {
    let s = reducer(seed(), { type: 'post', id: 'e3', messageId: 'm-dev', text: 'Toll?', question: false }, 'dev');
    expect(unreadThreads(s).map((e) => e.id)).toContain('e3');
    const later = new Date(Date.now() + 1000).toISOString();
    expect(unreadThreads({ ...s, seen: [...s.seen, { groupId: 'goa', by: ME, type: 'expense', id: 'e3', at: later }] }).map((e) => e.id)).not.toContain('e3');
    s = reducer(s, { type: 'post', id: 'e3', messageId: 'm-me', text: 'No', question: false });
    expect(unreadThreads(s).map((e) => e.id)).not.toContain('e3');
  });
});
