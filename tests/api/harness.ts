import type { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { type AppDeps, buildApp } from '../../apps/api/src/app';
import { supabaseVerifier } from '../../apps/api/src/auth';
import { type Db, TEXT_TYPES } from '../../apps/api/src/db';
import { freshDb } from '../db/harness';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

/** Where the API under test keeps its data, plus superuser access for checks and fixtures. */
export interface Backend {
  db: Db;
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** PGlite (Postgres in WASM), the same transaction setup as production minus the statement timeout. */
export async function pgliteBackend(): Promise<Backend> {
  const text = (value: string) => value;
  const pg: PGlite = await freshDb({ parsers: { [TEXT_TYPES.int8]: text, [TEXT_TYPES.numeric]: text, [TEXT_TYPES.date]: text } });
  return {
    db: {
      asUser: (userId, fn) =>
        pg.transaction(async (tx) => {
          await tx.exec('set local role app_api');
          await tx.query(`select set_config('app.user_id', $1, true)`, [userId]);
          return fn(tx);
        }),
      close: () => pg.close(),
    },
    query: (sql, params) => pg.query(sql, params),
  };
}

export interface TestApi {
  app: FastifyInstance;
  /** Superuser queries, outside RLS (for checks the API does not expose). */
  query: Backend['query'];
  /** A new Supabase user, with a profile name, and a valid access token. */
  user(name: string): Promise<User>;
  /** Signs any claims with the test key (for auth tests). */
  sign(claims: Record<string, unknown>, expiresIn?: string): Promise<string>;
}

export interface User {
  id: string;
  token: string;
  get(url: string): Promise<Res>;
  send(method: 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown, key?: string): Promise<Res>;
}

export interface Res {
  status: number;
  // Untyped JSON: tests read the fields they check.
  body: any;
  headers: Record<string, unknown>;
}

let keyCounter = 0;
export const newKey = () => `test-key-${Date.now()}-${++keyCounter}`;

export async function testApi(backend?: Backend, options: Partial<Omit<AppDeps, 'db' | 'verifyToken'>> = {}): Promise<TestApi> {
  const { db, query } = backend ?? (await pgliteBackend());
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), alg: 'ES256', kid: 'test' };
  const verifyToken = supabaseVerifier(SUPABASE_URL, createLocalJWKSet({ keys: [jwk] }));
  const app = buildApp({ rateLimitPerMinute: 10_000, ...options, db, verifyToken });

  const sign = (claims: Record<string, unknown>, expiresIn = '1h') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);

  const call = async (token: string, method: string, url: string, body?: unknown, key?: string): Promise<Res> => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (method !== 'GET') headers['idempotency-key'] = key ?? newKey();
    const res = await app.inject({ method: method as 'GET', url: `/v1${url}`, headers, payload: body as object | undefined });
    return { status: res.statusCode, body: res.body ? res.json() : undefined, headers: res.headers };
  };

  return {
    app,
    query,
    sign,
    async user(name) {
      const id = crypto.randomUUID();
      await query('insert into auth.users (id) values ($1)', [id]);
      const token = await sign({ sub: id, role: 'authenticated' });
      const u: User = {
        id,
        token,
        get: (url) => call(token, 'GET', url),
        send: (method, url, body = {}, key) => call(token, method, url, body, key),
      };
      const p = await u.send('PUT', '/me', { displayName: name });
      if (p.status !== 200) throw new Error(`profile: ${JSON.stringify(p.body)}`);
      return u;
    },
  };
}

/** Fails the test with the response body, which says why, instead of a bare status mismatch. */
export function ok(res: Res, status = 200): Res {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res;
}
