import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresBackend } from '../pg/harness';
import { type TestApi, type User, newKey, ok, testApi } from './harness';

// PGlite by default; `npm run test:pg` runs the same tests on a real Postgres too.
let api: TestApi;
let drop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  const pg = url ? await postgresBackend(url) : undefined;
  drop = pg?.drop;
  api = await testApi(pg?.backend);
}, 120_000);
afterAll(async () => {
  await api?.app.close();
  await drop?.();
});

const today = '2026-10-23';

/** Asha owns "Goa Trip"; Ben joins by invite; Chetan stays a placeholder (not signed up). */
async function trip(review?: { threshold: string }) {
  const asha = await api.user('Asha');
  const ben = await api.user('Ben');
  const g = ok(await asha.send('POST', '/groups', { name: 'Goa Trip', kind: 'trip', placeholders: ['Ben', 'Chetan'] }), 201).body;
  const placeholder = (name: string) => g.members.find((m: { displayName: string }) => m.displayName === name).id as string;
  const invite = ok(await asha.send('POST', `/groups/${g.group.id}/invites`, {}), 201).body;
  ok(await ben.send('POST', '/invites/accept', { token: invite.token, claimMemberId: placeholder('Ben') }));
  if (review) ok(await asha.send('PATCH', `/groups/${g.group.id}`, { reviewThreshold: review.threshold }));
  return { asha, ben, groupId: g.group.id as string, a: g.me.memberId as string, b: placeholder('Ben'), c: placeholder('Chetan') };
}

type Trip = Awaited<ReturnType<typeof trip>>;

const hotel = (t: Trip, total = '600000', members = [t.a, t.b, t.c]) => ({
  title: 'Hotel',
  date: today,
  currency: 'INR',
  total,
  payers: [{ memberId: t.a, amount: total }],
  split: { method: 'equal', members },
});

async function balances(user: User, groupId: string): Promise<Record<string, string>> {
  const d = ok(await user.get(`/groups/${groupId}`)).body;
  return Object.fromEntries(d.balances.map((b: { memberId: string; amount: string }) => [b.memberId, b.amount]));
}

async function ledgerRows(expenseId: string): Promise<number> {
  const r = await api.query<{ n: number }>(`select count(*)::int as n from app.ledger_entries le join app.ledger_batches b on b.id = le.batch_id where b.source_id = $1`, [expenseId]);
  return r.rows[0]!.n;
}

