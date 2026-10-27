import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PushEvent, notesFor, pushSender, summarize, wants } from '../../apps/api/src/push';
import { type Backend, type TestApi, ok, pgliteBackend, testApi } from './harness';

let backend: Backend;
let api: TestApi;
beforeAll(async () => {
  backend = await pgliteBackend();
  api = await testApi(backend, { webPushKey: 'BPublicKeyForTestsOnly_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
}, 120_000);
afterAll(async () => {
  await api?.app.close();
});

const ENDPOINT = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

async function setup() {
  const asha = await api.user('Asha');
  const ben = await api.user('Ben');
  const g = ok(await asha.send('POST', '/groups', { name: 'Goa Trip', kind: 'trip', placeholders: ['Ben'] }), 201).body;
  const groupId = g.group.id as string;
  const b = g.members.find((m: { displayName: string }) => m.displayName === 'Ben').id as string;
  const inv = ok(await asha.send('POST', `/groups/${groupId}/invites`, {}), 201).body;
  ok(await ben.send('POST', '/invites/accept', { token: inv.token, claimMemberId: b }));
  const a = g.me.memberId as string;
  const expense = (title: string, by = asha) =>
    by.send('POST', `/groups/${groupId}/expenses`, { title, date: '2026-10-27', currency: 'INR', total: '100000', payers: [{ memberId: a, amount: '100000' }], split: { method: 'equal', members: [a, b] } });
  return { asha, ben, groupId, a, b, expense };
}

/** A sender with fake push services: records what would have gone out. */
function fakeSender(opts: { expoError?: string; webStatus?: number; receiptError?: string } = {}) {
  let clock = 1_000_000;
  const warnings: { error?: string; stage?: string }[] = [];
  const expo: { to: string; title: string; body: string; data: { url: string } }[] = [];
  const web: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  const sender = pushSender({
    db: backend.db,
    vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'https://splitify.example' },
    batchMs: 120_000,
    now: () => clock,
    receiptDelayMs: 0,
    log: { info: () => {}, warn: (o: object) => void warnings.push(o) },
    fetch: (async (url: string, init: RequestInit) => {
      if (url.endsWith('/getReceipts')) {
        const { ids } = JSON.parse(init.body as string) as { ids: string[] };
        return new Response(JSON.stringify({ data: Object.fromEntries(ids.map((i) => [i, opts.receiptError ? { status: 'error', details: { error: opts.receiptError } } : { status: 'ok' }])) }), { status: 200 });
      }
      const msgs = JSON.parse(init.body as string);
      expo.push(...msgs);
      return new Response(JSON.stringify({ data: msgs.map(() => (opts.expoError ? { status: 'error', details: { error: opts.expoError } } : { status: 'ok', id: 'x' })) }), { status: 200 });
    }) as unknown as typeof fetch,
    sendWeb: async (sub, payload) => {
      if (opts.webStatus) throw Object.assign(new Error('gone'), { statusCode: opts.webStatus });
      web.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  });
  return { sender, expo, web, warnings, later: (ms: number) => (clock += ms) };
}

describe('push: devices', () => {
  it('a person turns notifications on for a phone and a browser, changes settings, and turns them off', async () => {
    const t = await setup();
    const phone = crypto.randomUUID();
    const laptop = crypto.randomUUID();
    ok(await t.ben.send('POST', '/push/devices', { id: phone, kind: 'expo', token: 'ExponentPushToken[ben-phone]', label: 'Android app' }), 201);
    ok(await t.ben.send('POST', '/push/devices', { id: laptop, kind: 'web', token: ENDPOINT('ben-laptop'), keys: KEYS, label: 'Mac browser' }), 201);
    expect(ok(await t.ben.get('/push/config')).body.kinds).toMatchObject({ needs: true, bills: true, chat: false });

    // Only their own devices, never anyone else's.
    expect(ok(await t.ben.get('/push/devices')).body.devices.map((d: { id: string }) => d.id).sort()).toEqual([phone, laptop].sort());
    expect(ok(await t.asha.get('/push/devices')).body.devices).toEqual([]);
    expect((await t.asha.send('POST', `/push/devices/${phone}`, { prefs: { kinds: { bills: false }, muted: [] } })).status).toBe(404);

    ok(await t.ben.send('POST', `/push/devices/${phone}`, { prefs: { kinds: { bills: false }, muted: [t.groupId] } }));
    expect(ok(await t.ben.get('/push/devices')).body.devices.find((d: { id: string }) => d.id === phone).prefs).toEqual({ kinds: { bills: false }, muted: [t.groupId] });
    ok(await t.ben.send('POST', `/push/devices/${laptop}/delete`, {}));
    expect(ok(await t.ben.get('/push/devices')).body.devices).toHaveLength(1);
  });

  it('checks what it is given, and a phone signed into another account moves to that account', async () => {
    const t = await setup();
    expect((await t.ben.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'web', token: ENDPOINT('no-keys') })).status).toBe(400);
    expect((await t.ben.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'web', token: 'http://insecure.example/x', keys: KEYS })).status).toBe(400);
    expect((await t.ben.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'expo', token: 'not-an-expo-token' })).status).toBe(400);

    ok(await t.ben.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'expo', token: 'ExponentPushToken[shared-phone]' }), 201);
    ok(await t.asha.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'expo', token: 'ExponentPushToken[shared-phone]' }), 201);
    expect(ok(await t.ben.get('/push/devices')).body.devices).toEqual([]);
    expect(ok(await t.asha.get('/push/devices')).body.devices).toHaveLength(1);
  });
});

