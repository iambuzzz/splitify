import { createHash, randomBytes } from 'node:crypto';
import { simplifyDebts } from '@app/ledger';
import type { Role } from '@app/workflow';
import type { Router } from '../app';
import { type GroupRow, type Membership, activeMember, group, isAdmin, membership, recordEvent } from '../context';
import type { Tx } from '../db';
import { ApiError, notFound } from '../errors';
import { uuidv7 } from '../ids';
import * as s from '../schemas';
import { reevaluateReviews } from './expenses';

interface MemberRow {
  id: string;
  display_name: string;
  role: Role;
  status: 'active' | 'left' | 'removed';
  linked: boolean;
  is_me: boolean;
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest();

export function groupRoutes(r: Router) {
  r.get('/me', async ({ tx, userId }) => {
    const p = await tx.query<{ display_name: string }>('select display_name from app.profiles where user_id = $1', [userId]);
    return { userId, displayName: p.rows[0]?.display_name ?? null };
  });

  r.mutate('PUT', '/me', s.profile, async ({ tx, userId, body }) => {
    await tx.query(
      `insert into app.profiles (user_id, display_name) values ($1, $2)
       on conflict (user_id) do update set display_name = excluded.display_name`,
      [userId, body.displayName],
    );
    return { userId, displayName: body.displayName };
  });

  r.get('/groups', async ({ tx }) => {
    const rows = await tx.query<GroupRow & { member_id: string; role: Role; status: string; member_count: number; balance: string }>(
      `select g.*, m.id as member_id, m.role, m.status,
              (select count(*)::int from app.members x where x.group_id = g.id and x.status = 'active') as member_count,
              coalesce((select sum(le.amount_minor) from app.ledger_entries le
                         where le.group_id = g.id and le.member_id = m.id), 0)::text as balance
         from app.groups g
         join app.members m on m.group_id = g.id and m.user_id = app.current_user_id()
        order by g.created_at desc`,
    );
    return {
      groups: rows.rows.map((row) => ({
        ...group(row),
        me: { memberId: row.member_id, role: row.role, status: row.status },
        memberCount: row.member_count,
        myBalance: row.balance,
      })),
    };
  });

  r.mutate(
    'POST',
    '/groups',
    s.createGroup,
    async ({ tx, userId, body }) => {
      const displayName = body.displayName ?? (await profileName(tx, userId));
      const groupId = body.id ?? uuidv7();
      await tx.query('select app.create_group($1, $2, $3, $4, $5, $6)', [
        groupId,
        body.name,
        body.kind,
        body.currency,
        body.memberId ?? uuidv7(),
        displayName,
      ]);
      const seen = new Set([displayName.toLowerCase()]);
      for (const name of body.placeholders) {
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        await tx.query('insert into app.members (id, group_id, display_name) values ($1, $2, $3)', [uuidv7(), groupId, name]);
      }
      const m = await membership(tx, groupId);
      await recordEvent(tx, { groupId, actor: m.memberId, entityType: 'group', entityId: groupId, type: 'group.created' });
      return groupDetail(tx, m);
    },
    201,
  );

  r.get('/groups/:groupId', async ({ tx, params }) => groupDetail(tx, await membership(tx, params.groupId!)));

  r.mutate('PATCH', '/groups/:groupId', s.updateGroup, async ({ tx, params, body }) => {
    const m = await activeMember(tx, params.groupId!);
    if (!isAdmin(m)) throw new ApiError(403, 'forbidden', 'Only the group owner or an admin can change group settings');
    await tx.query(
      `update app.groups set
         name = coalesce($2, name),
         kind = coalesce($3, kind),
         review_threshold_minor = case when $4::boolean then $5::bigint else review_threshold_minor end,
         review_required = coalesce($6, review_required),
         archived_at = case when $7::boolean is null then archived_at when $7 then coalesce(archived_at, now()) else null end
       where id = $1`,
      [
        m.group.id,
        body.name ?? null,
        body.kind ?? null,
        body.reviewThreshold !== undefined,
        body.reviewThreshold ?? null,
        body.reviewRequired ?? null,
        body.archived ?? null,
      ],
    );
    await recordEvent(tx, { groupId: m.group.id, actor: m.memberId, entityType: 'group', entityId: m.group.id, type: 'group.updated', payload: body });
    return groupDetail(tx, await membership(tx, m.group.id));
  });

  // ---------- members ----------

  r.mutate(
    'POST',
    '/groups/:groupId/members',
    s.addMember,
    async ({ tx, params, body }) => {
      const m = await activeMember(tx, params.groupId!);
      const id = body.id ?? uuidv7();
      await tx.query('insert into app.members (id, group_id, display_name) values ($1, $2, $3)', [id, m.group.id, body.displayName]);
      await recordEvent(tx, { groupId: m.group.id, actor: m.memberId, entityType: 'member', entityId: id, type: 'member.added', payload: { displayName: body.displayName } });
      return groupDetail(tx, m);
    },
    201,
  );

  r.mutate('PATCH', '/groups/:groupId/members/:memberId', s.updateMember, async ({ tx, params, body }) => {
    const m = await activeMember(tx, params.groupId!);
    const target = await member(tx, m, params.memberId!);
    if (target.status !== 'active') throw new ApiError(409, 'invalid_state', 'This person is no longer in the group');
    if (body.displayName !== undefined && !(target.is_me || isAdmin(m) || !target.linked)) {
      throw new ApiError(403, 'forbidden', 'Only they or an admin can rename someone who has joined');
    }
    if (body.role !== undefined) {
      if (m.role !== 'owner') throw new ApiError(403, 'forbidden', 'Only the group owner can make or remove admins');
      if (target.is_me || target.role === 'owner') throw new ApiError(409, 'invalid_state', 'The owner role cannot be changed here');
      if (!target.linked) throw new ApiError(422, 'not_joined', 'Only someone who has joined can be an admin');
    }
    await tx.query(
      'update app.members set display_name = coalesce($2, display_name), role = coalesce($3::app.group_role, role) where id = $1',
      [target.id, body.displayName ?? null, body.role ?? null],
    );
    await recordEvent(tx, { groupId: m.group.id, actor: m.memberId, entityType: 'member', entityId: target.id, type: 'member.updated', payload: body });
    return groupDetail(tx, m);
  });

  r.mutate('POST', '/groups/:groupId/members/:memberId/remove', s.leave, async ({ tx, params, body }) => {
    const m = await activeMember(tx, params.groupId!);
    if (!isAdmin(m)) throw new ApiError(403, 'forbidden', 'Only the group owner or an admin can remove people');
    const target = await member(tx, m, params.memberId!);
    if (target.is_me) throw new ApiError(409, 'invalid_state', 'Use leave to leave the group yourself');
    if (target.role === 'owner') throw new ApiError(403, 'forbidden', 'The group owner cannot be removed');
    await endMembership(tx, m, target, 'removed', body.acknowledgeBalance);
    return groupDetail(tx, m);
  });

  r.mutate('POST', '/groups/:groupId/leave', s.leave, async ({ tx, params, body }) => {
    const m = await activeMember(tx, params.groupId!);
    const me = await member(tx, m, m.memberId);
    if (m.role === 'owner') {
      const others = await tx.query(
        `select 1 from app.members where group_id = $1 and status = 'active' and user_id is not null and id <> $2 limit 1`,
        [m.group.id, m.memberId],
      );
      if (others.rows.length > 0) {
        throw new ApiError(409, 'owner_must_stay', 'The owner cannot leave while others are in the group');
      }
    }
    await endMembership(tx, m, me, 'left', body.acknowledgeBalance);
    return { left: true, groupId: m.group.id };
  });

  // ---------- invites ----------

  r.get('/groups/:groupId/invites', async ({ tx, params }) => {
    const m = await activeMember(tx, params.groupId!);
    const rows = await tx.query<{ id: string; created_by: string; expires_at: Date; max_uses: number | null; uses: number; created_at: Date }>(
      `select id, created_by, expires_at, max_uses, uses, created_at from app.invites
        where group_id = $1 and revoked_at is null and expires_at > now() and (max_uses is null or uses < max_uses)
        order by created_at desc`,
      [m.group.id],
    );
    return {
      invites: rows.rows.map((i) => ({
        id: i.id,
        createdBy: i.created_by,
        expiresAt: i.expires_at,
        maxUses: i.max_uses,
        uses: i.uses,
        createdAt: i.created_at,
      })),
    };
  });

  r.mutate(
    'POST',
    '/groups/:groupId/invites',
    s.createInvite,
    async ({ tx, params, body }) => {
      const m = await activeMember(tx, params.groupId!);
      // The token goes into the link; only its hash is stored, so the database cannot leak working links.
      const token = randomBytes(32).toString('base64url');
      const id = uuidv7();
      const r = await tx.query<{ expires_at: Date }>(
        `insert into app.invites (id, group_id, token_hash, created_by, expires_at, max_uses)
         values ($1, $2, $3, $4, now() + make_interval(days => $5), $6) returning expires_at`,
        [id, m.group.id, tokenHash(token), m.memberId, body.expiresInDays, body.maxUses ?? null],
      );
      await recordEvent(tx, { groupId: m.group.id, actor: m.memberId, entityType: 'invite', entityId: id, type: 'invite.created' });
      return { id, token, expiresAt: r.rows[0]!.expires_at, maxUses: body.maxUses ?? null };
    },
    201,
  );

  r.mutate('POST', '/groups/:groupId/invites/:inviteId/revoke', s.empty, async ({ tx, params }) => {
    const m = await activeMember(tx, params.groupId!);
    const r = await tx.query(
      `update app.invites set revoked_at = now()
        where id = $1 and group_id = $2 and revoked_at is null and (created_by = $3 or $4)
       returning id`,
      [params.inviteId, m.group.id, m.memberId, isAdmin(m)],
    );
    if (r.rows.length === 0) throw notFound('Invite not found');
    await recordEvent(tx, { groupId: m.group.id, actor: m.memberId, entityType: 'invite', entityId: params.inviteId!, type: 'invite.revoked' });
    return { revoked: true };
  });

  // The token travels in the body, not the URL, so it never lands in request logs.
  r.read('/invites/preview', s.inviteToken, async ({ tx, body }) => {
    const r = await tx.query<{ group_id: string; group_name: string; kind: string; member_count: number; placeholders: unknown }>(
      'select * from app.invite_preview($1)',
      [tokenHash(body.token)],
    );
    const row = r.rows[0];
    if (!row) throw new ApiError(404, 'invite_invalid', 'This invite link is not valid any more');
    return { groupId: row.group_id, name: row.group_name, kind: row.kind, memberCount: row.member_count, placeholders: row.placeholders };
  });

  r.mutate('POST', '/invites/accept', s.acceptInvite, async ({ tx, userId, body }) => {
    const displayName = body.claimMemberId ? null : (body.displayName ?? (await profileName(tx, userId)));
    const r = await tx
      .query<{ member_id: string }>('select app.accept_invite($1, $2, $3) as member_id', [tokenHash(body.token), body.claimMemberId ?? null, displayName])
      .catch((err: unknown) => {
        // Names are unique among a group's current members: say which way out there is.
        if ((err as { code?: string }).code !== '23505') throw err;
        throw body.claimMemberId
          ? new ApiError(409, 'name_claimed', 'Someone else already joined with that name. Pick another one, or join as new.')
          : new ApiError(409, 'name_taken', `Someone in this group is already called ${displayName}. If that’s you, pick your name; if not, join with a different name.`, {
              displayName,
            });
      });
    const memberId = r.rows[0]!.member_id;
    const g = await tx.query<{ group_id: string }>('select group_id from app.members where id = $1', [memberId]);
    const m = await membership(tx, g.rows[0]!.group_id);
    await recordEvent(tx, { groupId: m.group.id, actor: memberId, entityType: 'member', entityId: memberId, type: 'member.joined', payload: { claimed: Boolean(body.claimMemberId) } });
    return groupDetail(tx, m);
  });
}

async function profileName(tx: Tx, userId: string): Promise<string> {
  const p = await tx.query<{ display_name: string }>('select display_name from app.profiles where user_id = $1', [userId]);
  const name = p.rows[0]?.display_name;
  if (!name) throw new ApiError(422, 'display_name_required', 'Tell us your name first');
  return name;
}

async function member(tx: Tx, m: Membership, memberId: string): Promise<MemberRow> {
  const r = await tx.query<MemberRow>(
    `select id, display_name, role, status, user_id is not null as linked, user_id = app.current_user_id() as is_me
       from app.members where id = $1 and group_id = $2`,
    [memberId, m.group.id],
  );
  const row = r.rows[0];
  if (!row) throw notFound('Member not found');
  return { ...row, is_me: row.is_me === true };
}

/**
 * Leaving or removal. Someone who still owes or is owed money can go only when that is
 * acknowledged; their balance stays in the group and they keep a read-only view of it (I11).
 */
async function endMembership(tx: Tx, m: Membership, target: MemberRow, status: 'left' | 'removed', acknowledged: boolean) {
  if (target.status !== 'active') throw new ApiError(409, 'invalid_state', 'This person is no longer in the group');
  const b = await tx.query<{ balance: string }>(
    'select coalesce(sum(amount_minor), 0)::text as balance from app.ledger_entries where group_id = $1 and member_id = $2',
    [m.group.id, target.id],
  );
  const balance = b.rows[0]!.balance;
  if (balance !== '0' && !acknowledged) {
    throw new ApiError(409, 'balance_not_zero', 'This person still owes or is owed money. Confirm to continue', { balance });
  }
  // Reviews waiting on this person may now have enough OKs.
  await reevaluateReviews(tx, m, target.id);
  // Recorded first: once someone has left, they can no longer write to the group's activity.
  await recordEvent(tx, {
    groupId: m.group.id,
    actor: m.memberId,
    entityType: 'member',
    entityId: target.id,
    type: status === 'left' ? 'member.left' : 'member.removed',
    payload: { balance },
  });
  await tx.query('update app.members set status = $2, left_at = now() where id = $1', [target.id, status]);
}

export async function groupDetail(tx: Tx, m: Membership) {
  const members = await tx.query<MemberRow>(
    `select id, display_name, role, status, user_id is not null as linked, user_id = app.current_user_id() as is_me
       from app.members where group_id = $1 order by joined_at, display_name`,
    [m.group.id],
  );
  const balances = await tx.query<{ member_id: string; balance_minor: string }>(
    'select member_id, balance_minor from app.member_balances where group_id = $1 and balance_minor <> 0 order by member_id',
    [m.group.id],
  );
  const list = balances.rows.map((b) => ({ memberId: b.member_id, amount: BigInt(b.balance_minor) }));
  return {
    group: group(m.group),
    me: { memberId: m.memberId, role: m.role, status: m.status },
    members: members.rows.map((x) => ({
      id: x.id,
      displayName: x.display_name,
      role: x.role,
      status: x.status,
      joined: x.linked,
      isMe: x.is_me === true,
    })),
    balances: list.map((b) => ({ memberId: b.memberId, amount: b.amount.toString() })),
    // Former members see only their own balance, so a payment plan is shown to current members only.
    transfers:
      m.status === 'active'
        ? simplifyDebts(list).map((t) => ({ from: t.from, to: t.to, amount: t.amount.toString() }))
        : [],
  };
}