describe('auth', () => {
  it('health needs no sign-in', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ ok: true });
  });

  it('refuses missing, forged, expired and non-user tokens', async () => {
    const get = (authorization?: string) =>
      api.app.inject({ method: 'GET', url: '/v1/groups', headers: authorization ? { authorization } : {} });
    expect((await get()).statusCode).toBe(401);
    expect((await get('Bearer not-a-jwt')).statusCode).toBe(401);
    const sub = crypto.randomUUID();
    expect((await get(`Bearer ${await api.sign({ sub, role: 'authenticated' }, '-1m')}`)).statusCode).toBe(401);
    expect((await get(`Bearer ${await api.sign({ sub, role: 'anon' })}`)).statusCode).toBe(401);
    expect((await get(`Bearer ${await api.sign({ sub: 'service', role: 'authenticated' })}`)).statusCode).toBe(401);
    const res = await get(`Bearer ${await api.sign({ sub, role: 'authenticated' })}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ groups: [] });
  });

  it('treats ids that are not UUIDs as not found', async () => {
    const u = await api.user('Asha');
    const res = await u.get('/groups/1%20or%201=1');
    expect(res.status).toBe(404);
  });
});

describe('idempotency (I7)', () => {
  it('requires a key on changes', async () => {
    const u = await api.user('Asha');
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: { authorization: `Bearer ${u.token}` },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('idempotency_key_required');
  });

  it('replays the stored response for a retry and refuses the key for a different request', async () => {
    const u = await api.user('Asha');
    const key = newKey();
    const first = ok(await u.send('POST', '/groups', { name: 'Flat' }, key), 201);
    const retry = ok(await u.send('POST', '/groups', { name: 'Flat' }, key), 201);
    expect(retry.body).toEqual(JSON.parse(JSON.stringify(first.body)));
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(ok(await u.get('/groups')).body.groups).toHaveLength(1);

    const other = await u.send('POST', '/groups', { name: 'Other' }, key);
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('idempotency_key_reused');
  });

  it('does not keep the key when the change fails, so a fixed retry runs', async () => {
    const u = await api.user('Asha');
    const key = newKey();
    const t = await trip();
    // Not a member of that group: the change fails and the key is released.
    expect((await u.send('POST', `/groups/${t.groupId}/members`, { displayName: 'X' }, key)).status).toBe(404);
    expect((await u.send('POST', `/groups/${t.groupId}/members`, { displayName: 'X' }, key)).status).toBe(404);
  });
});

describe('groups, members and invites', () => {
  it('creates a group with placeholders and lets a friend claim one through an invite', async () => {
    const t = await trip();
    const d = ok(await t.ben.get(`/groups/${t.groupId}`)).body;
    expect(d.me.memberId).toBe(t.b);
    expect(d.members.map((m: { displayName: string; joined: boolean }) => [m.displayName, m.joined])).toEqual([
      ['Asha', true],
      ['Ben', true],
      ['Chetan', false],
    ]);
  });

  it('a name clash on joining says what to do instead of "already exists"', async () => {
    const t = await trip(); // Chetan is a placeholder; Ben already claimed his
    const chetan = await api.user('Chetan');
    const inv = ok(await t.asha.send('POST', `/groups/${t.groupId}/invites`, {}), 201).body;
    const asNew = await chetan.send('POST', '/invites/accept', { token: inv.token });
    expect(asNew.status).toBe(409);
    expect(asNew.body.error).toMatchObject({ code: 'name_taken', message: expect.stringContaining('already called Chetan') });
    const claimTaken = await chetan.send('POST', '/invites/accept', { token: inv.token, claimMemberId: t.b });
    expect(claimTaken.body.error.code).toBe('name_claimed');
    // Joining under a different name works.
    const joined = ok(await chetan.send('POST', '/invites/accept', { token: inv.token, displayName: 'Chetan K' })).body;
    expect(joined.members.map((m: { displayName: string }) => m.displayName).sort()).toEqual(['Asha', 'Ben', 'Chetan', 'Chetan K']);
  });

  it('previews an invite without joining, and stops working once revoked', async () => {
    const t = await trip();
    const dev = await api.user('Dev');
    const inv = ok(await t.asha.send('POST', `/groups/${t.groupId}/invites`, { maxUses: 1 }), 201).body;
    const preview = ok(await dev.send('POST', '/invites/preview', { token: inv.token })).body;
    expect(preview).toMatchObject({ groupId: t.groupId, name: 'Goa Trip', memberCount: 3 });
    expect(preview.placeholders).toEqual([{ id: t.c, displayName: 'Chetan' }]);
    expect((await dev.get(`/groups/${t.groupId}`)).status).toBe(404);

    ok(await t.asha.send('POST', `/groups/${t.groupId}/invites/${inv.id}/revoke`, {}));
    const after = await dev.send('POST', '/invites/preview', { token: inv.token });
    expect(after.status).toBe(404);
    expect((await dev.send('POST', '/invites/accept', { token: inv.token })).status).toBe(404);
  });

  it('hides groups from outsiders and limits settings to admins', async () => {
    const t = await trip();
    const outsider = await api.user('Eve');
    expect((await outsider.get(`/groups/${t.groupId}`)).status).toBe(404);
    expect((await outsider.get(`/groups/${t.groupId}/expenses`)).status).toBe(404);
    expect((await t.ben.send('PATCH', `/groups/${t.groupId}`, { name: 'Mine now' })).status).toBe(403);
    expect(ok(await t.asha.send('PATCH', `/groups/${t.groupId}`, { name: 'Goa 2026' })).body.group.name).toBe('Goa 2026');
  });

  it('asks before someone leaves with a balance, then keeps their read-only view', async () => {
    const t = await trip();
    ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201);
    const blocked = await t.ben.send('POST', `/groups/${t.groupId}/leave`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'balance_not_zero', details: { balance: '-200000' } });

    ok(await t.ben.send('POST', `/groups/${t.groupId}/leave`, { acknowledgeBalance: true }));
    const view = ok(await t.ben.get(`/groups/${t.groupId}`)).body;
    expect(view.me.status).toBe('left');
    expect(view.transfers).toEqual([]);
    const add = await t.ben.send('POST', `/groups/${t.groupId}/expenses`, hotel(t));
    expect(add.status).toBe(403);
    expect(add.body.error.code).toBe('not_a_member');

    // I11: Ben still sees the expense he was part of, but nothing added after he left.
    ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, { ...hotel(t, '1000', [t.a, t.c]), title: 'Snacks' }), 201);
    const seen = ok(await t.ben.get(`/groups/${t.groupId}/expenses`)).body.expenses;
    expect(seen.map((x: { title: string }) => x.title)).toEqual(['Hotel']);
  });
});

describe('expenses', () => {
  it('adds an expense that counts at once, split with the rounding rule', async () => {
    const t = await trip();
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '100000')), 201).body;
    expect(e).toMatchObject({ status: 'active', currentVersion: 1, postedVersion: 1, canEdit: true });
    const b = await balances(t.asha, t.groupId);
    expect(BigInt(b[t.a]!) + BigInt(b[t.b]!) + BigInt(b[t.c]!)).toBe(0n);
    // ₹1000 / 3: the leftover paisa goes to whoever the expense id picks (fair over many expenses).
    const owed = [BigInt(b[t.a]!) - 100000n, BigInt(b[t.b]!), BigInt(b[t.c]!)];
    expect(owed.reduce((x, y) => x + y, 0n)).toBe(-100000n);
    for (const share of owed) expect([-33333n, -33334n]).toContain(share);
  });

  it('rejects members from outside the group and splits that do not add up', async () => {
    const t = await trip();
    const stranger = crypto.randomUUID();
    const bad = await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '600000', [t.a, stranger]));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('unknown_member');
    const wrong = await t.asha.send('POST', `/groups/${t.groupId}/expenses`, {
      ...hotel(t),
      split: { method: 'exact', amounts: [{ memberId: t.a, amount: '100' }] },
    });
    expect(wrong.status).toBe(422);
  });

  it('keeps drafts private and out of balances until submitted', async () => {
    const t = await trip();
    const d = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, { ...hotel(t), draft: true }), 201).body;
    expect(d.status).toBe('draft');
    expect(await balances(t.asha, t.groupId)).toEqual({});
    expect((await t.ben.get(`/expenses/${d.id}`)).status).toBe(404);
    expect(ok(await t.ben.get(`/groups/${t.groupId}/expenses`)).body.expenses).toEqual([]);

    ok(await t.asha.send('POST', `/expenses/${d.id}/submit`, { baseVersion: 1 }));
    expect(await balances(t.asha, t.groupId)).toEqual({ [t.a]: '400000', [t.b]: '-200000', [t.c]: '-200000' });
  });

  it('edits: a title change leaves the ledger alone; a money change reposts it', async () => {
    const t = await trip();
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    const rows = await ledgerRows(e.id);

    const renamed = ok(await t.asha.send('PUT', `/expenses/${e.id}`, { ...hotel(t), title: 'Hotel (2 nights)', baseVersion: 1 })).body;
    expect(renamed).toMatchObject({ currentVersion: 2, postedVersion: 2 });
    expect(await ledgerRows(e.id)).toBe(rows);

    ok(await t.asha.send('PUT', `/expenses/${e.id}`, { ...hotel(t, '540000'), baseVersion: 2 }));
    expect(await balances(t.asha, t.groupId)).toEqual({ [t.a]: '360000', [t.b]: '-180000', [t.c]: '-180000' });
    expect(await ledgerRows(e.id)).toBe(rows * 3); // original, its reversal, the new posting

    const stale = await t.asha.send('PUT', `/expenses/${e.id}`, { ...hotel(t), baseVersion: 2 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_version');
  });

  it('lets only the creator or a payer edit; others suggest', async () => {
    const t = await trip();
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    const res = await t.ben.send('PUT', `/expenses/${e.id}`, { ...hotel(t, '1000'), baseVersion: 1 });
    expect(res.status).toBe(403);
    expect(ok(await t.ben.get(`/expenses/${e.id}`)).body.canEdit).toBe(false);
  });

  it('deletes and restores through the ledger', async () => {
    const t = await trip();
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    const del = ok(await t.asha.send('POST', `/expenses/${e.id}/delete`, { baseVersion: 1 })).body;
    expect(del).toMatchObject({ status: 'deleted', postedVersion: null, restorableVersion: 1 });
    expect(await balances(t.asha, t.groupId)).toEqual({});
    ok(await t.asha.send('POST', `/expenses/${e.id}/restore`, { baseVersion: 1 }));
    expect(await balances(t.asha, t.groupId)).toEqual({ [t.a]: '400000', [t.b]: '-200000', [t.c]: '-200000' });
  });

  it('disputes stay counted and close when the money changes', async () => {
    const t = await trip();
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    const d = ok(await t.ben.send('POST', `/expenses/${e.id}/dispute`, { baseVersion: 1, reason: 'I arrived a day late' })).body;
    expect(d.disputes).toHaveLength(1);
    expect(d.postedVersion).toBe(1);
    const list = ok(await t.asha.get(`/groups/${t.groupId}/expenses`)).body.expenses;
    expect(list[0]).toMatchObject({ disputed: true, counted: true });

    const fixed = ok(
      await t.asha.send('PUT', `/expenses/${e.id}`, {
        ...hotel(t),
        split: { method: 'shares', shares: [{ memberId: t.a, shares: '2' }, { memberId: t.b, shares: '1' }, { memberId: t.c, shares: '2' }] },
        baseVersion: 1,
      }),
    ).body;
    expect(fixed.disputes).toEqual([]);
  });

  it('resolves questions only by the asker or an owner', async () => {
    const t = await trip();
    const dev = await api.user('Dev');
    const inv = ok(await t.asha.send('POST', `/groups/${t.groupId}/invites`, {}), 201).body;
    ok(await dev.send('POST', '/invites/accept', { token: inv.token }));
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    const q = ok(await t.ben.send('POST', `/expenses/${e.id}/messages`, { kind: 'question', body: 'Does this include breakfast?' }), 201).body;
    const question = q.messages[0];
    expect(ok(await t.asha.get(`/groups/${t.groupId}/expenses`)).body.expenses[0].openQuestions).toBe(1);
    // Dev is not in this expense, so its thread is invisible to him.
    expect((await dev.send('POST', `/messages/${question.id}/resolve`, {})).status).toBe(404);
    ok(await t.asha.send('POST', `/messages/${question.id}/resolve`, {}));
    expect(ok(await t.asha.get(`/groups/${t.groupId}/expenses`)).body.expenses[0].openQuestions).toBe(0);
  });
});

describe('suggestions', () => {
  it('an accepted suggestion becomes the next version', async () => {
    const t = await trip();
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    const s = ok(
      await t.ben.send('POST', `/expenses/${e.id}/suggestions`, { baseVersion: 1, proposal: hotel(t, '540000'), reason: 'Discount applied' }),
      201,
    ).body.suggestions[0];
    expect(s.status).toBe('open');
    expect(await balances(t.asha, t.groupId)).toEqual({ [t.a]: '400000', [t.b]: '-200000', [t.c]: '-200000' });

    expect((await t.ben.send('POST', `/suggestions/${s.id}/accept`, {})).status).toBe(403);
    const after = ok(await t.asha.send('POST', `/suggestions/${s.id}/accept`, {})).body;
    expect(after.currentVersion).toBe(2);
    expect(after.suggestions[0]).toMatchObject({ status: 'accepted', appliedVersion: 2 });
    expect(await balances(t.asha, t.groupId)).toEqual({ [t.a]: '360000', [t.b]: '-180000', [t.c]: '-180000' });
  });

  it('a suggestion goes out of date when the expense changes first', async () => {
    const t = await trip();
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    const s = ok(await t.ben.send('POST', `/expenses/${e.id}/suggestions`, { baseVersion: 1, proposal: hotel(t, '540000') }), 201).body
      .suggestions[0];
    const edited = ok(await t.asha.send('PUT', `/expenses/${e.id}`, { ...hotel(t), title: 'Hotel Sea View', baseVersion: 1 })).body;
    expect(edited.suggestions[0].status).toBe('outdated');
    expect((await t.asha.send('POST', `/suggestions/${s.id}/accept`, {})).status).toBe(409);
  });
});

describe('review mode', () => {
  it('a new expense above the threshold counts only after an OK', async () => {
    const t = await trip({ threshold: '100000' });
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    expect(e).toMatchObject({ status: 'in_review', postedVersion: null });
    expect(e.review).toMatchObject({ kind: 'create', version: 1, required: 1, eligible: [t.b] });
    expect(await balances(t.asha, t.groupId)).toEqual({});

    expect((await t.asha.send('POST', `/expenses/${e.id}/approve`, { version: 1 })).status).toBe(403);
    const approved = ok(await t.ben.send('POST', `/expenses/${e.id}/approve`, { version: 1 })).body;
    expect(approved).toMatchObject({ status: 'active', postedVersion: 1, review: null });
    expect(await balances(t.asha, t.groupId)).toEqual({ [t.a]: '400000', [t.b]: '-200000', [t.c]: '-200000' });
  });

  it('a declined edit leaves the old amount counted', async () => {
    const t = await trip({ threshold: '100000' });
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    ok(await t.ben.send('POST', `/expenses/${e.id}/approve`, { version: 1 }));

    const pending = ok(await t.asha.send('PUT', `/expenses/${e.id}`, { ...hotel(t, '900000'), baseVersion: 1 })).body;
    expect(pending).toMatchObject({ status: 'in_review', currentVersion: 2, postedVersion: 1, review: { kind: 'edit', version: 2 } });
    expect(ok(await t.ben.get(`/groups/${t.groupId}/expenses`)).body.expenses[0]).toMatchObject({ pendingChange: true, total: '600000' });

    const declined = ok(await t.ben.send('POST', `/expenses/${e.id}/decline`, { version: 2, reason: 'We agreed on 6000' })).body;
    expect(declined).toMatchObject({ status: 'active', review: null });
    expect(declined.postedVersion).toBe(declined.currentVersion);
    expect(declined.versions.at(-1).total).toBe('600000');
    expect(await balances(t.asha, t.groupId)).toEqual({ [t.a]: '400000', [t.b]: '-200000', [t.c]: '-200000' });
  });

  it('counts at once when nobody who has signed up can review it', async () => {
    const t = await trip({ threshold: '100000' });
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '600000', [t.a, t.c])), 201).body;
    expect(e).toMatchObject({ status: 'active', postedVersion: 1 });
  });

  it('a review waiting only on someone who is removed passes', async () => {
    const t = await trip({ threshold: '100000' });
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '600000', [t.a, t.b])), 201).body;
    expect(e.status).toBe('in_review');
    ok(await t.asha.send('POST', `/groups/${t.groupId}/members/${t.b}/remove`, {}));
    expect(ok(await t.asha.get(`/expenses/${e.id}`)).body).toMatchObject({ status: 'active', postedVersion: 1 });
  });
});

describe('settlements', () => {
  it('a payment recorded by the payer counts once the receiver confirms', async () => {
    const t = await trip();
    ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201);
    const p = ok(await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: t.a, amount: '200000', method: 'upi' }), 201)
      .body;
    expect(p).toMatchObject({ status: 'awaiting_confirmation', counted: false });
    expect((await balances(t.asha, t.groupId))[t.b]).toBe('-200000');

    expect((await t.ben.send('POST', `/settlements/${p.id}/confirm`, {})).status).toBe(403);
    ok(await t.asha.send('POST', `/settlements/${p.id}/confirm`, {}));
    expect(ok(await t.asha.send('POST', `/settlements/${p.id}/confirm`, {})).body.status).toBe('confirmed');
    expect(await balances(t.asha, t.groupId)).toEqual({ [t.a]: '200000', [t.c]: '-200000' });
  });

  it('a payment recorded by the receiver counts at once and can be voided', async () => {
    const t = await trip();
    ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201);
    const p = ok(await t.asha.send('POST', `/groups/${t.groupId}/settlements`, { from: t.c, to: t.a, amount: '200000', method: 'cash' }), 201)
      .body;
    expect(p).toMatchObject({ status: 'confirmed', counted: true, decidedBy: t.a });
    expect((await balances(t.asha, t.groupId))[t.c]).toBeUndefined();

    expect((await t.asha.send('POST', `/settlements/${p.id}/void`, {})).status).toBe(400);
    ok(await t.asha.send('POST', `/settlements/${p.id}/void`, { reason: 'Counted twice' }));
    expect((await balances(t.asha, t.groupId))[t.c]).toBe('-200000');
  });

  it('cannot record a payment between two other people, or with someone outside the group', async () => {
    const t = await trip();
    const res = await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.c, to: t.a, amount: '100', method: 'cash' });
    expect(res.status).toBe(403);
    const outside = await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: crypto.randomUUID(), amount: '100', method: 'cash' });
    expect(outside.status).toBe(422);
  });

  it('settles up with someone who has left, in both directions', async () => {
    const t = await trip();
    ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, { ...hotel(t, '600000', [t.a, t.b]), payers: [{ memberId: t.b, amount: '600000' }] }), 201);
    ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '300000')), 201);
    // Asha owes Ben 3000 - 1000 = 2000; Ben leaves before being paid.
    ok(await t.ben.send('POST', `/groups/${t.groupId}/leave`, { acknowledgeBalance: true }));

    const p = ok(await t.asha.send('POST', `/groups/${t.groupId}/settlements`, { from: t.a, to: t.b, amount: '100000', method: 'upi' }), 201).body;
    expect(p.status).toBe('awaiting_confirmation');
    expect(ok(await t.ben.send('POST', `/settlements/${p.id}/confirm`, {})).body.status).toBe('confirmed');
    // Ben, as receiver, also records the rest arriving in cash.
    ok(await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.a, to: t.b, amount: '100000', method: 'cash' }), 201);
    expect((await balances(t.asha, t.groupId))[t.b]).toBeUndefined();
    expect(ok(await t.ben.get(`/groups/${t.groupId}/settlements`)).body.settlements).toHaveLength(2);

    // A former member still cannot touch payments between other people.
    const other = ok(await t.asha.send('POST', `/groups/${t.groupId}/settlements`, { from: t.c, to: t.a, amount: '500', method: 'cash' }), 201).body;
    expect((await t.ben.send('POST', `/settlements/${other.id}/void`, { reason: 'x' })).status).toBe(404);
    expect((await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.c, to: t.a, amount: '500', method: 'cash' })).status).toBe(403);
  });

  it('declines and withdrawals never touch the ledger', async () => {
    const t = await trip();
    const send = () => t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: t.a, amount: '5000', method: 'upi' });
    const one = ok(await send(), 201).body;
    const two = ok(await send(), 201).body;
    expect(ok(await t.asha.send('POST', `/settlements/${one.id}/decline`, { reason: 'Not received' })).body.status).toBe('declined');
    expect(ok(await t.ben.send('POST', `/settlements/${two.id}/withdraw`, {})).body.status).toBe('withdrawn');
    expect(await balances(t.asha, t.groupId)).toEqual({});
    const list = ok(await t.asha.get(`/groups/${t.groupId}/settlements`)).body.settlements;
    expect(list.map((s: { status: string }) => s.status).sort()).toEqual(['declined', 'withdrawn']);
  });
});

describe('snapshot', () => {
  it('returns members, balances, full expenses and payments in one call', async () => {
    const t = await trip();
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    ok(await t.ben.send('POST', `/expenses/${e.id}/messages`, { kind: 'question', body: 'Breakfast?' }), 201);
    ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, { ...hotel(t), title: 'Private', draft: true }), 201);
    ok(await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: t.a, amount: '1000', method: 'upi' }), 201);

    const s = ok(await t.ben.get(`/groups/${t.groupId}/snapshot`)).body;
    expect(s.me.memberId).toBe(t.b);
    expect(s.members).toHaveLength(3);
    // Asha's draft is hers alone.
    expect(s.expenses.map((x: { versions: { title: string }[] }) => x.versions[0]!.title)).toEqual(['Hotel']);
    expect(s.expenses[0].messages[0]).toMatchObject({ kind: 'question', body: 'Breakfast?' });
    expect(s.settlements).toHaveLength(1);
    expect((await (await api.user('Eve')).get(`/groups/${t.groupId}/snapshot`)).status).toBe(404);
  });

  it('the snapshot shows each expense exactly as its own page does', async () => {
    const t = await trip({ threshold: '500000' });
    const dev = await api.user('Dev'); // in the group, not in the cab
    const inv = ok(await t.asha.send('POST', `/groups/${t.groupId}/invites`, {}), 201).body;
    ok(await dev.send('POST', '/invites/accept', { token: inv.token }));
    // In review (above the threshold), with a question, an answer and a seen mark.
    const big = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t)), 201).body;
    ok(await t.ben.send('POST', `/expenses/${big.id}/messages`, { kind: 'question', body: 'Breakfast?' }), 201);
    ok(await t.asha.send('POST', `/expenses/${big.id}/messages`, { body: 'Yes' }), 201);
    ok(await t.ben.send('POST', '/seen', { items: [{ groupId: t.groupId, type: 'expense', id: big.id, version: 1 }] }));
    // Counted, edited once, disputed, with an open suggestion.
    const cab = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, { ...hotel(t, '90000', [t.a, t.b]), title: 'Cab' }), 201).body;
    ok(await t.asha.send('PUT', `/expenses/${cab.id}`, { ...hotel(t, '80000', [t.a, t.b]), title: 'Cab', baseVersion: 1 }));
    ok(await t.ben.send('POST', `/expenses/${cab.id}/dispute`, { baseVersion: 2, reason: 'Was 70' }));
    ok(await t.ben.send('POST', `/expenses/${cab.id}/suggestions`, { baseVersion: 2, proposal: { ...hotel(t, '70000', [t.a, t.b]), title: 'Cab' }, reason: 'Meter said 700' }), 201);
    // Asha's draft.
    ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, { ...hotel(t), title: 'Draft', draft: true }), 201);

    for (const u of [t.asha, t.ben, dev]) {
      const snap = ok(await u.get(`/groups/${t.groupId}/snapshot`)).body;
      const own = [];
      for (const x of snap.expenses) own.push(ok(await u.get(`/expenses/${x.id}`)).body);
      expect(snap.expenses).toEqual(own);
      expect(snap.expenses.length).toBe(u === t.asha ? 3 : 2);
    }
  });
});

describe('conversation: expense threads, pair threads, seen, pulse', () => {
  /** Trip plus Dev, who joins but is not in the hotel expense. */
  async function tripWithDev() {
    const t = await trip();
    const dev = await api.user('Dev');
    const inv = ok(await t.asha.send('POST', `/groups/${t.groupId}/invites`, {}), 201).body;
    const d = ok(await dev.send('POST', '/invites/accept', { token: inv.token })).body;
    const e = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '600000', [t.a, t.b])), 201).body;
    return { ...t, dev, d: d.me.memberId as string, e: e.id as string };
  }

  it('an expense thread is only for the people in the expense', async () => {
    const t = await tripWithDev();
    ok(await t.ben.send('POST', `/expenses/${t.e}/messages`, { body: 'Paid with my card?' }), 201);
    const forAsha = ok(await t.asha.get(`/expenses/${t.e}`)).body;
    expect(forAsha.canChat).toBe(true);
    expect(forAsha.messages.map((m: { body: string }) => m.body)).toEqual(['Paid with my card?']);

    const forDev = ok(await t.dev.get(`/expenses/${t.e}`)).body; // the expense itself stays visible to the group
    expect(forDev.canChat).toBe(false);
    expect(forDev.messages).toEqual([]);
    const post = await t.dev.send('POST', `/expenses/${t.e}/messages`, { body: 'me too' });
    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('not_in_expense');
    expect(ok(await t.dev.get(`/groups/${t.groupId}/expenses`)).body.expenses[0].openQuestions).toBe(0);

    // A reply must point into the same thread.
    const other = ok(await t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '1000', [t.a, t.b])), 201).body;
    const m = ok(await t.asha.send('POST', `/expenses/${other.id}/messages`, { body: 'x' }), 201).body.messages[0];
    expect((await t.ben.send('POST', `/expenses/${t.e}/messages`, { body: 'y', replyTo: m.id })).status).toBe(422);
  });

  it('a pair thread is private to the two people, also after one leaves', async () => {
    const t = await tripWithDev();
    const sent = ok(await t.ben.send('POST', `/groups/${t.groupId}/pairs/${t.a}/messages`, { body: 'Sending 3000 tonight' }), 201).body;
    expect(sent.messages.map((m: { body: string; authorId: string }) => [m.authorId, m.body])).toEqual([[t.b, 'Sending 3000 tonight']]);
    expect(ok(await t.asha.get(`/groups/${t.groupId}/pairs/${t.b}`)).body.messages).toHaveLength(1);
    // Dev sees nothing of it, even asking for the same pair from his side.
    expect(ok(await t.dev.get(`/groups/${t.groupId}/pairs/${t.a}`)).body.messages).toEqual([]);
    expect(ok(await t.dev.get(`/groups/${t.groupId}/snapshot`)).body.pairMessages).toEqual([]);
    expect(ok(await t.asha.get(`/groups/${t.groupId}/snapshot`)).body.pairMessages).toHaveLength(1);
    expect((await t.ben.send('POST', `/groups/${t.groupId}/pairs/${t.b}/messages`, { body: 'me' })).status).toBe(422);
    expect((await t.ben.send('POST', `/groups/${t.groupId}/pairs/${crypto.randomUUID()}/messages`, { body: 'x' })).status).toBe(422);

    ok(await t.ben.send('POST', `/groups/${t.groupId}/leave`, { acknowledgeBalance: true }));
    ok(await t.ben.send('POST', `/groups/${t.groupId}/pairs/${t.a}/messages`, { body: 'Done, check UPI' }), 201);
    expect(ok(await t.asha.get(`/groups/${t.groupId}/pairs/${t.b}`)).body.messages).toHaveLength(2);
  });

  it('records seen for money items, visible only to who may see the item', async () => {
    const t = await tripWithDev();
    ok(await t.ben.send('POST', '/seen', { items: [{ groupId: t.groupId, type: 'expense', id: t.e, version: 1 }] }));
    ok(await t.dev.send('POST', '/seen', { items: [{ groupId: t.groupId, type: 'expense', id: t.e, version: 1 }] })); // ignored: not his
    ok(await t.ben.send('POST', '/seen', { items: [{ groupId: t.groupId, type: 'pair', id: t.a }] }));
    const d = ok(await t.asha.get(`/expenses/${t.e}`)).body;
    expect(d.seen).toEqual([{ memberId: t.b, version: 1, seenAt: expect.any(String) }]);
    const thread = ok(await t.asha.get(`/groups/${t.groupId}/pairs/${t.b}`)).body;
    expect(thread.seen.map((x: { memberId: string }) => x.memberId)).toEqual([t.b]);
    expect(ok(await t.dev.get(`/groups/${t.groupId}/snapshot`)).body.seen).toEqual([]);
    // Seeing someone else's pair thread is impossible: Dev can't mark Asha–Ben as seen by Ben.
    expect((await t.dev.send('POST', '/seen', { items: [{ groupId: crypto.randomUUID(), type: 'pair', id: t.a }] })).status).toBe(404);
  });

  it('pulse changes when anything visible changes, so the app reloads only that group', async () => {
    const t = await tripWithDev();
    const pulse = async (u: User) => ok(await u.get('/pulse')).body.groups[t.groupId] as string;
    const before = await pulse(t.asha);
    expect(await pulse(t.asha)).toBe(before);
    ok(await t.ben.send('POST', `/expenses/${t.e}/messages`, { body: 'hello' }), 201);
    const afterMessage = await pulse(t.asha);
    expect(afterMessage).not.toBe(before);
    ok(await t.ben.send('POST', '/seen', { items: [{ groupId: t.groupId, type: 'expense', id: t.e, version: 1 }] }));
    expect(await pulse(t.asha)).not.toBe(afterMessage);
    expect(Object.keys(ok(await (await api.user('Eve')).get('/pulse')).body.groups)).toEqual([]);
  });

  it('live hints reach only the people who may see the change, once per change', async () => {
    const t = await tripWithDev();
    const cara = await api.user('Cara'); // in the group, not in the hotel expense
    const inv = ok(await t.asha.send('POST', `/groups/${t.groupId}/invites`, {}), 201).body;
    const c = ok(await cara.send('POST', '/invites/accept', { token: inv.token })).body.me.memberId as string;
    const told = async (fn: () => Promise<unknown>) => {
      await api.query('delete from realtime.messages');
      await fn();
      const r = await api.query<{ topic: string; payload: Record<string, string>; private: boolean }>('select topic, payload, private from realtime.messages');
      for (const m of r.rows) {
        expect(m.private).toBe(true);
        expect(Object.keys(m.payload).filter((k) => k !== 'id')).toEqual(['g']); // no amounts, names or text (Supabase adds an id)
        expect(m.payload.g).toBe(t.groupId);
      }
      return r.rows.map((m) => m.topic).sort();
    };
    const topic = (u: User) => `user:${u.id}`;
    const everyone = [t.asha, t.ben, t.dev, cara].map(topic).sort();

    // A new expense: every current member, each told once.
    expect(await told(() => t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '1000', [t.a, t.b])))).toEqual(everyone);
    // The hotel's thread and its seen marks: Asha and Ben only.
    expect(await told(() => t.ben.send('POST', `/expenses/${t.e}/messages`, { body: 'Card or cash?' }))).toEqual([t.asha, t.ben].map(topic).sort());
    expect(await told(() => t.asha.send('POST', '/seen', { items: [{ groupId: t.groupId, type: 'expense', id: t.e, version: 1 }] }))).toEqual(
      [t.asha, t.ben].map(topic).sort(),
    );
    // A pair thread: the two people only.
    expect(await told(() => t.dev.send('POST', `/groups/${t.groupId}/pairs/${c}/messages`, { body: 'Sending 200' }))).toEqual([t.dev, cara].map(topic).sort());
    // Removing Cara tells everyone, Cara included, so her app drops the group.
    expect(await told(() => t.asha.send('POST', `/groups/${t.groupId}/members/${c}/remove`, { acknowledgeBalance: true }))).toEqual(everyone);
    // After that she hears nothing more from the group.
    expect(await told(() => t.asha.send('POST', `/groups/${t.groupId}/expenses`, hotel(t, '2000', [t.a, t.b])))).toEqual([t.asha, t.ben, t.dev].map(topic).sort());
  });
});

describe('browser access and rate limits', () => {
  let limited: TestApi;
  beforeAll(async () => {
    limited = await testApi(undefined, { corsOrigins: ['http://localhost:8081'], rateLimitPerMinute: 20 });
  }, 60_000);
  afterAll(() => limited?.app.close());

  it('answers CORS preflights only for the app origin', async () => {
    const preflight = (origin: string) =>
      limited.app.inject({
        method: 'OPTIONS',
        url: '/v1/groups',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,idempotency-key' },
      });
    const allowed = await preflight('http://localhost:8081');
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    const other = await preflight('https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('limits each user separately, and invite links more tightly', async () => {
    const asha = await limited.user('Asha'); // its profile PUT is request 1
    const ben = await limited.user('Ben');
    for (let i = 0; i < 19; i++) ok(await asha.get('/groups'));
    const blocked = await asha.get('/groups');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    expect(blocked.headers['retry-after']).toBeDefined();
    ok(await ben.get('/groups'));

    const token = 'A'.repeat(43);
    expect((await ben.send('POST', '/invites/preview', { token })).status).toBe(404);
    expect((await ben.send('POST', '/invites/preview', { token })).status).toBe(404);
    expect((await ben.send('POST', '/invites/preview', { token })).status).toBe(429);
  });
});
