import pg from 'pg';

export interface Tx {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Every request runs in one transaction as `app_api`, with `app.user_id` set to the signed-in
 * user, so Row Level Security limits every query to that user's groups. Deferred database checks
 * (I1, I2, ledger sync) run at commit.
 */
export interface Db {
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Types both drivers return as text, so results look the same in production (node-postgres)
 * and in tests (PGlite): money must never pass through a JS number, and a `date` is a calendar
 * day, not a moment in the server's time zone.
 */
export const TEXT_TYPES = { int8: 20, numeric: 1700, date: 1082 } as const;
const textOids = new Set<number>(Object.values(TEXT_TYPES));

export interface PgOptions {
  connectionString: string;
  /** PEM of the CA that signed the database certificate (Supabase: Database settings → SSL). */
  caCert?: string;
  max?: number;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function pgDb(options: PgOptions): Db {
  // A remote database is reached only over TLS with the certificate checked against its CA.
  const host = new URL(options.connectionString).hostname;
  if (!options.caCert && !LOCAL_HOSTS.has(host)) {
    throw new Error('DATABASE_CA_CERT is required for a remote database (Supabase: Database settings → SSL → Download certificate)');
  }
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    ssl: options.caCert ? { ca: options.caCert, rejectUnauthorized: true } : undefined,
    types: {
      getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
        textOids.has(oid) ? (value: string) => value : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
    },
  });

  return {
    async asUser(userId, fn) {
      const client = await pool.connect();
      try {
        // One round trip for the fixed set-up (the database may be far away); the user id goes as a parameter.
        await client.query("begin; set local role app_api; set local statement_timeout = '5s'");
        await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
