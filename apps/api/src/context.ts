import type { Actor, ReviewPolicy, Role } from '@app/workflow';
import type { Tx } from './db';
import { ApiError, notFound } from './errors';
import { uuidv7 } from './ids';

export interface GroupRow {
  id: string;
  name: string;
  kind: string;
  currency: string;
  review_threshold_minor: string | null;
  review_required: number;
  archived_at: Date | null;
  created_at: Date;
}

export interface Membership {
  group: GroupRow;
  memberId: string;
  role: Role;
  status: 'active' | 'left' | 'removed';
  actor: Actor;
}

/** The signed-in user's membership of a group. Not a member, now or before: 404, so ids can't be probed. */
export async function membership(tx: Tx, groupId: string): Promise<Membership> {
  const r = await tx.query<GroupRow & { member_id: string; role: Role; status: Membership['status'] }>(
    `select g.*, m.id as member_id, m.role, m.status
       from app.groups g
       join app.members m on m.group_id = g.id and m.user_id = app.current_user_id()
      where g.id = $1`,
    [groupId],
  );
  const row = r.rows[0];
  if (!row) throw notFound('Group not found');
  const { member_id, role, status, ...group } = row;
  return { group, memberId: member_id, role, status, actor: { memberId: member_id, role } };
}

/** Changes need a current member. Former members keep read access to their own history only. */
export async function activeMember(tx: Tx, groupId: string): Promise<Membership> {
  const m = await membership(tx, groupId);
  if (m.status !== 'active') throw new ApiError(403, 'not_a_member', 'You are no longer a member of this group');
  return m;
}

export function isAdmin(m: Membership): boolean {
  return m.role === 'owner' || m.role === 'admin';
}

/**
 * Where a group is in its life. `archived_at` is when an owner or admin finished it. Finished, it
 * takes no new or changed expenses but payments go on; once nobody owes anything and no payment
 * waits for a confirmation, it is closed (read-only). Closed is worked out from the ledger each
 * time, never stored, so it can't disagree with the balances.
 */
export type GroupPhase = 'open' | 'finishing' | 'closed';

export async function groupPhase(tx: Tx, group: GroupRow): Promise<{ phase: GroupPhase; closedAt: Date | null }> {
  if (group.archived_at === null) return { phase: 'open', closedAt: null };
  const r = await tx.query<{ busy: boolean; last_paid: Date | null }>(
    `select exists (select 1 from app.member_balances where group_id = $1 and balance_minor <> 0)
         or exists (select 1 from app.settlements where group_id = $1 and status = 'awaiting_confirmation') as busy,
            (select max(decided_at) from app.settlements where group_id = $1 and status = 'confirmed') as last_paid`,
    [group.id],
  );
  const { busy, last_paid } = r.rows[0]!;
  if (busy) return { phase: 'finishing', closedAt: null };
  return { phase: 'closed', closedAt: last_paid && last_paid > group.archived_at ? last_paid : group.archived_at };
}

/** Expenses can be added or changed only while the group isn't finished. */
export async function requireOpen(tx: Tx, m: Membership): Promise<void> {
  if (m.group.archived_at === null) return;
  const { phase } = await groupPhase(tx, m.group);
  throw phase === 'closed'
    ? new ApiError(409, 'group_closed', 'This group is closed. An owner or admin can reopen it.')
    : new ApiError(409, 'group_finished', 'This group is finished: only payments now. An owner or admin can reopen it to change expenses.');
}

/** A closed group is read-only. */
export async function requireNotClosed(tx: Tx, m: Membership): Promise<void> {
  if (m.group.archived_at === null) return;
  if ((await groupPhase(tx, m.group)).phase === 'closed') {
    throw new ApiError(409, 'group_closed', 'This group is closed. An owner or admin can reopen it.');
  }
}

export function reviewPolicy(group: GroupRow): ReviewPolicy {
  return group.review_threshold_minor === null
    ? { enabled: false, thresholdMinor: 0n, approvalsRequired: group.review_required }
    : { enabled: true, thresholdMinor: BigInt(group.review_threshold_minor), approvalsRequired: group.review_required };
}

export async function activeMemberIds(tx: Tx, groupId: string): Promise<Set<string>> {
  const r = await tx.query<{ id: string }>(`select id from app.members where group_id = $1 and status = 'active'`, [groupId]);
  return new Set(r.rows.map((x) => x.id));
}

/** Current members who have signed up: only they can give a review OK (a placeholder never could). */
export async function reviewerIds(tx: Tx, groupId: string): Promise<Set<string>> {
  const r = await tx.query<{ id: string }>(
    `select id from app.members where group_id = $1 and status = 'active' and user_id is not null`,
    [groupId],
  );
  return new Set(r.rows.map((x) => x.id));
}

/** Audit trail and notification outbox (written in the same transaction as the change). */
export async function recordEvent(
  tx: Tx,
  e: { groupId: string; actor: string | null; entityType: string; entityId: string; version?: number | null; type: string; payload?: unknown },
): Promise<void> {
  await tx.query(
    `insert into app.activity_events (id, group_id, actor_member_id, entity_type, entity_id, entity_version, type, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [uuidv7(), e.groupId, e.actor, e.entityType, e.entityId, e.version ?? null, e.type, JSON.stringify(e.payload ?? {})],
  );
}

export function group(row: GroupRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    currency: row.currency,
    reviewThreshold: row.review_threshold_minor,
    reviewRequired: row.review_required,
    finishedAt: row.archived_at,
    createdAt: row.created_at,
  };
}
