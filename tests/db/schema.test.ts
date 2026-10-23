import type { PGlite } from '@electric-sql/pglite';
import { type Posting, breakdownExpense, computeBalances, settlementPostings } from '@app/ledger';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addExpense,
  addPlaceholder,
  addUser,
  as,
  balances,
  createGroup,
  editExpense,
  freshDb,
  reconcileDiffs,
  uuid,
} from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

/** A group owned by a new user, with three placeholder friends. */
async function goa() {
  const user = await addUser(db);
  const { group, owner } = await createGroup(db, user);
  const [bilal, chitra, dev] = await as(db, user, async (tx) => [
    await addPlaceholder(tx, group, 'Bilal'),
    await addPlaceholder(tx, group, 'Chitra'),
    await addPlaceholder(tx, group, 'Dev'),
  ]);
  return { user, group, asha: owner, bilal: bilal!, chitra: chitra!, dev: dev! };
}

describe('database: privileges', () => {
  it('the Supabase Data API roles cannot touch the app schema', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.role_table_grants
        where table_schema = 'app' and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );
    expect(r.rows[0]!.n).toBe(0);
    const usage = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_schema_privilege('anon', 'app', 'usage') as anon, has_schema_privilege('authenticated', 'app', 'usage') as auth`,
    );
    expect(usage.rows[0]).toEqual({ anon: false, auth: false });
  });

  it('the API login has no rights of its own; it can only become app_api', async () => {
    const g = await goa();
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role api_login');
        await tx.query('select count(*) from app.groups');
      }),
    ).rejects.toThrow(/permission denied/);
    const n = await db.transaction(async (tx) => {
      await tx.exec('set local role api_login');
      await tx.exec('set local role app_api');
      await tx.query(`select set_config('app.user_id', $1, true)`, [g.user]);
      return (await tx.query<{ n: number }>('select count(*)::int as n from app.groups')).rows[0]!.n;
    });
    expect(n).toBe(1);
  });

  it('no app function is executable by PUBLIC (security definer functions stay private)', async () => {
    const r = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(r.rows).toEqual([]);
  });
});

describe('database: ledger follows the expenses (I1–I5)', () => {
  it('posts an expense, matches @app/ledger balances, and reconciles', async () => {
    const g = await goa();
    const split = { method: 'shares' as const, shares: [
      { memberId: g.asha, shares: '3' }, { memberId: g.bilal, shares: '3' },
      { memberId: g.chitra, shares: '2' }, { memberId: g.dev, shares: '3' },
    ] };
    const e = await as(db, g.user, (tx) =>
      addExpense(tx, g.group, g.asha, { title: 'Hotel', total: 660000n, payers: [{ memberId: g.asha, amount: 660000n }], split }),
    );
    const b = await balances(db, g.group);
    expect(b).toEqual({ [g.asha]: 480000n, [g.bilal]: -180000n, [g.chitra]: -120000n, [g.dev]: -180000n });
    expect(Object.values(b).reduce((x, y) => x + y, 0n)).toBe(0n);
    expect(await reconcileDiffs(db, g.group)).toEqual([]);
    const batches = await db.query('select direction from app.ledger_batches where source_id = $1', [e]);
    expect(batches.rows).toEqual([{ direction: 'post' }]);
  });

  it('an edit reverses the old version and posts the new one; delete and restore follow', async () => {
    const g = await goa();
    const everyone = [g.asha, g.bilal, g.chitra, g.dev];
    const e = await as(db, g.user, (tx) =>
      addExpense(tx, g.group, g.bilal, { title: 'Dinner', total: 240000n, payers: [{ memberId: g.bilal, amount: 240000n }], split: { method: 'equal', members: everyone } }),
    );
    await as(db, g.user, (tx) =>
      editExpense(tx, g.group, e, g.bilal, 2, { title: 'Dinner', total: 200000n, payers: [{ memberId: g.bilal, amount: 200000n }], split: { method: 'equal', members: everyone } }),
    );
    expect(await balances(db, g.group)).toEqual({ [g.bilal]: 150000n, [g.asha]: -50000n, [g.chitra]: -50000n, [g.dev]: -50000n });
    const dirs = await db.query<{ direction: string; source_version: number }>(
      'select direction, source_version from app.ledger_batches where source_id = $1 order by id', [e]);
    expect(dirs.rows).toEqual([
      { direction: 'post', source_version: 1 },
      { direction: 'reverse', source_version: 1 },
      { direction: 'post', source_version: 2 },
    ]);

    await as(db, g.user, (tx) => tx.query(`update app.expenses set status = 'deleted', posted_version = null, restorable_version = 2 where id = $1`, [e]));
    expect(await balances(db, g.group)).toEqual({});
    await as(db, g.user, (tx) => tx.query(`update app.expenses set status = 'active', posted_version = 2 where id = $1`, [e]));
    expect(await balances(db, g.group)).toEqual({ [g.bilal]: 150000n, [g.asha]: -50000n, [g.chitra]: -50000n, [g.dev]: -50000n });
    // History is kept: both versions are still there.
    const versions = await db.query('select version from app.expense_versions where expense_id = $1 order by version', [e]);
    expect(versions.rows).toEqual([{ version: 1 }, { version: 2 }]);
    expect(await reconcileDiffs(db, g.group)).toEqual([]);
  });

  it('an edit that keeps every amount writes no ledger rows', async () => {
    const g = await goa();
    const v = { total: 90000n, payers: [{ memberId: g.asha, amount: 90000n }], split: { method: 'equal' as const, members: [g.asha, g.dev] } };
    const e = await as(db, g.user, (tx) => addExpense(tx, g.group, g.asha, { ...v, title: 'Taxi' }));
    await as(db, g.user, (tx) => editExpense(tx, g.group, e, g.asha, 2, { ...v, title: 'Taxi to airport' }));
    const dirs = await db.query('select direction, source_version from app.ledger_batches where source_id = $1 order by id', [e]);
    expect(dirs.rows).toEqual([{ direction: 'post', source_version: 1 }]);
    expect(await reconcileDiffs(db, g.group)).toEqual([]);
  });

  it('a refund posts the same split with signs inverted', async () => {
    const g = await goa();
    await as(db, g.user, (tx) =>
      addExpense(tx, g.group, g.asha, { kind: 'refund', total: 40000n, payers: [{ memberId: g.asha, amount: 40000n }], split: { method: 'equal', members: [g.asha, g.bilal] } }),
    );
    expect(await balances(db, g.group)).toEqual({ [g.asha]: -20000n, [g.bilal]: 20000n });
  });

  it('a draft and a new expense under review are not counted (I6)', async () => {
    const g = await goa();
    const e = uuid();
    await as(db, g.user, async (tx) => {
      await tx.query(`insert into app.expenses (id, group_id, created_by, status, review_version, expense_date) values ($1, $2, $3, 'in_review', 1, current_date)`, [e, g.group, g.asha]);
      await tx.query(
        `insert into app.expense_versions (expense_id, version, group_id, title, currency, original_total_minor, ledger_total_minor, split_method, split_input, payers, created_by)
         values ($1, 1, $2, 'Cab', 'INR', 1000, 1000, 'equal', '{}', '[{}]', $3)`, [e, g.group, g.asha]);
      await tx.query(`insert into app.expense_version_lines values ($1, 1, $2, $3, 1000, 500), ($1, 1, $2, $4, 0, 500)`, [e, g.group, g.asha, g.bilal]);
    });
    expect(await balances(db, g.group)).toEqual({});
    expect(await reconcileDiffs(db, g.group)).toEqual([]);
  });

  it('refuses a version whose shares or payers do not add up to the total (I1), atomically', async () => {
    const g = await goa();
    const e = uuid();
    await expect(
      as(db, g.user, async (tx) => {
        await tx.query(`insert into app.expenses (id, group_id, created_by, status, posted_version, expense_date) values ($1, $2, $3, 'active', 1, current_date)`, [e, g.group, g.asha]);
        await tx.query(
          `insert into app.expense_versions (expense_id, version, group_id, title, currency, original_total_minor, ledger_total_minor, split_method, split_input, payers, created_by)
           values ($1, 1, $2, 'Bad', 'INR', 1000, 1000, 'equal', '{}', '[{}]', $3)`, [e, g.group, g.asha]);
        await tx.query(`insert into app.expense_version_lines values ($1, 1, $2, $3, 1000, 500), ($1, 1, $2, $4, 0, 499)`, [e, g.group, g.asha, g.bilal]);
      }),
    ).rejects.toThrow(/I1 violated/);
    const left = await db.query('select 1 from app.expenses where id = $1', [e]);
    expect(left.rows).toEqual([]);
    expect(await balances(db, g.group)).toEqual({});
  });

  it('refuses gaps in version numbers and edits to saved versions', async () => {
    const g = await goa();
    const v = { total: 1000n, payers: [{ memberId: g.asha, amount: 1000n }], split: { method: 'equal' as const, members: [g.asha, g.bilal] } };
    const e = await as(db, g.user, (tx) => addExpense(tx, g.group, g.asha, v));
    await expect(as(db, g.user, (tx) => editExpense(tx, g.group, e, g.asha, 3, v))).rejects.toThrow(/expects version 2/);
    // Two layers: the API role has no UPDATE privilege, and even the owner hits the trigger.
    await expect(as(db, g.user, (tx) => tx.query(`update app.expense_versions set title = 'x' where expense_id = $1`, [e]))).rejects.toThrow(/permission denied/);
    await expect(db.query(`update app.expense_versions set title = 'x' where expense_id = $1`, [e])).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from app.expense_version_lines where expense_id = $1`, [e])).rejects.toThrow(/append-only/);
  });
});

