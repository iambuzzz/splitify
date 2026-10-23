import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, configureApi, requestSignInEmail } from '../../apps/client/src/data/api';
import { uuidv7 } from '../../apps/client/src/data/ids';
import { ME, balanceOf, current } from '../../apps/client/src/data/model';
import { type Pending, type Remote, emptyRemote, fetchSnapshot, loadRemote, perform, sendSeen, withPending } from '../../apps/client/src/data/remote';
import { type TestApi, type User, ok, testApi } from './harness';

/**
 * The app's signed-in data layer against the real API over HTTP: what the screens show must match
 * what the server saved, and every screen action must reach the right endpoint.
 */
let api: TestApi;
let as: User | null = null;

beforeAll(async () => {
  api = await testApi();
  const url = await api.app.listen({ port: 0, host: '127.0.0.1' });
  configureApi(url, async () => as?.token);
}, 60_000);
afterAll(() => api?.app.close());

async function signedIn(u: User): Promise<Remote> {
  as = u;
  return loadRemote();
}

/** The balance the screens compute must equal the one the server's ledger holds. */
async function balances(u: User, groupId: string) {
  const r = await signedIn(u);
  const server = ok(await u.get(`/groups/${groupId}`)).body;
  const mine = server.balances.find((b: { memberId: string }) => b.memberId === server.me.memberId)?.amount ?? '0';
  expect(balanceOf(r.state, groupId)).toBe(BigInt(mine));
  return r;
}

