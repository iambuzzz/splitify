import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Res, type TestApi, type User, newKey, ok, testApi } from '../api/harness';
import { postgresBackend } from './harness';

/**
 * Races that PGlite cannot show (it has one connection). Runs only against a disposable Postgres:
 * `npm run test:pg` starts one, runs this file and removes it. Skipped in the normal test run.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('real Postgres: concurrent requests', () => {
  let api: TestApi;
  let drop: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const pg = await postgresBackend(url!);
    drop = pg.drop;
    api = await testApi(pg.backend);
  }, 120_000);
  afterAll(async () => {
    await api?.app.close();
    await drop?.();
  });

  const today = '2026-10-23';
  const statuses = (rs: Res[]) => rs.map((r) => r.status).sort();
  const batches = async (sourceId: string) =>
    (await api.query<{ direction: string }>('select direction from app.ledger_batches where source_id = $1 order by id', [sourceId])).rows.map(
      (r) => r.direction,
    );

  /** An owner and `others` who joined by invite. Returns users with their member ids. */
  async function group(others: string[], settings?: Record<string, unknown>) {
    const owner = await api.user('Asha');
    const g = ok(await owner.send('POST', '/groups', { name: `Trip ${newKey()}` }), 201).body;
    const groupId = g.group.id as string;
    const invite = ok(await owner.send('POST', `/groups/${groupId}/invites`, {}), 201).body;
    const people: { user: User; member: string }[] = [{ user: owner, member: g.me.memberId }];
    for (const name of others) {
      const u = await api.user(name);
      const d = ok(await u.send('POST', '/invites/accept', { token: invite.token })).body;
      people.push({ user: u, member: d.me.memberId });
    }
    if (settings) ok(await owner.send('PATCH', `/groups/${groupId}`, settings));
    return { groupId, people };
  }

  const expense = (payer: string, members: string[], total = '600000') => ({
    title: 'Hotel',
    date: today,
    currency: 'INR',
    total,
    payers: [{ memberId: payer, amount: total }],
    split: { method: 'equal', members },
  });

  it('the same Idempotency-Key sent 20 times at once creates one group (I7)', async () => {
    const u = await api.user('Asha');
    const key = newKey();
    const name = `Race ${key}`;
    const rs = await Promise.all(Array.from({ length: 20 }, () => u.send('POST', '/groups', { name }, key)));
    expect(statuses(rs)).toEqual(Array(20).fill(201));
    const ids = new Set(rs.map((r) => r.body.group.id));
    expect(ids.size).toBe(1);
    expect(rs.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(19);
    const n = await api.query<{ n: number }>('select count(*)::int as n from app.groups where name = $1', [name]);
    expect(n.rows[0]!.n).toBe(1);
  });

  it('ten edits against the same version: one wins, the rest are told to reload', async () => {
    const { groupId, people } = await group(['Ben']);
    const [a, b] = people;
    const e = ok(await a!.user.send('POST', `/groups/${groupId}/expenses`, expense(a!.member, [a!.member, b!.member])), 201).body;
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        a!.user.send('PUT', `/expenses/${e.id}`, { ...expense(a!.member, [a!.member, b!.member], String(500000 + i * 100)), baseVersion: 1 }),
      ),
    );
    expect(statuses(rs)).toEqual([200, ...Array(9).fill(409)]);
    expect(await batches(e.id)).toEqual(['post', 'reverse', 'post']);
  });

  it('a payment confirmed ten times at once is counted once', async () => {
    const { groupId, people } = await group(['Ben']);
    const [a, b] = people;
    const p = ok(
      await b!.user.send('POST', `/groups/${groupId}/settlements`, { from: b!.member, to: a!.member, amount: '5000', method: 'upi' }),
      201,
    ).body;
    const rs = await Promise.all(Array.from({ length: 10 }, () => a!.user.send('POST', `/settlements/${p.id}/confirm`, {})));
    expect(statuses(rs)).toEqual(Array(10).fill(200));
    expect(await batches(p.id)).toEqual(['post']);
  });

  it('a single-use invite accepted by five people at once lets exactly one in', async () => {
    const owner = await api.user('Asha');
    const g = ok(await owner.send('POST', '/groups', { name: 'Small' }), 201).body;
    const inv = ok(await owner.send('POST', `/groups/${g.group.id}/invites`, { maxUses: 1 }), 201).body;
    const users = await Promise.all(['Ben', 'Chetan', 'Dev', 'Esha', 'Farhan'].map((n) => api.user(n)));
    const rs = await Promise.all(users.map((u) => u.send('POST', '/invites/accept', { token: inv.token })));
    expect(statuses(rs)).toEqual([200, 404, 404, 404, 404]);
    expect(ok(await owner.get(`/groups/${g.group.id}`)).body.members).toHaveLength(2);
  });

  it('parallel review OKs post the expense exactly once (I8)', async () => {
    const { groupId, people } = await group(['Ben', 'Chetan', 'Dev'], { reviewThreshold: '100000', reviewRequired: 2 });
    const [a, ...others] = people;
    const members = people.map((p) => p.member);
    const e = ok(await a!.user.send('POST', `/groups/${groupId}/expenses`, expense(a!.member, members)), 201).body;
    expect(e.status).toBe('in_review');
    const rs = await Promise.all(others.map((p) => p.user.send('POST', `/expenses/${e.id}/approve`, { version: 1 })));
    // Two OKs make it count; a third arriving after that finds nothing left to approve.
    expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(2);
    for (const r of rs) expect([200, 409]).toContain(r.status);
    expect(ok(await a!.user.get(`/expenses/${e.id}`)).body).toMatchObject({ status: 'active', postedVersion: 1 });
    expect(await batches(e.id)).toEqual(['post']);
  });

  it('accepting a suggestion while the owner edits: one wins, the other is refused', async () => {
    const { groupId, people } = await group(['Ben']);
    const [a, b] = people;
    const members = [a!.member, b!.member];
    const e = ok(await a!.user.send('POST', `/groups/${groupId}/expenses`, expense(a!.member, members)), 201).body;
    const s = ok(
      await b!.user.send('POST', `/expenses/${e.id}/suggestions`, { baseVersion: 1, proposal: expense(a!.member, members, '540000') }),
      201,
    ).body.suggestions[0];
    const [accept, edit] = await Promise.all([
      a!.user.send('POST', `/suggestions/${s.id}/accept`, {}),
      a!.user.send('PUT', `/expenses/${e.id}`, { ...expense(a!.member, members, '700000'), baseVersion: 1 }),
    ]);
    expect([accept.status, edit.status].sort()).toEqual([200, 409]);
    const d = ok(await a!.user.get(`/expenses/${e.id}`)).body;
    expect(d.currentVersion).toBe(2);
    expect(await batches(e.id)).toEqual(['post', 'reverse', 'post']);
  });
});