describe('database: append-only ledger (I4)', () => {
  it('blocks updates, deletes and truncates for every role, including the owner', async () => {
    const g = await goa();
    await as(db, g.user, (tx) =>
      addExpense(tx, g.group, g.asha, { total: 1000n, payers: [{ memberId: g.asha, amount: 1000n }], split: { method: 'equal', members: [g.asha, g.bilal] } }),
    );
    await expect(db.query('update app.ledger_entries set amount_minor = 1 where group_id = $1', [g.group])).rejects.toThrow(/append-only/);
    await expect(db.query('delete from app.ledger_entries where group_id = $1', [g.group])).rejects.toThrow(/append-only/);
    await expect(db.query('delete from app.ledger_batches where group_id = $1', [g.group])).rejects.toThrow(/append-only/);
    await expect(db.query('truncate app.ledger_entries cascade')).rejects.toThrow(/append-only/);
  });

  it('the API role cannot write ledger rows directly', async () => {
    const g = await goa();
    await expect(
      as(db, g.user, (tx) => tx.query(`insert into app.ledger_batches (group_id, source_type, source_id, source_version, direction) values ($1, 'expense', $2, 1, 'post')`, [g.group, uuid()])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, g.user, (tx) => tx.query(`select app.sync_expense_ledger($1)`, [uuid()])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('database: settlements', () => {
  async function pay(g: Awaited<ReturnType<typeof goa>>, status: string, recordedBy: string) {
    const id = uuid();
    await as(db, g.user, (tx) =>
      tx.query(
        `insert into app.settlements (id, group_id, from_member, to_member, amount_minor, method, status, recorded_by)
         values ($1, $2, $3, $4, 30000, 'upi', $5, $6)`,
        [id, g.group, g.bilal, g.asha, status, recordedBy],
      ),
    );
    return id;
  }

  it('a payment recorded by the payer counts only after the receiver confirms; void reverses it', async () => {
    const g = await goa();
    const s = await pay(g, 'awaiting_confirmation', g.bilal);
    expect(await balances(db, g.group)).toEqual({});
    await as(db, g.user, (tx) => tx.query(`update app.settlements set status = 'confirmed', decided_by = $2, decided_at = now() where id = $1`, [s, g.asha]));
    expect(await balances(db, g.group)).toEqual({ [g.bilal]: 30000n, [g.asha]: -30000n });
    await as(db, g.user, (tx) => tx.query(`update app.settlements set status = 'voided' where id = $1`, [s]));
    expect(await balances(db, g.group)).toEqual({});
    expect(await reconcileDiffs(db, g.group)).toEqual([]);
  });

  it('enforces who records what, fixed amounts and allowed status changes', async () => {
    const g = await goa();
    // The receiver's own record counts at once; it can never be "awaiting".
    await expect(pay(g, 'awaiting_confirmation', g.asha)).rejects.toThrow(/check constraint/);
    const s = await pay(g, 'confirmed', g.asha);
    expect(await balances(db, g.group)).toEqual({ [g.bilal]: 30000n, [g.asha]: -30000n });
    await expect(as(db, g.user, (tx) => tx.query(`update app.settlements set amount_minor = 1 where id = $1`, [s]))).rejects.toThrow(/cannot change/);
    await expect(as(db, g.user, (tx) => tx.query(`update app.settlements set status = 'awaiting_confirmation' where id = $1`, [s]))).rejects.toThrow(/cannot go from/);
    await expect(pay(g, 'verified', g.asha)).rejects.toThrow(/invalid input value for enum/);
    await expect(
      as(db, g.user, (tx) => tx.query(`insert into app.settlements (group_id, from_member, to_member, amount_minor, method, status, recorded_by) values ($1, $2, $2, 100, 'cash', 'confirmed', $2)`, [g.group, g.asha])),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('database: reviews (I8)', () => {
  it('one decision per member per version, and never by the version author', async () => {
    const g = await goa();
    const e = await as(db, g.user, (tx) =>
      addExpense(tx, g.group, g.asha, { total: 1000n, payers: [{ memberId: g.asha, amount: 1000n }], split: { method: 'equal', members: [g.asha, g.bilal] } }),
    );
    const decide = (member: string) =>
      as(db, g.user, (tx) => tx.query(`insert into app.review_decisions (expense_id, group_id, version, member_id, decision) values ($1, $2, 1, $3, 'approve')`, [e, g.group, member]));
    await expect(decide(g.asha)).rejects.toThrow(/author of a version cannot review/);
    await decide(g.bilal);
    await expect(decide(g.bilal)).rejects.toThrow(/duplicate key/);
  });
});

describe('database: who can see what (RLS, I11)', () => {
  it('outsiders see nothing and cannot write into the group', async () => {
    const g = await goa();
    await as(db, g.user, (tx) =>
      addExpense(tx, g.group, g.asha, { total: 1000n, payers: [{ memberId: g.asha, amount: 1000n }], split: { method: 'equal', members: [g.asha, g.bilal] } }),
    );
    const stranger = await addUser(db);
    const seen = await as(db, stranger, async (tx) => {
      const counts: Record<string, number> = {};
      for (const t of ['groups', 'members', 'expenses', 'expense_versions', 'expense_version_lines', 'ledger_entries', 'ledger_batches', 'member_balances']) {
        counts[t] = (await tx.query<{ n: number }>(`select count(*)::int as n from app.${t} where ${t === 'groups' ? 'id' : 'group_id'} = $1`, [g.group])).rows[0]!.n;
      }
      return counts;
    });
    expect(Object.values(seen).every((n) => n === 0)).toBe(true);
    await expect(
      as(db, stranger, (tx) => addExpense(tx, g.group, g.asha, { total: 500n, payers: [{ memberId: g.asha, amount: 500n }], split: { method: 'equal', members: [g.asha] } })),
    ).rejects.toThrow(/row-level security/);
    await expect(as(db, stranger, (tx) => tx.query(`update app.groups set name = 'mine' where id = $1`, [g.group]))).resolves.toBeDefined();
    const name = await db.query<{ name: string }>('select name from app.groups where id = $1', [g.group]);
    expect(name.rows[0]!.name).toBe('Goa Trip');
  });

  it('a former member keeps their own balance, payments and expenses that involved them, nothing else', async () => {
    const g = await goa();
    const bilalUser = await addUser(db);
    // Bilal joins by claiming his placeholder through an invite.
    const token = new Uint8Array(32).fill(7);
    await as(db, g.user, (tx) => tx.query(`insert into app.invites (group_id, token_hash, created_by, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [g.group, token, g.asha]));
    await as(db, bilalUser, (tx) => tx.query('select app.accept_invite($1, $2, null)', [token, g.bilal]));
    const [withBilal, withoutBilal] = await as(db, g.user, async (tx) => [
      await addExpense(tx, g.group, g.asha, { title: 'Cab', total: 1000n, payers: [{ memberId: g.asha, amount: 1000n }], split: { method: 'equal', members: [g.asha, g.bilal] } }),
      await addExpense(tx, g.group, g.asha, { title: 'Gift for Bilal', total: 3000n, payers: [{ memberId: g.asha, amount: 3000n }], split: { method: 'equal', members: [g.asha, g.chitra, g.dev] } }),
    ]);
    await as(db, bilalUser, (tx) =>
      tx.query(`insert into app.messages (group_id, author_id, kind, body, expense_id) values ($1, $2, 'question', 'Toll included?', $3)`, [g.group, g.bilal, withBilal]),
    );
    // Bilal leaves.
    await as(db, g.user, (tx) => tx.query(`update app.members set status = 'left', left_at = now() where id = $1`, [g.bilal]));

    const view = await as(db, bilalUser, async (tx) => ({
      expenses: (await tx.query<{ id: string }>('select id from app.expenses where group_id = $1', [g.group])).rows.map((r) => r.id),
      balances: (await tx.query<{ member_id: string }>('select member_id from app.member_balances where group_id = $1', [g.group])).rows.map((r) => r.member_id),
      messages: (await tx.query('select 1 from app.messages where group_id = $1', [g.group])).rows.length,
      group: (await tx.query('select name from app.groups where id = $1', [g.group])).rows,
    }));
    expect(view.expenses).toEqual([withBilal]);
    expect(view.expenses).not.toContain(withoutBilal);
    expect(view.balances).toEqual([g.bilal]);
    expect(view.messages).toBe(0);
    expect(view.group).toEqual([{ name: 'Goa Trip' }]);
    await expect(
      as(db, bilalUser, (tx) => addExpense(tx, g.group, g.bilal, { total: 500n, payers: [{ memberId: g.bilal, amount: 500n }], split: { method: 'equal', members: [g.bilal] } })),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('database: accounts and invites', () => {
  it("nobody can attach someone else's account to a member", async () => {
    const g = await goa();
    const other = await addUser(db);
    await expect(as(db, g.user, (tx) => tx.query('update app.members set user_id = $2 where id = $1', [g.bilal, other]))).rejects.toThrow(/signed-in user/);
    await expect(
      as(db, g.user, (tx) => tx.query(`insert into app.members (group_id, user_id, display_name) values ($1, $2, 'Zoya')`, [g.group, other])),
    ).rejects.toThrow(/signed-in user/);
  });

  it('invites: claim a placeholder or join new, reopen safely, expired links refused', async () => {
    const g = await goa();
    const token = new Uint8Array(32).fill(9);
    const expired = new Uint8Array(32).fill(8);
    await as(db, g.user, async (tx) => {
      await tx.query(`insert into app.invites (group_id, token_hash, created_by, expires_at, max_uses) values ($1, $2, $3, now() + interval '1 day', 5)`, [g.group, token, g.asha]);
      await tx.query(`insert into app.invites (group_id, token_hash, created_by, expires_at) values ($1, $2, $3, now() - interval '1 minute')`, [g.group, expired, g.asha]);
    });
    const devUser = await addUser(db);
    const m1 = await as(db, devUser, (tx) => tx.query<{ m: string }>('select app.accept_invite($1, $2, null) as m', [token, g.dev]));
    expect(m1.rows[0]!.m).toBe(g.dev);
    const again = await as(db, devUser, (tx) => tx.query<{ m: string }>('select app.accept_invite($1, null, $2) as m', [token, 'Dev']));
    expect(again.rows[0]!.m).toBe(g.dev);
    const zoya = await addUser(db);
    await expect(as(db, zoya, (tx) => tx.query('select app.accept_invite($1, $2, null)', [token, g.dev]))).rejects.toThrow(/already taken/);
    const newMember = await as(db, zoya, (tx) => tx.query<{ m: string }>('select app.accept_invite($1, null, $2) as m', [token, 'Zoya']));
    expect(newMember.rows[0]!.m).toMatch(/^[0-9a-f-]{36}$/);
    await expect(as(db, await addUser(db), (tx) => tx.query('select app.accept_invite($1, null, $2)', [expired, 'Late']))).rejects.toThrow(/not valid/);
    const uses = await db.query<{ uses: number }>('select uses from app.invites where token_hash = $1', [token]);
    expect(uses.rows[0]!.uses).toBe(2);
  });

  it('deleting an account leaves every balance unchanged (I12)', async () => {
    const g = await goa();
    const bilalUser = await addUser(db);
    const token = new Uint8Array(32).fill(5);
    await as(db, g.user, (tx) => tx.query(`insert into app.invites (group_id, token_hash, created_by, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [g.group, token, g.asha]));
    await as(db, bilalUser, (tx) => tx.query('select app.accept_invite($1, $2, null)', [token, g.bilal]));
    await as(db, g.user, (tx) =>
      addExpense(tx, g.group, g.bilal, { total: 90000n, payers: [{ memberId: g.bilal, amount: 90000n }], split: { method: 'equal', members: [g.asha, g.bilal, g.dev] } }),
    );
    const before = await balances(db, g.group);
    await db.query('delete from auth.users where id = $1', [bilalUser]);
    expect(await balances(db, g.group)).toEqual(before);
    const m = await db.query<{ user_id: string | null }>('select user_id from app.members where id = $1', [g.bilal]);
    expect(m.rows[0]!.user_id).toBeNull();
    expect(await reconcileDiffs(db, g.group)).toEqual([]);
  });
});

describe('database: reconciliation and idempotency', () => {
  it('reconciliation reports ledger rows that the stored state does not explain', async () => {
    const g = await goa();
    await as(db, g.user, (tx) =>
      addExpense(tx, g.group, g.asha, { total: 1000n, payers: [{ memberId: g.asha, amount: 1000n }], split: { method: 'equal', members: [g.asha, g.bilal] } }),
    );
    // Simulate drift: a stray (balanced) batch written by a privileged connection, bypassing the sync.
    const stray = uuid();
    await db.transaction(async (tx) => {
      const b = await tx.query<{ id: number }>(
        `insert into app.ledger_batches (group_id, source_type, source_id, source_version, direction) values ($1, 'expense', $2, 1, 'post') returning id`, [g.group, stray]);
      await tx.query(`insert into app.ledger_entries (batch_id, group_id, member_id, amount_minor) values ($1, $2, $3, 100), ($1, $2, $4, -100)`, [b.rows[0]!.id, g.group, g.asha, g.bilal]);
    });
    const diffs = await reconcileDiffs(db, g.group);
    expect(diffs).toHaveLength(2);
    expect(diffs.every((d) => (d as { source_id: string }).source_id === stray)).toBe(true);
    const run = await db.transaction(async (tx) => {
      await tx.exec('set local role app_worker');
      return tx.query<{ n: number }>('select app.run_reconciliation() as n');
    });
    expect(run.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });

  it('a batch that does not sum to zero cannot be committed (I2)', async () => {
    const g = await goa();
    await expect(
      db.transaction(async (tx) => {
        const b = await tx.query<{ id: number }>(
          `insert into app.ledger_batches (group_id, source_type, source_id, source_version, direction) values ($1, 'expense', $2, 1, 'post') returning id`, [g.group, uuid()]);
        await tx.query(`insert into app.ledger_entries (batch_id, group_id, member_id, amount_minor) values ($1, $2, $3, 100)`, [b.rows[0]!.id, g.group, g.asha]);
      }),
    ).rejects.toThrow(/I2 violated/);
  });

  it('an idempotency key is stored once per user (I7)', async () => {
    const g = await goa();
    const insert = () =>
      as(db, g.user, (tx) => tx.query(`insert into app.idempotency_keys (user_id, key, request_hash) values ($1, 'key-12345', $2)`, [g.user, new Uint8Array(32)]));
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('a signed-in person may listen only on their own live-update channel', async () => {
    const me = uuid();
    const other = uuid();
    await db.query(`insert into realtime.messages (id, topic, event, payload, private, extension) values ($1, $2, 'changed', '{}', true, 'broadcast')`, [uuid(), `user:${me}`]);
    // Realtime checks a join by reading as the person, with the channel they asked for set.
    const canJoin = (topic: string) =>
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('realtime.topic', $2, true)`, [me, topic]);
        return (await tx.query<{ n: number }>('select count(*)::int as n from realtime.messages')).rows[0]!.n > 0;
      });
    expect(await canJoin(`user:${me}`)).toBe(true);
    expect(await canJoin(`user:${other}`)).toBe(false);
    expect(await canJoin('group:anything')).toBe(false);
  });

  it('a change still saves when the live hint cannot be sent', async () => {
    const g = await goa();
    const send = `realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language plpgsql as $$`;
    await db.exec(`create or replace function ${send} begin raise exception 'realtime is down'; end $$`);
    try {
      const id = uuid();
      await as(db, g.user, (tx) => tx.query(`insert into app.messages (id, group_id, author_id, kind, body) values ($1, $2, $3, 'text', 'hi')`, [id, g.group, g.asha]));
      expect((await db.query('select 1 from app.messages where id = $1', [id])).rows).toHaveLength(1);
    } finally {
      await db.exec(
        `create or replace function ${send} begin insert into realtime.messages (id, payload, event, topic, private, extension) values (gen_random_uuid(), payload, event, topic, private, 'broadcast'); end $$`,
      );
    }
  });

  it('the worker purges idempotency keys after 30 days, never ones under a day old', async () => {
    const g = await goa();
    const key = (k: string, age: string) =>
      db.query(`insert into app.idempotency_keys (user_id, key, request_hash, created_at) values ($1, $2, $3, now() - $4::interval)`, [g.user, k, new Uint8Array(32), age]);
    await key('old-key-1', '31 days');
    await key('recent-key', '2 days');
    await key('fresh-key1', '1 hour');
    const purge = (arg: string) =>
      db.transaction(async (tx) => {
        await tx.exec('set local role app_worker');
        return (await tx.query<{ n: string }>('select app.purge_idempotency_keys($1::interval)::text as n', [arg])).rows[0]!.n;
      });
    expect(await purge('30 days')).toBe('1');
    expect(await purge('0 seconds')).toBe('1'); // clamped to 1 day: the 2-day-old key goes, the fresh one stays
    const left = await db.query<{ key: string }>('select key from app.idempotency_keys where user_id = $1', [g.user]);
    expect(left.rows).toEqual([{ key: 'fresh-key1' }]);
    await expect(as(db, g.user, (tx) => tx.query(`select app.purge_idempotency_keys()`))).rejects.toThrow(/permission denied/);
  });

  it('balances from the database equal @app/ledger over a mixed history', async () => {
    const g = await goa();
    const everyone = [g.asha, g.bilal, g.chitra, g.dev];
    const cab = { total: 100001n, payers: [{ memberId: g.dev, amount: 100001n }], split: { method: 'equal' as const, members: everyone } };
    const dinner = {
      total: 240000n,
      payers: [{ memberId: g.bilal, amount: 140000n }, { memberId: g.chitra, amount: 100000n }],
      split: { method: 'percent' as const, basisPoints: [
        { memberId: g.asha, basisPoints: 2500 }, { memberId: g.bilal, basisPoints: 2500 },
        { memberId: g.chitra, basisPoints: 3333 }, { memberId: g.dev, basisPoints: 1667 },
      ] },
    };
    const [a, b] = await as(db, g.user, async (tx) => {
      const a = await addExpense(tx, g.group, g.dev, { total: 90000n, payers: [{ memberId: g.dev, amount: 90000n }], split: { method: 'equal', members: [g.asha, g.bilal, g.dev] } });
      const b = await addExpense(tx, g.group, g.bilal, dinner);
      await editExpense(tx, g.group, a, g.dev, 2, cab);
      return [a, b];
    });
    // Independent expectation: the engine's postings for the versions that should be counted.
    const expected = computeBalances([
      ...breakdownExpense({ expenseId: a, kind: 'expense', currency: 'INR', ...cab }, 'INR').postings,
      ...breakdownExpense({ expenseId: b, kind: 'expense', currency: 'INR', ...dinner }, 'INR').postings,
    ]);
    expect(await balances(db, g.group)).toEqual(Object.fromEntries(expected.filter((x) => x.amount !== 0n).map((x) => [x.memberId, x.amount])));
    expect(await reconcileDiffs(db, g.group)).toEqual([]);
  });

  it('random histories: database balances always match the engine and reconcile (I3, I5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            op: fc.constantFrom('add', 'add', 'edit', 'delete', 'restore', 'pay', 'confirm', 'void'),
            pick: fc.nat(),
            total: fc.bigInt({ min: 1n, max: 5_000_000n }),
            mask: fc.integer({ min: 1, max: 15 }),
            payer: fc.nat(3),
          }),
          { minLength: 1, maxLength: 25 },
        ),
        async (ops) => {
          const g = await goa();
          const people = [g.asha, g.bilal, g.chitra, g.dev];
          // Reference model: what each source should currently contribute.
          const expenses: { id: string; version: number; posted: number | null; deletedFrom: number | null; versions: Map<number, Posting[]> }[] = [];
          const settlements: { id: string; status: 'awaiting_confirmation' | 'confirmed' | 'voided'; postings: Posting[] }[] = [];
          for (const o of ops) {
            const members = people.filter((_, i) => o.mask & (1 << i));
            const v = { total: o.total, payers: [{ memberId: people[o.payer]!, amount: o.total }], split: { method: 'equal' as const, members } };
            const e = expenses.length ? expenses[o.pick % expenses.length]! : undefined;
            if (o.op === 'add' || (!e && ['edit', 'delete', 'restore'].includes(o.op))) {
              const id = await as(db, g.user, (tx) => addExpense(tx, g.group, people[o.payer]!, v));
              expenses.push({ id, version: 1, posted: 1, deletedFrom: null, versions: new Map([[1, breakdownExpense({ expenseId: id, kind: 'expense', currency: 'INR', ...v }, 'INR').postings]]) });
            } else if (o.op === 'edit' && e && e.posted !== null) {
              const n = e.version + 1;
              await as(db, g.user, (tx) => editExpense(tx, g.group, e.id, people[o.payer]!, n, v));
              e.versions.set(n, breakdownExpense({ expenseId: e.id, kind: 'expense', currency: 'INR', ...v }, 'INR').postings);
              e.version = n;
              e.posted = n;
            } else if (o.op === 'delete' && e && e.posted !== null) {
              await as(db, g.user, (tx) => tx.query(`update app.expenses set status = 'deleted', posted_version = null, restorable_version = $2 where id = $1`, [e.id, e.posted]));
              e.deletedFrom = e.posted;
              e.posted = null;
            } else if (o.op === 'restore' && e && e.deletedFrom !== null) {
              await as(db, g.user, (tx) => tx.query(`update app.expenses set status = 'active', posted_version = $2 where id = $1`, [e.id, e.deletedFrom]));
              e.posted = e.deletedFrom;
              e.deletedFrom = null;
            } else if (o.op === 'pay') {
              const from = people[o.payer]!;
              const to = people[(o.payer + 1 + (o.pick % 3)) % 4]!;
              const id = uuid();
              await as(db, g.user, (tx) =>
                tx.query(`insert into app.settlements (id, group_id, from_member, to_member, amount_minor, method, status, recorded_by) values ($1, $2, $3, $4, $5, 'upi', 'awaiting_confirmation', $3)`, [id, g.group, from, to, o.total.toString()]),
              );
              settlements.push({ id, status: 'awaiting_confirmation', postings: settlementPostings(from, to, o.total) });
            } else if (o.op === 'confirm' || o.op === 'void') {
              const s = settlements.find((x) => x.status === (o.op === 'confirm' ? 'awaiting_confirmation' : 'confirmed'));
              if (!s) continue;
              const next = o.op === 'confirm' ? 'confirmed' : 'voided';
              await as(db, g.user, (tx) => tx.query(`update app.settlements set status = $2 where id = $1`, [s.id, next]));
              s.status = next;
            }
          }
          const expected = computeBalances([
            ...expenses.flatMap((e) => (e.posted === null ? [] : e.versions.get(e.posted)!)),
            ...settlements.flatMap((s) => (s.status === 'confirmed' ? s.postings : [])),
          ]);
          expect(await balances(db, g.group)).toEqual(Object.fromEntries(expected.filter((x) => x.amount !== 0n).map((x) => [x.memberId, x.amount])));
          expect(await reconcileDiffs(db, g.group)).toEqual([]);
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});
