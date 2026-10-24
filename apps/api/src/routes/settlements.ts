import { type SettlementAction, type SettlementState, type SettlementStatus, recordSettlement, transitionSettlement } from '@app/workflow';
import type { Router } from '../app';
import { isAdmin, membership, recordEvent, requireNotClosed } from '../context';
import type { Tx } from '../db';
import { ApiError, notFound, workflowError } from '../errors';
import { uuidv7 } from '../ids';
import * as s from '../schemas';

interface SettlementRow {
  id: string;
  group_id: string;
  from_member: string;
  to_member: string;
  amount_minor: string;
  method: string;
  status: SettlementStatus;
  recorded_by: string;
  note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  decline_reason: string | null;
  created_at: Date;
}

export function settlementRoutes(r: Router) {
  r.get('/groups/:groupId/settlements', async ({ tx, params }) => {
    await membership(tx, params.groupId!);
    return { settlements: await listSettlements(tx, params.groupId!) };
  });

  r.mutate(
    'POST',
    '/groups/:groupId/settlements',
    s.recordSettlement,
    async ({ tx, params, body }) => {
      // Settling up is allowed after leaving: the payer and the receiver may be former members.
      // recordSettlement requires the recorder to be one of the two; the (group_id, member)
      // foreign keys require both to be in this group (422 invalid_reference otherwise).
      const m = await membership(tx, params.groupId!);
      await requireNotClosed(tx, m);
      const res = recordSettlement({ from: body.from, to: body.to, amount: BigInt(body.amount) }, m.actor);
      if (!res.ok) throw workflowError(res.error);

      const id = body.id ?? uuidv7();
      await tx.query(
        `insert into app.settlements (id, group_id, from_member, to_member, amount_minor, method, status, recorded_by, note, decided_by, decided_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          m.group.id,
          body.from,
          body.to,
          body.amount,
          body.method,
          res.state.status,
          m.memberId,
          body.note || null,
          res.state.status === 'confirmed' ? m.memberId : null,
          res.state.status === 'confirmed' ? new Date() : null,
        ],
      );
      await recordEvent(tx, {
        groupId: m.group.id,
        actor: m.memberId,
        entityType: 'settlement',
        entityId: id,
        type: 'settlement.recorded',
        payload: { from: body.from, to: body.to, amount: body.amount, status: res.state.status },
      });
      return settlement(await loadRow(tx, id));
    },
    201,
  );

  const action = <S extends import('zod').ZodType>(path: string, schema: S, toAction: (body: import('zod').output<S>) => SettlementAction) =>
    r.mutate('POST', `/settlements/:settlementId/${path}`, schema, async ({ tx, params, body }) =>
      runAction(tx, params.settlementId!, toAction(body)),
    );

  action('confirm', s.empty, () => ({ type: 'confirm' }));
  action('decline', s.withReason, (b) => ({ type: 'decline', reason: b.reason }));
  action('withdraw', s.empty, () => ({ type: 'withdraw' }));
  action('void', s.withReason, (b) => ({ type: 'void', reason: b.reason }));
}

/** Newest first. RLS narrows a former member to the payments they were part of (I11). */
export async function listSettlements(tx: Tx, groupId: string) {
  const rows = await tx.query<SettlementRow>('select * from app.settlements where group_id = $1 order by created_at desc limit 500', [groupId]);
  return rows.rows.map(settlement);
}

async function runAction(tx: Tx, id: string, action: SettlementAction) {
  const row = await loadRow(tx, id, true);
  // Former members may act on their own payments (the state machine allows only the two people in it).
  const m = await membership(tx, row.group_id);
  await requireNotClosed(tx, m);
  // Someone who hasn't joined (a name a friend added) can't confirm a payment to them; the group's
  // owner or an admin answers for them (and can undo it). decided_by keeps who actually did it.
  const forPlaceholder = action.type !== 'withdraw' && m.memberId !== row.to_member && m.status === 'active' && isAdmin(m) && !(await joined(tx, row.to_member));
  const actor = forPlaceholder ? { ...m.actor, memberId: row.to_member } : m.actor;
  const res = transitionSettlement(toState(row), action, actor);
  if (!res.ok) throw workflowError(res.error);
  if (res.duplicate) return settlement(row);

  // The ledger follows the status through a deferred trigger (app.sync_settlement_ledger).
  await tx.query(
    `update app.settlements set status = $2, decided_by = $3, decided_at = now(), decline_reason = $4 where id = $1`,
    [id, res.state.status, m.memberId, 'reason' in action ? action.reason : null],
  );
  await recordEvent(tx, {
    groupId: row.group_id,
    actor: m.memberId,
    entityType: 'settlement',
    entityId: id,
    type: `settlement.${res.state.status}`,
    payload: { amount: row.amount_minor, from: row.from_member, to: row.to_member, ...(forPlaceholder ? { onBehalfOf: row.to_member } : {}) },
  });
  return settlement(await loadRow(tx, id));
}

async function joined(tx: Tx, memberId: string): Promise<boolean> {
  const r = await tx.query<{ linked: boolean }>('select user_id is not null as linked from app.members where id = $1', [memberId]);
  return r.rows[0]?.linked ?? true;
}

async function loadRow(tx: Tx, id: string, lock = false): Promise<SettlementRow> {
  const r = await tx.query<SettlementRow>(`select * from app.settlements where id = $1${lock ? ' for update' : ''}`, [id]);
  const row = r.rows[0];
  if (!row) throw notFound('Payment not found');
  return row;
}

function toState(row: SettlementRow): SettlementState {
  return { status: row.status, from: row.from_member, to: row.to_member, amount: BigInt(row.amount_minor), recordedBy: row.recorded_by };
}

function settlement(row: SettlementRow) {
  return {
    id: row.id,
    groupId: row.group_id,
    from: row.from_member,
    to: row.to_member,
    amount: row.amount_minor,
    method: row.method,
    status: row.status,
    counted: row.status === 'confirmed',
    recordedBy: row.recorded_by,
    note: row.note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    declineReason: row.decline_reason,
    createdAt: row.created_at,
  };
}
