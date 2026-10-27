import type { Router } from '../app';
import { membership, recordEvent, requireNotClosed } from '../context';
import type { Tx } from '../db';
import { ApiError } from '../errors';
import { uuidv7 } from '../ids';
import * as s from '../schemas';

interface MessageRow {
  id: string;
  author_id: string;
  pair_a: string;
  pair_b: string;
  body: string;
  deleted_at: Date | null;
  created_at: Date;
}

export function conversationRoutes(r: Router) {
  // ---------- private thread between two members, about settling up ----------

  r.get('/groups/:groupId/pairs/:memberId', async ({ tx, params }) => {
    const m = await membership(tx, params.groupId!);
    const [a, b] = pairOf(m.memberId, params.memberId!);
    return pairThread(tx, m.group.id, a, b);
  });

  r.mutate(
    'POST',
    '/groups/:groupId/pairs/:memberId/messages',
    s.pairMessage,
    async ({ tx, params, body }) => {
      // Either person may have left the group: settling up continues after leaving.
      const m = await membership(tx, params.groupId!);
      await requireNotClosed(tx, m);
      const [a, b] = pairOf(m.memberId, params.memberId!);
      const msgId = body.id ?? uuidv7();
      await tx.query(
        `insert into app.messages (id, group_id, author_id, kind, body, pair_a, pair_b) values ($1, $2, $3, 'text', $4, $5, $6)`,
        [msgId, m.group.id, m.memberId, body.body, a, b],
      );
      // For the other person's notification; the text itself stays out of the activity log.
      await recordEvent(tx, { groupId: m.group.id, actor: m.memberId, entityType: 'message', entityId: msgId, type: 'message.pair' });
      return pairThread(tx, m.group.id, a, b);
    },
    201,
  );

  // ---------- seen (money items only) ----------

  r.mutate('POST', '/seen', s.seen, async ({ tx, body }) => {
    for (const item of body.items) {
      const m = await membership(tx, item.groupId);
      if (!(await visible(tx, item))) continue; // never record "seen" for what this person cannot see
      // Repeated views within a few seconds don't count as news for anyone else.
      await tx.query(
        `insert into app.seen (member_id, group_id, entity_type, entity_id, version) values ($1, $2, $3, $4, $5)
         on conflict (member_id, entity_type, entity_id) do update set version = excluded.version, seen_at = now()
          where app.seen.version is distinct from excluded.version or app.seen.seen_at < now() - interval '5 seconds'`,
        [m.memberId, m.group.id, item.type, item.id, item.version ?? null],
      );
    }
    return { ok: true };
  });

  // ---------- live updates ----------

  /**
   * One cheap call the app repeats every few seconds while it is open: a token per group that
   * changes whenever anything this person can see changes there. The app then reloads only those
   * groups. (A push channel can replace the polling later; this stays as its fallback.)
   */
  r.get('/pulse', async ({ tx }) => {
    const rows = await tx.query<{ id: string; e: string | null; s: Date | null; m: Date | null; v: number }>(
      `select g.id,
              (select max(a.id::text) from app.activity_events a where a.group_id = g.id) as e,
              (select max(x.seen_at) from app.seen x where x.group_id = g.id) as s,
              (select max(x.created_at) from app.messages x where x.group_id = g.id) as m,
              (select count(*)::int from app.members x where x.group_id = g.id) as v
         from app.groups g
        where exists (select 1 from app.members me where me.group_id = g.id and me.user_id = app.current_user_id())`,
    );
    return {
      groups: Object.fromEntries(rows.rows.map((x) => [x.id, [x.e ?? '', x.s?.toISOString() ?? '', x.m?.toISOString() ?? '', x.v].join('|')])),
    };
  });
}

const pairOf = (me: string, other: string): [string, string] => {
  if (me === other) throw new ApiError(422, 'invalid_reference', 'Pick someone other than yourself');
  return me < other ? [me, other] : [other, me];
};

/** The (group_id, pair) foreign keys reject a member from elsewhere when writing (422). */
async function pairThread(tx: Tx, groupId: string, a: string, b: string) {
  const messages = await tx.query<MessageRow>(
    `select id, author_id, pair_a, pair_b, case when deleted_at is null then body else '' end as body, deleted_at, created_at
       from app.messages where group_id = $1 and pair_a = $2 and pair_b = $3 order by created_at, id limit 500`,
    [groupId, a, b],
  );
  const seen = await tx.query<{ member_id: string; seen_at: Date }>(
    `select member_id, seen_at from app.seen where entity_type = 'pair' and group_id = $1
       and ((member_id = $2 and entity_id = $3) or (member_id = $3 and entity_id = $2))`,
    [groupId, a, b],
  );
  return {
    members: [a, b],
    messages: messages.rows.map(pairMessage),
    seen: seen.rows.map((x) => ({ memberId: x.member_id, seenAt: x.seen_at })),
  };
}

export function pairMessage(x: MessageRow) {
  return { id: x.id, authorId: x.author_id, pair: [x.pair_a, x.pair_b], body: x.body, deleted: x.deleted_at !== null, createdAt: x.created_at };
}

/** RLS already hides what this person can't see; a lookup through it tells whether the item is visible. */
async function visible(tx: Tx, item: { groupId: string; type: string; id: string }): Promise<boolean> {
  const sql =
    item.type === 'expense'
      ? `select 1 from app.expenses where id = $1 and group_id = $2 and app.is_in_expense(id)`
      : item.type === 'settlement'
        ? 'select 1 from app.settlements where id = $1 and group_id = $2'
        : 'select 1 from app.members where id = $1 and group_id = $2';
  return (await tx.query(sql, [item.id, item.groupId])).rows.length > 0;
}

/** Pair threads and seen marks in a group that this person may see, for the snapshot. */
export async function conversationSnapshot(tx: Tx, groupId: string) {
  const pairs = await tx.query<MessageRow>(
    `select id, author_id, pair_a, pair_b, case when deleted_at is null then body else '' end as body, deleted_at, created_at
       from app.messages where group_id = $1 and pair_a is not null order by created_at, id limit 2000`,
    [groupId],
  );
  const seen = await tx.query<{ member_id: string; entity_type: string; entity_id: string; version: number | null; seen_at: Date }>(
    'select member_id, entity_type, entity_id, version, seen_at from app.seen where group_id = $1',
    [groupId],
  );
  return {
    pairMessages: pairs.rows.map(pairMessage),
    seen: seen.rows.map((x) => ({ memberId: x.member_id, type: x.entity_type, id: x.entity_id, version: x.version, seenAt: x.seen_at })),
  };
}
