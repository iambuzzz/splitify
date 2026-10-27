import webpush from 'web-push';
import { z } from 'zod';
import type { Router } from './app';
import type { Db } from './db';
import { ApiError } from './errors';

/**
 * Push notifications (plan §10). Every change writes an activity event in the same transaction
 * (the outbox); a loop in this process reads new events through app.push_take(), decides who hears
 * about each one, and sends to their devices: phones through Expo's push service (Google's FCM
 * underneath), browsers through Web Push. New and changed bills are gathered for two minutes per
 * person and group, so five bills added in a row arrive as one notification.
 *
 * What a lock screen shows is the group, a name and what happened, never an amount.
 */

/** The kinds a person can switch off, per device. */
export const KINDS = ['needs', 'payments', 'direct', 'bills', 'chat'] as const;
export type Kind = (typeof KINDS)[number];
/** On unless switched off; chat on bills is the only one off unless switched on. */
export const DEFAULT_ON: Record<Kind, boolean> = { needs: true, payments: true, direct: true, bills: true, chat: false };

/** One event as app.push_take() hands it over. Users are auth user ids. */
export interface PushEvent {
  id: string;
  type: string;
  groupId: string;
  groupName: string;
  actorName: string | null;
  actorUser: string | null;
  entityId: string;
  expenseId: string | null;
  expenseTitle: string | null;
  payload: Record<string, unknown>;
  owners: string[];
  people: string[];
  author: string | null;
  pair: string[] | null;
  /** For a settle-up message: each person's user id → the other person's member id. */
  pairWith: Record<string, string> | null;
  from: string | null;
  to: string | null;
}

/** One notification for one person, before it's sent to their devices. */
export interface Note {
  user: string;
  kind: Kind;
  groupId: string;
  title: string;
  body: string;
  url: string;
  /** Notes with the same key for the same person are gathered for a while and sent as one. */
  batch?: string;
  /** Who did it, for a gathered summary ("from Riya and Dev"). */
  actor: string;
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];

/** Who should hear about an event, and what they're told. Pure: the tests drive it directly. */
export function notesFor(ev: PushEvent): Note[] {
  const actor = ev.actorName ?? 'Someone';
  const title = ev.expenseTitle ?? 'an expense';
  const g = ev.groupId;
  const expenseUrl = ev.expenseId ? `/group/${g}/expense/${ev.expenseId}` : `/group/${g}`;
  // Never tell people about their own actions.
  const to = (users: (string | null | undefined)[], kind: Kind, body: string, url: string, batch?: string): Note[] =>
    uniq(users)
      .filter((u) => u !== ev.actorUser)
      .map((user) => ({ user, kind, groupId: g, title: ev.groupName, body, url, batch, actor }));
  const p = ev.payload;
  const fromMember = typeof p.from === 'string' ? p.from : null;
  const toMember = typeof p.to === 'string' ? p.to : null;

  switch (ev.type) {
    case 'expense.created':
      return to(ev.people, 'bills', `${actor} added ${title}`, expenseUrl, `bills:${g}`);
    case 'expense.edited':
      // Title, note or category changes don't change anyone's money: no notification.
      return p.material ? to([...ev.people, ...ev.owners], 'bills', `${actor} changed ${title}`, expenseUrl, `bills:${g}`) : [];
    case 'expense.delete':
      return to([...ev.people, ...ev.owners], 'bills', `${actor} deleted ${title}`, expenseUrl, `bills:${g}`);
    case 'expense.restore':
      return to([...ev.people, ...ev.owners], 'bills', `${actor} brought back ${title}`, expenseUrl, `bills:${g}`);
    case 'expense.dispute':
      return to(ev.owners, 'needs', `${actor} says something’s wrong with ${title}`, expenseUrl);
    case 'expense.approve':
      return to(ev.owners, 'needs', `${actor} OK’d ${title}`, expenseUrl);
    case 'expense.decline':
      return to(ev.owners, 'needs', `${actor} sent ${title} back to you`, expenseUrl);
    case 'suggestion.created':
      return to(ev.owners, 'needs', `${actor} suggested a change to ${title}`, expenseUrl);
    case 'suggestion.accepted':
      return to([ev.author], 'needs', `${actor} accepted your change to ${title}`, expenseUrl);
    case 'suggestion.declined':
      return to([ev.author], 'needs', `${actor} kept ${title} as it was`, expenseUrl);
    case 'message.question':
      return to(ev.owners, 'needs', `${actor} asked about ${title}`, expenseUrl);
    case 'message.resolved':
      return to([ev.author], 'needs', `${actor} marked your question on ${title} as answered`, expenseUrl);
    case 'message.text':
      return to([...ev.people, ...ev.owners], 'chat', `${actor} wrote about ${title}`, expenseUrl, `chat:${ev.expenseId}`);
    case 'message.pair':
      return (ev.pair ?? [])
        .filter((u) => u !== ev.actorUser)
        // Sent straight away (a reply is often waited for); a newer message replaces the older one.
        .map((user) => ({ user, kind: 'direct' as const, groupId: g, title: ev.groupName, body: `${actor} sent you a message`, url: `/group/${g}/with/${ev.pairWith?.[user] ?? ''}`, actor }));
    case 'settlement.recorded':
      // Recorded by the payer: the receiver confirms. Recorded by the receiver: it already counts.
      return p.status === 'awaiting_confirmation'
        ? to([ev.to], 'payments', `${actor} says they paid you. Check and confirm`, `/group/${g}/with/${fromMember}`)
        : to([ev.from], 'payments', `${actor} recorded your payment as received`, `/group/${g}/with/${toMember}`);
    case 'settlement.confirmed':
      return to([ev.from], 'payments', `${actor} confirmed your payment`, `/group/${g}/with/${toMember}`);
    case 'settlement.declined':
      return to([ev.from], 'payments', `${actor} says they didn’t get your payment`, `/group/${g}/with/${toMember}`);
    default:
      return [];
  }
}

