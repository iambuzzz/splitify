import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { buildApp } from './app';
import { supabaseResendSignIn } from './email-sign-in';
import { supabaseVerifier } from './auth';
import { pgDb } from './db';

const env = z
  .object({
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
    SUPABASE_URL: z.url({ protocol: /^https$/ }),
    /** Path to the server CA certificate (Supabase dashboard → Database → SSL). */
    DATABASE_CA_CERT: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default('127.0.0.1'),
    /** Comma-separated exact origins of the web app, e.g. "http://localhost:8081,https://app.example.com". */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:8081')
      .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean))
      .pipe(z.array(z.url().refine((o) => new URL(o).origin === o, 'an origin has no path or trailing slash'))),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(300),
    /** Proxy hops in front of the API (0 when it is reached directly). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    // Sign-in emails (code + button) sent by the API. Leave both keys out to use Supabase's own email.
    SUPABASE_SECRET_KEY: z.string().min(20).optional(),
    RESEND_API_KEY: z.string().startsWith('re_').optional(),
    EMAIL_FROM: z.string().default('Splitify <onboarding@resend.dev>'),
    /** The web app's public address, for the button in sign-in emails (default: the first CORS origin). */
    APP_URL: z.url().optional(),
  })
  .safeParse(process.env);

if (!env.success) {
  // Names only: values may be secrets.
  console.error('API config is incomplete. Check .env.local:', Object.keys(z.flattenError(env.error).fieldErrors).join(', '));
  process.exit(1);
}

// .env.local lives at the repository root, so relative paths in it are relative to the root too.
const ROOT = resolve(import.meta.dirname, '../../..');
const { DATABASE_URL, SUPABASE_URL, DATABASE_CA_CERT, PORT, HOST, CORS_ORIGINS, RATE_LIMIT_PER_MINUTE, TRUST_PROXY, SUPABASE_SECRET_KEY, RESEND_API_KEY, EMAIL_FROM, APP_URL } =
  env.data;
const db = pgDb({ connectionString: DATABASE_URL, caCert: DATABASE_CA_CERT ? readFileSync(resolve(ROOT, DATABASE_CA_CERT), 'utf8') : undefined });
const app = buildApp({
  db,
  verifyToken: supabaseVerifier(SUPABASE_URL),
  logger: true,
  corsOrigins: CORS_ORIGINS,
  rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
  trustProxy: TRUST_PROXY > 0 ? TRUST_PROXY : false,
  emailSignIn:
    SUPABASE_SECRET_KEY && RESEND_API_KEY
      ? supabaseResendSignIn({ supabaseUrl: SUPABASE_URL, secretKey: SUPABASE_SECRET_KEY, resendKey: RESEND_API_KEY, from: EMAIL_FROM, appUrl: APP_URL ?? CORS_ORIGINS[0]! })
      : undefined,
});
// Names only, never the values.
console.log(SUPABASE_SECRET_KEY && RESEND_API_KEY ? 'Sign-in emails: sent by the API (Resend)' : 'Sign-in emails: Supabase built-in (set SUPABASE_SECRET_KEY and RESEND_API_KEY for codes)');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}

await app.listen({ port: PORT, host: HOST });
