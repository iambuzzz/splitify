import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EmailSignIn, type SignInToken, signInHtml, supabaseResendSignIn } from '../../apps/api/src/email-sign-in';
import { type TestApi, testApi } from './harness';

/** Stands in for Supabase + Resend: records what would have been emailed. */
function fakeSender() {
  const sent: { email: string; token: SignInToken }[] = [];
  const sender: EmailSignIn = {
    generate: async (email) => ({ code: email.startsWith('long') ? '12345678' : String(100000 + sent.length), tokenHash: `hash-${email}`, type: 'magiclink' }),
    deliver: async (email, token) => void sent.push({ email, token }),
  };
  return { sent, sender };
}

describe('sign-in emails sent by the API', () => {
  let api: TestApi;
  let unconfigured: TestApi;
  const mail = fakeSender();
  beforeAll(async () => {
    api = await testApi(undefined, { emailSignIn: mail.sender });
    unconfigured = await testApi();
  }, 60_000);
  afterAll(async () => {
    await api?.app.close();
    await unconfigured?.app.close();
  });

  const ask = (t: TestApi, email: string, ip = '10.0.0.1') =>
    t.app.inject({ method: 'POST', url: '/auth/email-code', payload: { email }, remoteAddress: ip });

  it('emails a code and a button to the address, without signing in first', async () => {
    const res = await ask(api, '  Riya@Example.COM ');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, codeLength: 6 });
    expect(mail.sent.at(-1)).toMatchObject({ email: 'riya@example.com', token: { tokenHash: 'hash-riya@example.com' } });
    // Only hashes are kept for the rate limits.
    const rows = await api.query<{ email_hash: Uint8Array }>('select email_hash from app.login_email_log');
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.rows)).not.toContain('riya');
  });

  it('says how long the code is, since the Supabase project sets it (6–10 digits)', async () => {
    expect((await ask(api, 'long@example.com', '10.0.0.2')).json()).toEqual({ ok: true, codeLength: 8 });
  });

  it('refuses bad addresses, and says so when the server has no email set up', async () => {
    expect((await ask(api, 'not-an-email')).statusCode).toBe(400);
    const res = await ask(unconfigured, 'a@example.com');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('email_not_configured');
  });

  it('one email per address per minute, five per hour', async () => {
    const email = 'dev@example.com';
    expect((await ask(api, email)).statusCode).toBe(200);
    const again = await ask(api, email);
    expect(again.statusCode).toBe(429);
    expect(again.json().error.message).toContain('Wait a minute');
    // Four more spread over the hour are fine; the sixth is not.
    for (let i = 0; i < 4; i++) {
      await api.query(`update app.login_email_log set created_at = created_at - interval '2 minutes'`);
      expect((await ask(api, email)).statusCode).toBe(200);
    }
    await api.query(`update app.login_email_log set created_at = created_at - interval '2 minutes'`);
    const sixth = await ask(api, email);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.message).toContain('in an hour');
    // An hour later it works again.
    await api.query(`update app.login_email_log set created_at = created_at - interval '1 hour'`);
    expect((await ask(api, email)).statusCode).toBe(200);
  });

  it('twenty per network per hour, whatever the addresses', async () => {
    const ip = '10.9.9.9';
    for (let i = 0; i < 20; i++) expect((await ask(api, `p${i}@example.com`, ip)).statusCode).toBe(200);
    const res = await ask(api, 'p20@example.com', ip);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toContain('this network');
    expect((await ask(api, 'p20@example.com', '10.9.9.10')).statusCode).toBe(200);
  });
});

describe('Supabase + Resend sign-in sender', () => {
  function recorder(responses: Record<string, { status: number; body: unknown }>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = Object.entries(responses).find(([k]) => url.includes(k))![1];
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }
  const base = { supabaseUrl: 'https://proj.supabase.co', resendKey: 're_test', from: 'Splitify <onboarding@resend.dev>', appUrl: 'https://app.example' };

  it('asks Supabase for a magic-link token (secret key on apikey only) and emails code + button via Resend', async () => {
    const { calls, fetchFn } = recorder({
      generate_link: { status: 200, body: { email_otp: '482913', hashed_token: 'abc123', verification_type: 'signup', action_link: 'x' } },
      'api.resend.com': { status: 200, body: { id: 'e1' } },
    });
    const s = supabaseResendSignIn({ ...base, secretKey: 'sb_secret_xxxxxxxxxxxxxxxx', fetch: fetchFn });
    const token = await s.generate('riya@example.com');
    expect(token).toEqual({ code: '482913', tokenHash: 'abc123', type: 'signup' });
    expect(calls[0]!.url).toBe('https://proj.supabase.co/auth/v1/admin/generate_link');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.apikey).toBe('sb_secret_xxxxxxxxxxxxxxxx');
    expect(h.authorization).toBeUndefined();
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ type: 'magiclink', email: 'riya@example.com' });

    await s.deliver('riya@example.com', token);
    const email = JSON.parse(calls[1]!.init.body as string);
    expect(calls[1]!.url).toBe('https://api.resend.com/emails');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    expect(email).toMatchObject({ to: ['riya@example.com'], subject: '482913 is your Splitify code' });
    // The token rides after '#', so it never lands in a web server's logs.
    expect(email.text).toContain('https://app.example/auth/callback#token_hash=abc123&type=signup');
    expect(email.html).toContain('482913');
  });

  it('a legacy service_role key also goes as the bearer; failures become clear errors', async () => {
    const { calls, fetchFn } = recorder({ generate_link: { status: 500, body: {} }, 'api.resend.com': { status: 422, body: {} } });
    const s = supabaseResendSignIn({ ...base, secretKey: 'eyJhbGciOiJIUzI1NiJ9.legacy.key', fetch: fetchFn });
    await expect(s.generate('a@example.com')).rejects.toMatchObject({ status: 502, code: 'sign_in_unavailable' });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.legacy.key');
    await expect(s.deliver('a@example.com', { code: '1', tokenHash: 'h', type: 'magiclink' })).rejects.toMatchObject({ code: 'email_failed', message: expect.stringContaining('Check the address') });
    // Other refusals (e.g. a sender domain Resend has not verified) are not the person's fault.
    const other = recorder({ 'api.resend.com': { status: 403, body: { name: 'validation_error', message: 'testing emails only' } } });
    const s2 = supabaseResendSignIn({ ...base, secretKey: 'sb_secret_xxxxxxxxxxxxxxxx', fetch: other.fetchFn });
    await expect(s2.deliver('a@example.com', { code: '1', tokenHash: 'h', type: 'magiclink' })).rejects.toMatchObject({
      message: expect.stringContaining('right now'),
      cause: 'resend 403: testing emails only',
    });
  });

  it('escapes what goes into the email html', () => {
    expect(signInHtml('<b>1</b>', 'https://x/"y')).not.toContain('<b>1</b>');
    expect(signInHtml('1', 'https://x/"y')).toContain('https://x/&quot;y');
  });
});