describe('push: sending', () => {
  it('tells the right people, never the one who did it, and gathers new bills for two minutes', async () => {
    const t = await setup();
    const f = fakeSender();
    await f.sender.tick(); // read past everything so far
    ok(await t.ben.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'expo', token: 'ExponentPushToken[ben]' }), 201);
    ok(await t.ben.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'web', token: ENDPOINT('ben'), keys: KEYS }), 201);
    ok(await t.asha.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'expo', token: 'ExponentPushToken[asha]' }), 201);

    ok(await t.expense('Hotel'), 201);
    ok(await t.expense('Dinner'), 201);
    await f.sender.tick();
    // Gathered, not sent yet.
    expect(f.expo).toEqual([]);
    expect(f.sender.waiting()).toBe(1);
    f.later(121_000);
    await f.sender.tick();
    expect(f.expo).toEqual([expect.objectContaining({ to: 'ExponentPushToken[ben]', title: 'Goa Trip', body: '2 new or changed bills, from Asha', data: expect.objectContaining({ url: `/group/${t.groupId}` }) })]);
    expect(f.web).toEqual([{ endpoint: ENDPOINT('ben'), payload: expect.objectContaining({ title: 'Goa Trip', body: '2 new or changed bills, from Asha' }) }]);

    // Things to act on go at once: Ben says he paid Asha.
    ok(await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: t.a, amount: '50000', method: 'upi' }), 201);
    await f.sender.tick();
    expect(f.expo.at(-1)).toMatchObject({ to: 'ExponentPushToken[asha]', title: 'Goa Trip', body: 'Ben says they paid you. Check and confirm', data: { url: `/group/${t.groupId}/with/${t.b}` } });
    // No amounts on a lock screen.
    for (const text of [...f.expo, ...f.web.map((w) => w.payload)].flatMap((m) => [m.title, m.body])) expect(text).not.toMatch(/₹|\d[\d,]{2,}/);

    // A settle-up message reaches the other person, and opens the chat with the sender.
    ok(await t.asha.send('POST', `/groups/${t.groupId}/pairs/${t.b}/messages`, { body: 'Got it, thanks' }), 201);
    await f.sender.tick();
    f.later(121_000);
    await f.sender.tick();
    expect(f.expo.at(-1)).toMatchObject({ to: 'ExponentPushToken[ben]', body: 'Asha sent you a message', data: { url: `/group/${t.groupId}/with/${t.a}` } });

    // Nothing new: nothing sent, and nothing is sent twice.
    const before = f.expo.length;
    expect(await f.sender.tick()).toEqual({ events: 0, sent: 0 });
    expect(f.expo.length).toBe(before);
  });

  it('respects muted groups and kinds switched off', async () => {
    const t = await setup();
    const f = fakeSender();
    await f.sender.tick();
    const phone = crypto.randomUUID();
    ok(await t.asha.send('POST', '/push/devices', { id: phone, kind: 'expo', token: 'ExponentPushToken[asha-muted]', prefs: { kinds: {}, muted: [t.groupId] } }), 201);
    ok(await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: t.a, amount: '50000', method: 'upi' }), 201);
    await f.sender.tick();
    expect(f.expo).toEqual([]);

    ok(await t.asha.send('POST', `/push/devices/${phone}`, { prefs: { kinds: { payments: false }, muted: [] } }));
    ok(await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: t.a, amount: '10000', method: 'cash' }), 201);
    await f.sender.tick();
    expect(f.expo).toEqual([]);
  });

  it('forgets phones and browsers the push services say are gone', async () => {
    const t = await setup();
    const f = fakeSender({ expoError: 'DeviceNotRegistered', webStatus: 410 });
    await f.sender.tick();
    ok(await t.asha.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'expo', token: 'ExponentPushToken[old-phone]' }), 201);
    ok(await t.asha.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'web', token: ENDPOINT('old-browser'), keys: KEYS }), 201);
    ok(await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: t.a, amount: '50000', method: 'upi' }), 201);
    await f.sender.tick();
    expect(ok(await t.asha.get('/push/devices')).body.devices).toEqual([]);
  });
});

