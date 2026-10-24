import { createHash } from 'node:crypto';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { canonicalize } from '@app/workflow';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { VerifyToken } from './auth';
import type { Db, Tx } from './db';
import type { EmailSignIn } from './email-sign-in';
import type { ReceiptStore } from './receipts-store';
import { ApiError, toApiError } from './errors';
import { conversationRoutes } from './routes/conversation';
import { expenseRoutes } from './routes/expenses';
import { groupRoutes } from './routes/groups';
import { receiptFileRoutes, receiptRoutes } from './routes/receipts';
import { settlementRoutes } from './routes/settlements';
import { snapshotRoutes } from './routes/snapshot';

export interface AppDeps {
  db: Db;
  verifyToken: VerifyToken;
  logger?: boolean;
  /** Exact origins of the web app allowed to call the API from a browser (e.g. http://localhost:8081). */
  corsOrigins?: string[];
  /** Requests per minute per signed-in user (per IP before sign-in). Sensitive routes get a tenth. */
  rateLimitPerMinute?: number;
  /** Proxy hops in front of the API, so the client IP is read from X-Forwarded-For. */
  trustProxy?: number | false;
  /** Sign-in emails we send ourselves (code + button). Without it the app uses Supabase's own email. */
  emailSignIn?: EmailSignIn;
  /** Where receipt photos and PDFs are kept. Without it, attaching them answers 503. */
  receipts?: ReceiptStore;
}

