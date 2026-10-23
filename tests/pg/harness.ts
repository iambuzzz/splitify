import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { pgDb } from '../../apps/api/src/db';
import type { Backend } from '../api/harness';
import { REALTIME_SHIM } from '../db/harness';

/** Stand-ins for the Supabase objects the migrations reference. Roles are cluster-wide, hence the guards. */
const SUPABASE_SHIM = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end $$;
`;

const MIGRATIONS = join(import.meta.dirname, '../../supabase/migrations');

/**
 * A fresh database on a real (throwaway) Postgres server, with the real migrations. The API reaches
 * it through the production `pgDb` adapter, so requests really run in parallel transactions.
 * `url` must point at a disposable server as a superuser: `npm run test:pg` starts one.
 */
export async function postgresBackend(url: string): Promise<{ backend: Backend; drop(): Promise<void> }> {
  const name = `splitify_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const dbUrl = new URL(url);
  dbUrl.pathname = `/${name}`;
  try {
    // Test files run in parallel; roles are cluster-wide, so set-ups take turns.
    await admin.query('select pg_advisory_lock(7231)');
    await admin.query(`create database ${name}`);
    const setup = new pg.Client({ connectionString: dbUrl.toString() });
    await setup.connect();
    try {
      await setup.query(SUPABASE_SHIM);
      await setup.query(REALTIME_SHIM);
      for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
        await setup.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
      }
    } finally {
      await setup.end();
    }
  } finally {
    await admin.end(); // also releases the lock
  }

  const db = pgDb({ connectionString: dbUrl.toString(), max: 20 });
  const su = new pg.Pool({ connectionString: dbUrl.toString(), max: 2 });
  return {
    backend: { db, query: async <R,>(sql: string, params?: unknown[]) => (await su.query(sql, params)) as unknown as { rows: R[] } },
    async drop() {
      await db.close();
      await su.end();
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}
