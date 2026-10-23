import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type PGliteOptions, type Transaction } from '@electric-sql/pglite';
import { type ExpenseVersionInput, breakdownExpense } from '@app/ledger';

/**
 * Runs the real migrations in PGlite (Postgres compiled to WASM), so database rules are tested in CI
 * without Docker. The shim stands in for the Supabase objects the migrations reference.
 */
const SUPABASE_SHIM = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
`;

/**
 * Supabase Realtime's realtime.send() (same signature) records each broadcast in realtime.messages,
 * so tests can check who is told about a change.
 */
export const REALTIME_SHIM = `
  create schema realtime;
  create table realtime.messages (
    id uuid primary key, payload jsonb, event text, topic text, private boolean, extension text,
    inserted_at timestamptz not null default now()
  );
  alter table realtime.messages enable row level security;
  grant usage on schema realtime to authenticated;
  grant select on realtime.messages to authenticated;
  create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
  create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language plpgsql as $$
  begin
    insert into realtime.messages (id, payload, event, topic, private, extension)
    values (gen_random_uuid(), payload, event, topic, private, 'broadcast');
  end $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const MIGRATIONS = join(import.meta.dirname, '../../supabase/migrations');

export async function freshDb(options?: PGliteOptions): Promise<PGlite> {
  const db = new PGlite(options);
  await db.exec(SUPABASE_SHIM);
  await db.exec(REALTIME_SHIM);
  for (const file of readdirSync(MIGRATIONS).filter((f: string) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

export type Tx = Transaction;

/** One API request: a transaction as `app_api` for the signed-in user. Deferred checks run at commit. */
export function as<T>(db: PGlite, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role app_api');
    await tx.query(`select set_config('app.user_id', $1, true)`, [userId]);
    return fn(tx);
  });
}

export const uuid = () => crypto.randomUUID();

export async function addUser(db: PGlite, id = uuid()): Promise<string> {
  await db.query('insert into auth.users (id) values ($1)', [id]);
  return id;
}

export async function createGroup(db: PGlite, ownerUser: string, name = 'Goa Trip') {
  const group = uuid();
  const owner = uuid();
  await as(db, ownerUser, (tx) =>
    tx.query('select app.create_group($1, $2, $3, $4, $5, $6)', [group, name, 'trip', 'INR', owner, 'Asha']),
  );
  return { group, owner };
}

export async function addPlaceholder(tx: Tx, group: string, name: string): Promise<string> {
  const id = uuid();
  await tx.query('insert into app.members (id, group_id, display_name) values ($1, $2, $3)', [id, group, name]);
  return id;
}

export interface VersionInput {
  title?: string;
  total: bigint;
  payers: { memberId: string; amount: bigint }[];
  split: ExpenseVersionInput['split'];
  kind?: 'expense' | 'refund';
}

const toJson = (value: unknown) => JSON.stringify(value, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

/** Writes a version and its lines the way the API will: amounts computed by @app/ledger. */
async function writeVersion(tx: Tx, group: string, expense: string, version: number, by: string, v: VersionInput) {
  const b = breakdownExpense(
    { expenseId: expense, kind: v.kind ?? 'expense', currency: 'INR', total: v.total, payers: v.payers, split: v.split },
    'INR',
  );
  await tx.query(
    `insert into app.expense_versions (expense_id, version, group_id, title, currency, original_total_minor,
       ledger_total_minor, split_method, split_input, payers, created_by)
     values ($1, $2, $3, $4, 'INR', $5, $5, $6, $7, $8, $9)`,
    [expense, version, group, v.title ?? 'Expense', b.ledgerTotal.toString(), v.split.method, toJson(v.split), toJson(v.payers), by],
  );
  const lines = new Map<string, { paid: bigint; owed: bigint }>();
  for (const p of b.payers) lines.set(p.memberId, { paid: p.amount, owed: lines.get(p.memberId)?.owed ?? 0n });
  for (const s of b.shares) lines.set(s.memberId, { paid: lines.get(s.memberId)?.paid ?? 0n, owed: s.amount });
  for (const [member, l] of lines) {
    // Tiny totals can give someone a zero share; a line with nothing paid and nothing owed is not stored.
    if (l.paid === 0n && l.owed === 0n) continue;
    await tx.query(
      `insert into app.expense_version_lines (expense_id, version, group_id, member_id, paid_minor, owed_minor)
       values ($1, $2, $3, $4, $5, $6)`,
      [expense, version, group, member, l.paid.toString(), l.owed.toString()],
    );
  }
  return b;
}

export async function addExpense(tx: Tx, group: string, by: string, v: VersionInput, id = uuid()) {
  await tx.query(
    `insert into app.expenses (id, group_id, created_by, kind, status, current_version, posted_version, expense_date)
     values ($1, $2, $3, $4, 'active', 1, 1, current_date)`,
    [id, group, by, v.kind ?? 'expense'],
  );
  await writeVersion(tx, group, id, 1, by, v);
  return id;
}

export async function editExpense(tx: Tx, group: string, id: string, by: string, version: number, v: VersionInput) {
  await writeVersion(tx, group, id, version, by, v);
  await tx.query(`update app.expenses set current_version = $2, posted_version = $2 where id = $1`, [id, version]);
}

export async function balances(db: PGlite | Tx, group: string): Promise<Record<string, bigint>> {
  const r = await db.query<{ member_id: string; balance_minor: string }>(
    'select member_id, balance_minor::text from app.member_balances where group_id = $1',
    [group],
  );
  return Object.fromEntries(r.rows.filter((x) => x.balance_minor !== '0').map((x) => [x.member_id, BigInt(x.balance_minor)]));
}

export async function reconcileDiffs(db: PGlite, group?: string) {
  const r = await db.query('select * from app.reconcile($1)', [group ?? null]);
  return r.rows;
}