/** Invite tokens and sign-in emails: slow down anyone trying them in bulk. */
const SENSITIVE = new Set(['/v1/invites/preview', '/v1/invites/accept', '/auth/email-code']);
/** No user yet when asking for a sign-in email; the database call needs one, and none has this id. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
const signInRequest = z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) });
const LIMITS: Record<string, string> = {
  wait_minute: 'We just sent you a code. Wait a minute before asking for another one',
  email_hour: 'Too many codes for this email. Try again in an hour',
  ip_hour: 'Too many sign-in emails from this network. Try again later',
};
const sensitive = (req: FastifyRequest) => SENSITIVE.has(req.routeOptions.url ?? '');

export interface Call<B> {
  tx: Tx;
  userId: string;
  body: B;
  params: Record<string, string>;
}

type Fn<B> = (c: Call<B>) => Promise<unknown>;

export interface Router {
  get(path: string, fn: Fn<undefined>): void;
  /** A read whose input must stay out of URLs and logs (e.g. an invite token). */
  read<S extends z.ZodType>(path: string, schema: S, fn: Fn<z.output<S>>): void;
  /** A change. Needs an `Idempotency-Key` header; a retry with the same key gets the stored response (I7). */
  mutate<S extends z.ZodType>(method: 'POST' | 'PUT' | 'PATCH', path: string, schema: S, fn: Fn<z.output<S>>, status?: number): void;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const PATH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export function buildApp({ db, verifyToken, logger = false, corsOrigins = [], rateLimitPerMinute = 300, trustProxy = false, emailSignIn, receipts }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger,
    bodyLimit: 256 * 1024,
    trustProxy: trustProxy === false ? false : (_address: string, hop: number) => hop < trustProxy,
  });
  app.decorateRequest('userId', '');

  // Bearer tokens, not cookies: no credentials mode, and only the app's own origins.
  app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key'],
    exposedHeaders: ['idempotent-replayed', 'retry-after'],
    maxAge: 600,
  });

  app.get('/health', async () => ({ ok: true }));

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/v1/')) return;
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new ApiError(401, 'unauthenticated', 'Sign in first');
    try {
      req.userId = await verifyToken(token);
    } catch {
      throw new ApiError(401, 'unauthenticated', 'Your session has expired. Sign in again');
    }
  });

  // After the auth hook, so limits follow the user rather than a shared IP (mobile networks, hostels).
  app.register(rateLimit, {
    hook: 'preHandler',
    timeWindow: 60_000,
    max: (req) => (sensitive(req) ? Math.max(1, Math.floor(rateLimitPerMinute / 10)) : rateLimitPerMinute),
    // Sensitive routes count on their own, so normal use doesn't eat into them (or the reverse).
    keyGenerator: (req) => `${req.userId || `ip:${req.ip}`}${sensitive(req) ? ':invites' : ''}`,
    errorResponseBuilder: (_req, ctx) =>
      new ApiError(429, 'rate_limited', `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds`),
  });

  app.setErrorHandler((err, req, reply) => {
    const api = toApiError(err) ?? fastifyError(err);
    if (!api) {
      req.log.error({ err }, 'request failed');
      return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong. Try again' } });
    }
    return reply.status(api.status).send({ error: { code: api.code, message: api.message, details: api.details } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }));

  const params = (req: FastifyRequest) => {
    const p = (req.params ?? {}) as Record<string, string>;
    // Ids in paths are UUIDs; anything else cannot exist, so it is a 404 rather than a database error.
    for (const value of Object.values(p)) if (!PATH_ID.test(value)) throw new ApiError(404, 'not_found', 'Not found');
    return p;
  };

  // Routes live in a plugin registered after CORS and rate limiting, so those hooks cover every route.
  app.register(async (scope) => {
    const router: Router = {
      get(path, fn) {
        scope.get(`/v1${path}`, async (req) =>
          db.asUser(req.userId, (tx) => fn({ tx, userId: req.userId, body: undefined, params: params(req) })),
        );
      },

      read(path, schema, fn) {
        scope.post(`/v1${path}`, async (req) => {
          const body = parse(schema, req.body);
          return db.asUser(req.userId, (tx) => fn({ tx, userId: req.userId, body, params: params(req) }));
        });
      },

      mutate(method, path, schema, fn, status = 200) {
        scope.route({
          method,
          url: `/v1${path}`,
          handler: async (req: FastifyRequest, reply: FastifyReply) => {
            const key = req.headers['idempotency-key'];
            if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) {
              throw new ApiError(400, 'idempotency_key_required', 'Send an Idempotency-Key header (8–128 letters, digits, - or _)');
            }
            const p = params(req);
            const body = parse(schema, req.body);
            const hash = createHash('sha256')
              .update(canonicalize({ method, url: req.url, body: (req.body ?? null) as unknown }))
              .digest();

            const result = await db.asUser(req.userId, async (tx) => {
              const claimed = await tx.query(
                `insert into app.idempotency_keys (user_id, key, request_hash) values ($1, $2, $3)
                 on conflict do nothing returning key`,
                [req.userId, key, hash],
              );
              if (claimed.rows.length === 0) {
                const prior = await tx.query<{ request_hash: Uint8Array; response_status: number; response_body: unknown }>(
                  'select request_hash, response_status, response_body from app.idempotency_keys where user_id = $1 and key = $2',
                  [req.userId, key],
                );
                const row = prior.rows[0]!;
                if (!Buffer.from(row.request_hash).equals(hash)) {
                  throw new ApiError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request');
                }
                return { status: row.response_status, body: row.response_body, replayed: true };
              }
              const response = await fn({ tx, userId: req.userId, body, params: p });
              // Stored in the same transaction: if the change rolls back, so does the key, and a retry runs again.
              await tx.query(
                'update app.idempotency_keys set response_status = $3, response_body = $4 where user_id = $1 and key = $2',
                [req.userId, key, status, JSON.stringify(response ?? null)],
              );
              return { status, body: response, replayed: false };
            });

            if (result.replayed) reply.header('idempotent-replayed', 'true');
            return reply.status(result.status).send(result.body);
          },
        });
      },
    };

    // Before sign-in: email a 6-digit code and a sign-in button. The same answer whether or not the
    // address has an account, so it can't be used to find out who uses Splitify.
    scope.post('/auth/email-code', async (req) => {
      const { email } = parse(signInRequest, req.body);
      if (!emailSignIn) throw new ApiError(503, 'email_not_configured', 'Sign-in emails are not set up on this server');
      const hash = (kind: string, value: string) => createHash('sha256').update(`splitify:${kind}:${value}`).digest();
      const verdict = await db.asUser(NOBODY, async (tx) => {
        const r = await tx.query<{ v: string }>('select app.claim_login_email($1, $2) as v', [hash('email', email), hash('ip', req.ip)]);
        return r.rows[0]!.v;
      });
      if (verdict !== 'ok') throw new ApiError(429, 'rate_limited', LIMITS[verdict] ?? 'Too many requests. Try again later');
      const token = await emailSignIn.generate(email);
      await emailSignIn.deliver(email, token).catch((err: unknown) => {
        // The person sees a plain message; the provider's reason goes to the server log for whoever runs it.
        req.log.warn({ reason: err instanceof Error ? err.cause : undefined }, 'sign-in email not sent');
        throw err;
      });
      // The code length is a project setting (6–10), the same for every address, so it reveals nothing.
      return { ok: true, codeLength: token.code.length };
    });

    groupRoutes(router);
    expenseRoutes(router);
    settlementRoutes(router);
    snapshotRoutes(router, { receipts: !!receipts });
    conversationRoutes(router);
    receiptRoutes(router);
    receiptFileRoutes(scope, db, receipts);
  });
  return app;
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_request', 'Some fields are missing or invalid', z.flattenError(parsed.error));
  }
  return parsed.data;
}

/** Fastify's own client errors (bad JSON, body too large, wrong content type). */
function fastifyError(err: unknown): ApiError | null {
  const e = err as { statusCode?: number; code?: string; message?: string };
  if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
    return new ApiError(e.statusCode, 'invalid_request', e.message ?? 'Invalid request');
  }
  return null;
}