/** Several gathered notes for one person as one: "3 new or changed bills, from Riya and Dev". */
export function summarize(notes: Note[]): Note {
  const first = notes[0]!;
  if (notes.length === 1) return first;
  const actors = uniq(notes.map((n) => n.actor));
  const by = actors.length <= 2 ? actors.join(' and ') : `${actors.slice(0, 2).join(', ')} and others`;
  const what = first.kind === 'bills' ? `${notes.length} new or changed bills` : first.kind === 'direct' ? `${notes.length} messages` : `${notes.length} messages about a bill`;
  // Several bills: open the group rather than one of them.
  const url = first.kind === 'bills' ? `/group/${first.groupId}` : first.url;
  return { ...first, body: `${what}, from ${by}`, url };
}

/** Device settings, as the app sends them. Unknown kinds are ignored, so older apps keep working. */
export const prefsSchema = z.strictObject({
  kinds: z.record(z.string(), z.boolean()).default({}),
  muted: z.array(z.uuid()).max(500).default([]),
});
export type Prefs = z.output<typeof prefsSchema>;

export function wants(prefs: unknown, note: Pick<Note, 'kind' | 'groupId'>): boolean {
  const p = prefsSchema.safeParse(prefs ?? {});
  const kinds = p.success ? p.data.kinds : {};
  const muted = p.success ? p.data.muted : [];
  if (muted.includes(note.groupId)) return false;
  return kinds[note.kind] ?? DEFAULT_ON[note.kind];
}

// ---------- sending ----------

interface Device {
  id: string;
  user_id: string;
  kind: 'expo' | 'web';
  token: string;
  keys: { p256dh: string; auth: string } | null;
  prefs: unknown;
}

export interface PushConfig {
  db: Db;
  /** Web Push keys (VAPID). Without them only phones get notifications. */
  vapid?: { publicKey: string; privateKey: string; subject: string };
  /** Gather new and changed bills for this long (two minutes). */
  batchMs?: number;
  /** How often to look for new events. */
  everyMs?: number;
  fetch?: typeof fetch;
  sendWeb?: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: webpush.RequestOptions) => Promise<unknown>;
  log?: { info(o: object, msg: string): void; warn(o: object, msg: string): void };
  now?: () => number;
  /** How long after sending to ask Expo whether Google accepted the notifications. */
  receiptDelayMs?: number;
}

/** No user: the sender only calls the push_* functions, which run with their own rights. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** What happened to one notification for one device. */
interface Sent {
  device: string;
  ticket?: string;
  error?: string;
  /** The push service says this device no longer exists: stop sending to it. */
  gone?: boolean;
}