describe('app data layer against the API', () => {
  it('runs the whole trip: group, invite, expense, suggestion, question, payment', async () => {
    const asha = await api.user('Asha');
    const ben = await api.user('Ben');

    // Asha creates the group from the app (the app picks the id).
    const groupId = uuidv7();
    as = asha;
    await perform({ type: 'add_group', id: groupId, name: 'Goa Trip', kind: 'trip', memberNames: ['Ben', 'Chetan'] }, emptyRemote());
    let r = await signedIn(asha);
    expect(r.state.groups).toEqual([{ id: groupId, name: 'Goa Trip', kind: 'trip', members: [ME, expect.any(String), expect.any(String)] }]);
    expect(r.state.members[ME]!.name).toBe('Asha');
    const id = (name: string) => Object.values(r.state.members).find((m) => m.name === name)!.id;
    const [benId, chetanId] = [id('Ben'), id('Chetan')];

    // Ben joins through an invite and takes over his name.
    const invite = ok(await asha.send('POST', `/groups/${groupId}/invites`, {}), 201).body;
    ok(await ben.send('POST', '/invites/accept', { token: invite.token, claimMemberId: benId }));

    // Asha adds the hotel; the app shows the same balance as the server.
    const hotel = uuidv7();
    await perform({ type: 'add_expense', id: hotel, groupId, title: 'Hotel', icon: 'hotel', total: 600000n, payer: ME, split: { method: 'equal', members: [ME, benId, chetanId] } }, r);
    r = await balances(asha, groupId);
    expect(balanceOf(r.state, groupId)).toBe(400000n);
    expect(r.state.expenses[0]).toMatchObject({ id: hotel, title: 'Hotel', icon: 'hotel', payer: ME });

    // For Ben, Asha is a normal member and he is ME.
    let rb = await balances(ben, groupId);
    const ashaId = rb.state.expenses[0]!.payer;
    expect(ashaId).not.toBe(ME);
    expect(balanceOf(rb.state, groupId)).toBe(-200000n);

    // Ben suggests a lower total; Asha accepts it.
    await perform({ type: 'suggest', id: hotel, total: 540000n, split: { method: 'equal', members: [ashaId, ME, chetanId] }, reason: 'Discount' }, rb);
    r = await signedIn(asha);
    const sg = r.state.expenses[0]!.suggestions[0]!;
    expect(sg).toMatchObject({ by: benId, total: 540000n, reason: 'Discount', status: 'open' });
    await perform({ type: 'decide', id: hotel, suggestionId: sg.id, accept: true }, r);
    r = await balances(asha, groupId);
    expect(current(r.state.expenses[0]!).total).toBe(540000n);
    expect(balanceOf(r.state, groupId)).toBe(360000n);

    // Ben asks in the expense's thread; Asha answers and marks it resolved.
    rb = await signedIn(ben);
    await perform({ type: 'post', id: hotel, messageId: uuidv7(), text: 'Breakfast included?', question: true }, rb);
    r = await signedIn(asha);
    const q = r.state.expenses[0]!.messages[0]!;
    await perform({ type: 'post', id: hotel, messageId: uuidv7(), text: 'Yes', question: false }, r);
    await perform({ type: 'resolve', id: hotel, messageId: q.id }, r);
    r = await signedIn(asha);
    expect(r.state.expenses[0]!.canChat).toBe(true);
    expect(r.state.expenses[0]!.messages.map((m) => [m.by, m.kind, m.text, m.resolved])).toEqual([
      [benId, 'question', 'Breakfast included?', true],
      [ME, 'text', 'Yes', false],
    ]);

    // Ben and Asha settle up privately; seen marks travel both ways.
    rb = await signedIn(ben);
    await perform({ type: 'pair_message', groupId, with: ashaId, messageId: uuidv7(), text: 'Sending tonight' }, rb);
    r = await signedIn(asha);
    expect(r.state.pairMessages.map((m) => [m.by, m.text])).toEqual([[benId, 'Sending tonight']]);
    await sendSeen(groupId, [{ type: 'pair', id: benId }, { type: 'expense', id: hotel, version: 2 }], r);
    rb = await signedIn(ben);
    expect(rb.state.seen.filter((s) => s.by === ashaId).map((s) => [s.type, s.id]).sort()).toEqual([
      ['expense', hotel],
      ['pair', ME],
    ]);

    // A title edit keeps the icon and the date.
    r = await signedIn(asha);
    await perform({ type: 'edit_expense', id: hotel, title: 'Hotel Sea View', total: 540000n, payer: ME, split: { method: 'equal', members: [ME, benId, chetanId] } }, r);
    r = await balances(asha, groupId);
    expect(r.state.expenses[0]).toMatchObject({ title: 'Hotel Sea View', icon: 'hotel' });

    // Ben pays by UPI; it counts only once Asha confirms.
    rb = await signedIn(ben);
    await perform({ type: 'record_payment', groupId, from: ME, to: ashaId, amount: 180000n, via: 'upi' }, rb);
    r = await balances(asha, groupId);
    const p = r.state.payments[0]!;
    expect(p).toMatchObject({ from: benId, to: ME, status: 'awaiting', via: 'upi' });
    await perform({ type: 'confirm_payment', id: p.id }, r);
    r = await balances(asha, groupId);
    expect(balanceOf(r.state, groupId)).toBe(180000n);

    // Dispute and withdraw; delete and restore.
    rb = await signedIn(ben);
    await perform({ type: 'dispute', id: hotel, reason: 'Something looks wrong' }, rb);
    rb = await signedIn(ben);
    expect(rb.state.expenses[0]!.disputes).toEqual([{ by: ME, reason: 'Something looks wrong' }]);
    await perform({ type: 'withdraw_dispute', id: hotel }, rb);
    r = await signedIn(asha);
    expect(r.state.expenses[0]!.disputes).toEqual([]);
    await perform({ type: 'delete', id: hotel }, r);
    r = await balances(asha, groupId);
    expect(r.state.expenses[0]!.deleted).toBe(true);
    await perform({ type: 'restore', id: hotel }, r);
    r = await balances(asha, groupId);
    expect(r.state.expenses[0]!.deleted).toBe(false);
    await balances(ben, groupId);
  });

  it('manages members: add by name, make admin, remove with a balance', async () => {
    const asha = await api.user('Asha');
    const ben = await api.user('Ben');
    const groupId = uuidv7();
    as = asha;
    await perform({ type: 'add_group', id: groupId, name: 'Hostel', kind: 'home', memberNames: [] }, emptyRemote());
    const invite = ok(await asha.send('POST', `/groups/${groupId}/invites`, {}), 201).body;
    ok(await ben.send('POST', '/invites/accept', { token: invite.token }));
    let r = await signedIn(asha);
    const rahul = uuidv7();
    await perform({ type: 'add_member', groupId, memberId: rahul, name: 'Rahul' }, r);
    r = await signedIn(asha);
    const benId = r.state.roster[groupId]!.find((m) => m.joined && m.id !== ME)!.id;
    expect(r.state.roster[groupId]!.map((m) => [r.state.members[m.id]!.name, m.role, m.joined])).toEqual([
      ['Asha', 'owner', true],
      ['Ben', 'member', true],
      ['Rahul', 'member', false],
    ]);
    await perform({ type: 'set_role', groupId, memberId: benId, role: 'admin' }, r);
    await perform({ type: 'add_expense', id: uuidv7(), groupId, title: 'Snacks', icon: 'food', total: 30000n, payer: ME, split: { method: 'equal', members: [ME, rahul] } }, r);
    r = await signedIn(asha);
    expect(r.state.roster[groupId]!.find((m) => m.id === benId)!.role).toBe('admin');
    await perform({ type: 'remove_member', groupId, memberId: rahul, acknowledgeBalance: true }, r);
    r = await balances(asha, groupId);
    expect(r.state.roster[groupId]!.find((m) => m.id === rahul)!.active).toBe(false);
    expect(r.state.groups[0]!.members).not.toContain(rahul);
    expect(balanceOf(r.state, groupId)).toBe(15000n); // Rahul's share is still owed after he left
  });

  it('a confirmed payment does not jump back when an older reload arrives late', async () => {
    const asha = await api.user('Asha');
    const ben = await api.user('Ben');
    const groupId = uuidv7();
    as = asha;
    await perform({ type: 'add_group', id: groupId, name: 'Trip', kind: 'trip', memberNames: [] }, emptyRemote());
    const invite = ok(await asha.send('POST', `/groups/${groupId}/invites`, {}), 201).body;
    ok(await ben.send('POST', '/invites/accept', { token: invite.token }));
    let r = await signedIn(asha);
    await perform({ type: 'add_expense', id: uuidv7(), groupId, title: 'Cab', icon: 'taxi', total: 40000n, payer: ME, split: { method: 'equal', members: r.state.groups[0]!.members } }, r);
    const rb = await signedIn(ben);
    await perform({ type: 'record_payment', groupId, from: ME, to: rb.state.expenses[0]!.payer, amount: 20000n, via: 'upi' }, rb);

    // Asha's app asked for the group (request 1) just before she tapped "Yes, got it".
    as = asha;
    const stale = { [groupId]: { data: await fetchSnapshot(groupId), seq: 1 } };
    r = withPending(stale, []);
    const payment = r.state.payments[0]!;
    expect(payment.status).toBe('awaiting');
    const confirm: Pending = { key: 1, action: { type: 'confirm_payment', id: payment.id }, group: groupId, sentAt: 2 };
    // Shown at once, and still shown while the API saves it and the old reply comes in…
    expect(withPending(stale, [confirm]).state.payments[0]!.status).toBe('confirmed');
    await perform(confirm.action, r);
    expect(withPending(stale, [confirm]).state.payments[0]!.status).toBe('confirmed');
    expect(balanceOf(withPending(stale, [confirm]).state, groupId)).toBe(0n);
    // …until a reload requested after the tap (request 3) shows the server's own record.
    const fresh = { [groupId]: { data: await fetchSnapshot(groupId), seq: 3 } };
    const after = withPending(fresh, [confirm]);
    expect(after.state.payments.map((p) => p.status)).toEqual(['confirmed']);
    expect(balanceOf(after.state, groupId)).toBe(0n);
  });

  it('a question shows once when the live hint reload beats the API reply', async () => {
    const asha = await api.user('Asha');
    const groupId = uuidv7();
    as = asha;
    await perform({ type: 'add_group', id: groupId, name: 'Trip', kind: 'trip', memberNames: ['Ben'] }, emptyRemote());
    let r = await signedIn(asha);
    const e = uuidv7();
    await perform({ type: 'add_expense', id: e, groupId, title: 'Cab', icon: 'taxi', total: 40000n, payer: ME, split: { method: 'equal', members: r.state.groups[0]!.members } }, r);
    r = await signedIn(asha);
    const stale = { [groupId]: { data: await fetchSnapshot(groupId), seq: 1 } };
    const ask: Pending = { key: 1, action: { type: 'post', id: e, messageId: uuidv7(), text: 'Toll included?', question: true }, group: groupId, sentAt: 2 };
    expect(withPending(stale, [ask]).state.expenses[0]!.messages).toHaveLength(1);
    await perform(ask.action, r);
    // The hint's reload (request 3) already has the question; the change is still pending.
    const hinted = { [groupId]: { data: await fetchSnapshot(groupId), seq: 3 } };
    expect(withPending(hinted, [ask]).state.expenses[0]!.messages.map((m) => m.text)).toEqual(['Toll included?']);
  });

  it('asks the API for a sign-in email before signing in; without email set up it says so (the app falls back)', async () => {
    as = null;
    const err = await requestSignInEmail('riya@example.com').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, code: 'email_not_configured' });
  });

  it('a refused change comes back as words the screens can show', async () => {
    const asha = await api.user('Asha');
    const ben = await api.user('Ben');
    const groupId = uuidv7();
    as = asha;
    await perform({ type: 'add_group', id: groupId, name: 'Flat', kind: 'home', memberNames: [] }, emptyRemote());
    const invite = ok(await asha.send('POST', `/groups/${groupId}/invites`, {}), 201).body;
    ok(await ben.send('POST', '/invites/accept', { token: invite.token }));
    let r = await signedIn(asha);
    const e = uuidv7();
    const benId = r.state.groups[0]!.members.find((m) => m !== ME)!;
    await perform({ type: 'add_expense', id: e, groupId, title: 'Wi-Fi', icon: 'wifi', total: 120000n, payer: ME, split: { method: 'equal', members: [ME, benId] } }, r);
    const rb = await signedIn(ben);
    // Ben is not an owner: editing directly is refused (he can suggest instead).
    await expect(
      perform({ type: 'edit_expense', id: e, title: 'Wi-Fi', total: 1000n, payer: rb.state.expenses[0]!.payer, split: { method: 'equal', members: [ME] } }, rb),
    ).rejects.toThrow('You are not allowed to do this');
    r = await signedIn(asha);
    expect(current(r.state.expenses[0]!).total).toBe(120000n);
  });
});
