import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, ok, testApi } from './harness';

// A database that hasn't had the receipts migration yet (e.g. the shared dev project while the
// feature is built): everything else must keep working. Own file, so the API's one-time table check
// starts fresh.
let api: TestApi;
beforeAll(async () => {
  api = await testApi();
  await api.query('drop table app.receipts cascade');
}, 120_000);
afterAll(async () => {
  await api?.app.close();
});

describe('receipts migration not applied yet', () => {
  it('groups, snapshots and expenses still load, with no receipts', async () => {
    const asha = await api.user('Asha');
    const g = ok(await asha.send('POST', '/groups', { name: 'Goa', kind: 'trip', placeholders: ['Ben'] }), 201).body;
    const a = g.me.memberId as string;
    const e = ok(
      await asha.send('POST', `/groups/${g.group.id}/expenses`, { title: 'Hotel', date: '2026-10-24', currency: 'INR', total: '1000', payers: [{ memberId: a, amount: '1000' }], split: { method: 'equal', members: [a] } }),
      201,
    ).body;
    expect(e.receipts).toEqual([]);
    const snap = ok(await asha.get(`/groups/${g.group.id}/snapshot`)).body;
    expect(snap.expenses[0].receipts).toEqual([]);
    expect(ok(await asha.get(`/expenses/${e.id}`)).body.receipts).toEqual([]);
  });
});