export function pushSender(cfg: PushConfig) {
  const http = cfg.fetch ?? fetch;
  const now = cfg.now ?? Date.now;
  const batchMs = cfg.batchMs ?? 120_000;
  const sendWeb = cfg.sendWeb ?? ((sub, payload, opts) => webpush.sendNotification(sub, payload, opts));
  const webOpts: webpush.RequestOptions | null = cfg.vapid
    ? { vapidDetails: { subject: cfg.vapid.subject, publicKey: cfg.vapid.publicKey, privateKey: cfg.vapid.privateKey }, TTL: 24 * 3600 }
    : null;
  /** Gathered notes, per person and batch key: sent when `due` passes. */
  const waiting = new Map<string, { due: number; notes: Note[] }>();
  const receiptDelayMs = cfg.receiptDelayMs ?? 15_000;

  /** Sends each note to its device. Errors come back per device (Expo's code, or the browser push service's status). */
  async function send(items: { device: Device; note: Note }[]): Promise<Sent[]> {
    const out: Sent[] = [];
    const expo: { device: Device; message: object }[] = [];
    const web: Promise<void>[] = [];
    for (const { device: d, note } of items) {
      // One notification per group and kind replaces the previous one instead of piling up.
      const tag = note.batch ?? `${note.kind}:${note.groupId}`;
      if (d.kind === 'expo') {
        expo.push({ device: d, message: { to: d.token, title: note.title, body: note.body, data: { url: note.url, tag }, sound: 'default', priority: 'high', channelId: 'default' } });
      } else if (!webOpts || !d.keys) {
        out.push({ device: d.id, error: 'web push keys missing on the server' });
      } else {
        const payload = JSON.stringify({ title: note.title, body: note.body, url: note.url, tag });
        web.push(
          sendWeb({ endpoint: d.token, keys: d.keys }, payload, { ...webOpts, urgency: note.kind === 'bills' || note.kind === 'chat' ? 'normal' : 'high' }).then(
            () => void out.push({ device: d.id }),
            (err: { statusCode?: number; message?: string }) => {
              // 404/410: the browser dropped this subscription (notifications blocked, site data cleared).
              const gone = err.statusCode === 404 || err.statusCode === 410;
              out.push({ device: d.id, error: `web push ${err.statusCode ?? err.message ?? 'failed'}`, gone });
            },
          ),
        );
      }
    }
    // Expo takes up to 100 messages per request.
    for (let i = 0; i < expo.length; i += 100) {
      const chunk = expo.slice(i, i + 100);
      try {
        const res = await http(EXPO_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(chunk.map((c) => c.message)) });
        const json = (await res.json().catch(() => null)) as { data?: { status: string; id?: string; message?: string; details?: { error?: string } }[] } | null;
        if (!res.ok || !json?.data) {
          chunk.forEach((c) => out.push({ device: c.device.id, error: `expo ${res.status}` }));
          continue;
        }
        json.data.forEach((t, j) => {
          const device = chunk[j]!.device.id;
          if (t.status === 'ok') out.push({ device, ticket: t.id });
          else out.push({ device, error: t.details?.error ?? t.message ?? 'expo error', gone: t.details?.error === 'DeviceNotRegistered' });
        });
      } catch (err) {
        chunk.forEach((c) => out.push({ device: c.device.id, error: err instanceof Error ? err.message : 'expo unreachable' }));
      }
    }
    await Promise.all(web);
    return out;
  }

  /**
   * Expo accepting a message (a ticket) isn't delivery: Google can still refuse it, for example when
   * the Firebase key is wrong. The receipt says so, a few seconds later.
   */
  async function receipts(sent: Sent[]): Promise<Sent[]> {
    const byTicket = new Map(sent.filter((s) => s.ticket).map((s) => [s.ticket!, s]));
    if (!byTicket.size) return [];
    try {
      const res = await http(EXPO_RECEIPTS_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ids: [...byTicket.keys()] }) });
      const json = (await res.json().catch(() => null)) as { data?: Record<string, { status: string; message?: string; details?: { error?: string } }> } | null;
      return Object.entries(json?.data ?? {})
        .filter(([, r]) => r.status === 'error')
        .map(([ticket, r]) => ({ device: byTicket.get(ticket)!.device, error: r.details?.error ?? r.message ?? 'not delivered', gone: r.details?.error === 'DeviceNotRegistered' }));
    } catch {
      return [];
    }
  }

  const forget = async (failed: Sent[]) => {
    const gone = uniq(failed.filter((f) => f.gone).map((f) => f.device));
    if (gone.length) await cfg.db.asUser(NOBODY, (tx) => tx.query('select app.push_forget($1)', [gone]));
  };
  const report = (failed: Sent[], stage: string) => {
    for (const f of failed) cfg.log?.warn({ device: f.device, error: f.error, stage }, 'notification not delivered');
  };

  async function deliver(notes: Note[]) {
    if (!notes.length) return;
    const devices = await cfg.db.asUser(NOBODY, async (tx) => {
      const r = await tx.query<Device>('select * from app.push_devices_of($1)', [uniq(notes.map((n) => n.user))]);
      return r.rows;
    });
    const items = notes.flatMap((note) => devices.filter((d) => d.user_id === note.user && wants(d.prefs, note)).map((device) => ({ device, note })));
    const sent = await send(items);
    const failed = sent.filter((s) => s.error);
    cfg.log?.info({ notes: notes.length, kinds: uniq(notes.map((n) => n.kind)), devices: items.length, delivered: sent.length - failed.length, failed: failed.length }, 'notifications sent');
    report(failed, 'send');
    await forget(failed);
    if (sent.some((s) => s.ticket)) {
      setTimeout(() => {
        receipts(sent)
          .then(async (late) => {
            report(late, 'receipt');
            await forget(late);
          })
          .catch(() => {});
      }, receiptDelayMs).unref?.();
    }
  }

  /** Reads new events, sends what's due now, and gathers the rest. */
  async function tick() {
    const events = await cfg.db.asUser(NOBODY, async (tx) => {
      const r = await tx.query<{ out: PushEvent[] }>('select app.push_take(200) as out');
      return r.rows[0]?.out ?? [];
    });
    const now_ = now();
    const ready: Note[] = [];
    for (const ev of events) {
      for (const note of notesFor(ev)) {
        if (!note.batch) {
          ready.push(note);
          continue;
        }
        const key = `${note.user}|${note.batch}`;
        const w = waiting.get(key);
        if (w) w.notes.push(note);
        else waiting.set(key, { due: now_ + batchMs, notes: [note] });
      }
    }
    for (const [key, w] of waiting) {
      if (w.due > now_) continue;
      waiting.delete(key);
      ready.push(summarize(w.notes));
    }
    await deliver(ready);
    return { events: events.length, sent: ready.length };
  }

  let timer: NodeJS.Timeout | null = null;
  let busy = false;
  return {
    tick,
    start() {
      timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          await tick();
        } catch (err) {
          cfg.log?.warn({ error: err instanceof Error ? err.message : 'unknown' }, 'push round failed');
        } finally {
          busy = false;
        }
      }, cfg.everyMs ?? 5000);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** How many people have notes gathered and not yet sent (for tests). */
    waiting: () => waiting.size,
  };
}

