import type { Router } from '../app';
import { membership } from '../context';
import { conversationSnapshot } from './conversation';
import { expenseDetails } from './expenses';
import { groupDetail } from './groups';
import { listSettlements } from './settlements';

/** What this server can do, so the app shows only what works (e.g. adding photos). */
export interface Features {
  receipts: boolean;
}

export function snapshotRoutes(r: Router, features: Features = { receipts: false }) {
  /**
   * Everything one group screen needs, in one call: members, balances, every expense in full,
   * and payments. Fine for alpha-sized groups (up to 500 expenses); the cursor-based sync in M6
   * replaces it.
   */
  r.get('/groups/:groupId/snapshot', async ({ tx, params }) => {
    const m = await membership(tx, params.groupId!);
    const ids = await tx.query<{ id: string }>(
      `select id from app.expenses where group_id = $1 and (status <> 'draft' or created_by = $2)
        order by expense_date desc, created_at desc limit 500`,
      [m.group.id, m.memberId],
    );
    const expenses = await expenseDetails(tx, m, ids.rows.map((x) => x.id));
    return {
      ...(await groupDetail(tx, m)),
      expenses,
      settlements: await listSettlements(tx, m.group.id),
      ...(await conversationSnapshot(tx, m.group.id)),
      features,
    };
  });
}
