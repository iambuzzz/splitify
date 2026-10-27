import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cachedReceiptStore, folderReceiptStore, sniffType, supabaseReceiptStore } from '../../apps/api/src/receipts-store';
import { postgresBackend } from '../pg/harness';
import { type TestApi, type User, ok, testApi } from './harness';

let api: TestApi;
let off: TestApi;
let drop: (() => Promise<void>) | undefined;
const dir = mkdtempSync(join(tmpdir(), 'splitify-receipts-'));
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  const pg = url ? await postgresBackend(url) : undefined;
  drop = pg?.drop;
  api = await testApi(pg?.backend, { receipts: folderReceiptStore(dir) });
  off = await testApi();
}, 120_000);
afterAll(async () => {
  await api?.app.close();
  await off?.app.close();
  await drop?.();
  rmSync(dir, { recursive: true, force: true });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a tiny test image')]);
const PDF = Buffer.from('%PDF-1.7\n% a test bill\n');

function upload(t: TestApi, u: User, expenseId: string, bytes: Buffer, type: string, id = crypto.randomUUID()) {
  return t.app
    .inject({ method: 'POST', url: `/v1/expenses/${expenseId}/receipts?id=${id}&width=800&height=600`, headers: { authorization: `Bearer ${u.token}`, 'content-type': type }, payload: bytes })
    .then((r) => ({ status: r.statusCode, body: r.body ? r.json() : undefined, id }));
}
const download = (t: TestApi, u: User, id: string) => t.app.inject({ method: 'GET', url: `/v1/receipts/${id}`, headers: { authorization: `Bearer ${u.token}` } });

async function setup(t: TestApi) {
  const asha = await t.user('Asha');
  const ben = await t.user('Ben');
  const outsider = await t.user('Cara');
  const g = ok(await asha.send('POST', '/groups', { name: 'Goa', kind: 'trip', placeholders: ['Ben'] }), 201).body;
  const groupId = g.group.id as string;
  const b = g.members.find((m: { displayName: string }) => m.displayName === 'Ben').id as string;
  const inv = ok(await asha.send('POST', `/groups/${groupId}/invites`, {}), 201).body;
  ok(await ben.send('POST', '/invites/accept', { token: inv.token, claimMemberId: b }));
  const a = g.me.memberId as string;
  const expense = (title: string) =>
    asha.send('POST', `/groups/${groupId}/expenses`, { title, date: '2026-10-24', currency: 'INR', total: '100000', payers: [{ memberId: a, amount: '100000' }], split: { method: 'equal', members: [a, b] } });
  const hotel = ok(await expense('Hotel'), 201).body.id as string;
  const dinner = ok(await expense('Dinner'), 201).body.id as string;
  return { asha, ben, outsider, groupId, hotel, dinner };
}

describe('receipts (M5)', () => {
  it('a member attaches a photo; everyone in the group sees it, nobody else can', async () => {
    const t = await setup(api);
    const up = await upload(api, t.ben, t.hotel, PNG, 'image/png');
    expect(up.status).toBe(201);
    expect(up.body.receipt).toMatchObject({ id: up.id, contentType: 'image/png', byteSize: PNG.length, width: 800, height: 600 });
    expect(up.body.duplicateOf).toBeNull();
    expect(readdirSync(join(dir, t.groupId, t.hotel))).toEqual([up.id]);

    const snap = ok(await t.asha.get(`/groups/${t.groupId}/snapshot`)).body;
    expect(snap.features).toEqual({ receipts: true });
    expect(snap.expenses.find((e: { id: string }) => e.id === t.hotel).receipts.map((r: { id: string }) => r.id)).toEqual([up.id]);

    const got = await download(api, t.asha, up.id);
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-security-policy']).toContain('sandbox');

    // Someone outside the group: as if it didn't exist.
    expect((await download(api, t.outsider, up.id)).statusCode).toBe(404);
    expect((await upload(api, t.outsider, t.hotel, PNG, 'image/png')).status).toBe(404);
  });

  it('takes only real photos and PDFs, checked by their bytes', async () => {
    const t = await setup(api);
    expect((await upload(api, t.asha, t.hotel, PDF, 'application/pdf')).status).toBe(201);
    // Declared as a photo, but it's something else.
    expect((await upload(api, t.asha, t.hotel, Buffer.from('<script>alert(1)</script>'), 'image/png')).status).toBe(415);
    expect((await upload(api, t.asha, t.hotel, PNG, 'image/jpeg')).status).toBe(415);
    expect((await upload(api, t.asha, t.hotel, Buffer.from('<html></html>'), 'text/html')).status).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await upload(api, t.asha, t.hotel, big, 'image/png')).status).toBe(413);
    expect(sniffType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('spots the same photo on another expense, and a retried upload is not added twice', async () => {
    const t = await setup(api);
    const first = await upload(api, t.asha, t.hotel, PNG, 'image/png');
    const again = await upload(api, t.ben, t.dinner, PNG, 'image/png');
    expect(again.status).toBe(201);
    expect(again.body.duplicateOf).toEqual({ expenseId: t.hotel, title: 'Hotel', sameExpense: false });
    const retry = await upload(api, t.asha, t.hotel, PNG, 'image/png', first.id);
    expect(retry.status).toBe(409);
  });

  it('whoever added it, the expense owner or an admin can remove it; others cannot', async () => {
    const t = await setup(api);
    const ashas = await upload(api, t.asha, t.hotel, PNG, 'image/png');
    const bens = await upload(api, t.ben, t.hotel, PDF, 'application/pdf');
    // Ben didn't add Asha's photo and doesn't own the expense.
    expect((await t.ben.send('POST', `/receipts/${ashas.id}/delete`, {})).status).toBe(403);
    ok(await t.ben.send('POST', `/receipts/${bens.id}/delete`, {}));
    ok(await t.asha.send('POST', `/receipts/${ashas.id}/delete`, {}));
    expect((await download(api, t.asha, ashas.id)).statusCode).toBe(404);
    const snap = ok(await t.asha.get(`/groups/${t.groupId}/snapshot`)).body;
    expect(snap.expenses.find((e: { id: string }) => e.id === t.hotel).receipts).toEqual([]);
    // Kept for the record (soft delete), and recorded in the activity trail.
    const rows = await api.query<{ n: number }>('select count(*)::int as n from app.receipts where expense_id = $1 and deleted_at is not null', [t.hotel]);
    expect(rows.rows[0]!.n).toBe(2);
    const events = await api.query<{ type: string }>(`select type from app.activity_events where entity_id = $1 and type like 'receipt_%' order by id`, [t.hotel]);
    expect(events.rows.map((e) => e.type)).toEqual(['receipt_added', 'receipt_added', 'receipt_removed', 'receipt_removed']);
  });

  it('a removed receipt cannot be changed again, and rows are never deleted', async () => {
    const t = await setup(api);
    const r = await upload(api, t.asha, t.hotel, PNG, 'image/png');
    await expect(api.query(`update app.receipts set content_type = 'application/pdf' where id = $1`, [r.id])).rejects.toThrow(/only deleted_at/);
    await expect(api.query('delete from app.receipts where id = $1', [r.id])).rejects.toThrow();
  });

  it('without storage set up, the app is told and uploads answer 503', async () => {
    const t = await setup(off);
    expect(ok(await t.asha.get(`/groups/${t.groupId}/snapshot`)).body.features).toEqual({ receipts: false });
    const up = await upload(off, t.asha, t.hotel, PNG, 'image/png');
    expect(up.status).toBe(503);
    expect(up.body.error.code).toBe('receipts_not_configured');
  });
});

describe('Supabase Storage receipt store', () => {
  it('uses the secret key server side, a private bucket path, and maps errors', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const store = supabaseReceiptStore({
      supabaseUrl: 'https://p.supabase.co',
      secretKey: 'sb_secret_xxxxxxxxxxxxxxxx',
      bucket: 'receipts',
      fetch: (async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        if (init.method === 'POST') return new Response('{}', { status: 200 });
        if (url.endsWith('/missing')) return new Response('{}', { status: 400 });
        return new Response(Buffer.from('bytes'), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await store.put('g/e/r1', PNG, 'image/png');
    expect(calls[0]!.url).toBe('https://p.supabase.co/storage/v1/object/receipts/g/e/r1');
    expect(calls[0]!.init.headers).toMatchObject({ apikey: 'sb_secret_xxxxxxxxxxxxxxxx', 'content-type': 'image/png', 'x-upsert': 'false' });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect((await store.get('g/e/r1'))!.toString()).toBe('bytes');
    expect(await store.get('g/e/missing')).toBeNull();
  });

  it('a stalled or failed read is tried once more, then the app is told', async () => {
    let calls = 0;
    const warnings: Record<string, unknown>[] = [];
    const flaky = (answers: (() => Promise<Response>)[]) =>
      supabaseReceiptStore({
        supabaseUrl: 'https://p.supabase.co',
        secretKey: 'sb_secret_xxxxxxxxxxxxxxxx',
        bucket: 'receipts',
        readTimeoutMs: 50,
        warn: (_msg, d) => warnings.push(d),
        fetch: ((_url: string, init: RequestInit = {}) => {
          const answer = answers[calls++]!;
          // A stall: never answers, only gives up when the store's time limit aborts it.
          return answer === stall ? new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))) : answer();
        }) as unknown as typeof fetch,
      });
    const stall = () => new Promise<Response>(() => {});
    const ok = async () => new Response(Buffer.from('bytes'), { status: 200 });
    const down = async () => new Response('{}', { status: 503 });

    expect((await flaky([stall, ok]).get('g/e/r1'))!.toString()).toBe('bytes');
    calls = 0;
    expect((await flaky([down, ok]).get('g/e/r1'))!.toString()).toBe('bytes');
    calls = 0;
    await expect(flaky([down, stall]).get('g/e/r1')).rejects.toMatchObject({ status: 502 });
    expect(warnings).toEqual([
      { error: 'TimeoutError', attempt: 1 },
      { status: 503, attempt: 1 },
      { status: 503, attempt: 1 },
      { error: 'TimeoutError', attempt: 2 },
    ]);
  });

  it('keeps recent files in memory, within its size limit', async () => {
    const reads: string[] = [];
    const inner = folderReceiptStore(dir);
    const store = cachedReceiptStore({ ...inner, get: (k) => (reads.push(k), inner.get(k)) }, 100);
    const file = (n: number) => Buffer.alloc(n, 1);
    await store.put('g/e/a', file(20), 'image/png');
    await store.put('g/e/b', file(20), 'image/png');
    expect((await store.get('g/e/a'))!.length).toBe(20);
    expect(reads).toEqual([]);
    // Over the limit: the one used longest ago (b, since a was just read) is let go first.
    await store.put('g/e/c', file(20), 'image/png');
    await store.put('g/e/d', file(20), 'image/png');
    await store.put('g/e/e', file(20), 'image/png');
    await store.put('g/e/f', file(20), 'image/png');
    await store.get('g/e/a');
    await store.get('g/e/b');
    expect(reads).toEqual(['g/e/b']);
    // Too big to keep (over a quarter of the limit): always read from storage.
    await store.put('g/e/big', file(30), 'image/png');
    await store.get('g/e/big');
    expect(reads).toEqual(['g/e/b', 'g/e/big']);
    await store.remove('g/e/a');
    expect(await store.get('g/e/a')).toBeNull();
  });

  it('the folder store refuses keys that leave its folder', async () => {
    const store = folderReceiptStore(dir);
    await expect(store.put('../escape', PNG, 'image/png')).rejects.toThrow(/outside/);
  });
});