describe('push: delivery problems', () => {
  it('logs notifications Google refused after Expo took them', async () => {
    const t = await setup();
    const f = fakeSender({ receiptError: 'InvalidCredentials' });
    await f.sender.tick();
    ok(await t.asha.send('POST', '/push/devices', { id: crypto.randomUUID(), kind: 'expo', token: 'ExponentPushToken[refused]' }), 201);
    ok(await t.ben.send('POST', `/groups/${t.groupId}/settlements`, { from: t.b, to: t.a, amount: '50000', method: 'upi' }), 201);
    await f.sender.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(f.warnings).toContainEqual(expect.objectContaining({ error: 'InvalidCredentials', stage: 'receipt' }));
  });
});

describe('push: what each change says', () => {
  const ev = (over: Partial<PushEvent>): PushEvent => ({
    id: 'e', type: 'expense.created', groupId: 'g', groupName: 'Flat 302', actorName: 'Riya', actorUser: 'u-riya', entityId: 'x', expenseId: 'x', expenseTitle: 'Wi-Fi',
    payload: {}, owners: ['u-riya'], people: ['u-riya', 'u-sam', 'u-dev'], author: null, pair: null, pairWith: null, from: null, to: null, ...over,
  });

  it('names who did what, to the people it concerns', () => {
    expect(notesFor(ev({})).map((n) => [n.user, n.body])).toEqual([['u-sam', 'Riya added Wi-Fi'], ['u-dev', 'Riya added Wi-Fi']]);
    expect(notesFor(ev({ type: 'expense.edited', payload: { material: false } }))).toEqual([]);
    expect(notesFor(ev({ type: 'suggestion.created', actorName: 'Sam', actorUser: 'u-sam' })).map((n) => [n.user, n.kind, n.body])).toEqual([['u-riya', 'needs', 'Sam suggested a change to Wi-Fi']]);
    expect(notesFor(ev({ type: 'message.question', actorName: 'Dev', actorUser: 'u-dev' }))[0]!.body).toBe('Dev asked about Wi-Fi');
    expect(notesFor(ev({ type: 'message.text', actorName: 'Dev', actorUser: 'u-dev' })).every((n) => n.kind === 'chat')).toBe(true);
    expect(notesFor(ev({ type: 'group.updated' }))).toEqual([]);
    // Settle-up messages go straight away, not gathered like bills.
    const dm = notesFor(ev({ type: 'message.pair', pair: ['u-riya', 'u-sam'], pairWith: { 'u-sam': 'm-riya' } }));
    expect(dm.map((n) => [n.user, n.kind, n.url, n.batch])).toEqual([['u-sam', 'direct', '/group/g/with/m-riya', undefined]]);
  });

  it('chat on bills is off unless switched on; muting a group silences everything in it', () => {
    expect(wants({}, { kind: 'chat', groupId: 'g' })).toBe(false);
    expect(wants({ kinds: { chat: true } }, { kind: 'chat', groupId: 'g' })).toBe(true);
    expect(wants({}, { kind: 'needs', groupId: 'g' })).toBe(true);
    expect(wants({ muted: ['00000000-0000-4000-8000-000000000000'] }, { kind: 'needs', groupId: '00000000-0000-4000-8000-000000000000' })).toBe(false);
    // Settings from a newer app with a kind this server doesn't know: still read.
    expect(wants({ kinds: { needs: false, someday: true } }, { kind: 'needs', groupId: 'g' })).toBe(false);
  });

  it('a gathered summary names up to two people', () => {
    const n = notesFor(ev({}))[0]!;
    expect(summarize([n, { ...n, actor: 'Sam' }, { ...n, actor: 'Dev' }]).body).toBe('3 new or changed bills, from Riya, Sam and others');
    expect(summarize([n]).body).toBe('Riya added Wi-Fi');
  });
});