// ---------- routes: devices turn notifications on and off ----------

const id = z.uuid();
const register = z.strictObject({
  id,
  kind: z.enum(['expo', 'web']),
  token: z.string().min(10).max(1000),
  keys: z.strictObject({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }).optional(),
  label: z.string().trim().max(60).default(''),
  prefs: prefsSchema.default({ kinds: {}, muted: [] }),
});

export function pushRoutes(r: Router, vapidPublicKey: string | undefined) {
  /** What the app needs to subscribe in a browser, and the kinds with their defaults. */
  r.get('/push/config', async () => ({ webPushKey: vapidPublicKey ?? null, kinds: DEFAULT_ON }));

  r.get('/push/devices', async ({ tx }) => {
    const rows = await tx.query<{ id: string; kind: string; label: string; prefs: unknown; created_at: string }>(
      'select id, kind, label, prefs, created_at from app.push_devices order by seen_at desc',
    );
    return { devices: rows.rows.map((d) => ({ id: d.id, kind: d.kind, label: d.label, prefs: d.prefs, createdAt: d.created_at })) };
  });

  r.mutate('POST', '/push/devices', register, async ({ tx, body }) => {
    if (body.kind === 'web' && !body.keys) throw new ApiError(400, 'invalid_request', 'A browser subscription needs its keys');
    if (body.kind === 'web' && !/^https:\/\//.test(body.token)) throw new ApiError(400, 'invalid_request', 'A browser subscription is an https address');
    if (body.kind === 'expo' && !/^Expo(nent)?PushToken\[[^\]]+\]$/.test(body.token)) throw new ApiError(400, 'invalid_request', 'Not an Expo push token');
    const row = await tx.query<{ id: string }>('select app.push_register($1, $2, $3, $4, $5, $6) as id', [
      body.id,
      body.kind,
      body.token,
      body.keys ? JSON.stringify(body.keys) : null,
      body.label,
      JSON.stringify(body.prefs),
    ]);
    return { id: row.rows[0]!.id, prefs: body.prefs };
  }, 201);

  r.mutate('POST', '/push/devices/:deviceId', z.strictObject({ prefs: prefsSchema }), async ({ tx, params, body }) => {
    const row = await tx.query('update app.push_devices set prefs = $2, seen_at = now() where id = $1 returning id', [params.deviceId, JSON.stringify(body.prefs)]);
    if (!row.rows.length) throw new ApiError(404, 'not_found', 'This device has notifications off');
    return { id: params.deviceId, prefs: body.prefs };
  });

  r.mutate('POST', '/push/devices/:deviceId/delete', z.strictObject({}), async ({ tx, params }) => {
    await tx.query('delete from app.push_devices where id = $1', [params.deviceId]);
    return { ok: true };
  });
}
