import { ApiError } from './errors';

/** A one-time sign-in for an address: the 6-digit code and the hashed token behind the email's button. */
export interface SignInToken {
  code: string;
  tokenHash: string;
  /** What verifyOtp expects with the token hash ('magiclink', or 'signup' for a new account). */
  type: string;
}

/** Makes sign-in tokens and delivers them; split so tests can stand in for Supabase and Resend. */
export interface EmailSignIn {
  generate(email: string): Promise<SignInToken>;
  deliver(email: string, token: SignInToken): Promise<void>;
}

export interface EmailSignInConfig {
  supabaseUrl: string;
  /** Supabase secret key (sb_secret_…), or a legacy service_role key. Server-side only. */
  secretKey: string;
  resendKey: string;
  /** e.g. "Splitify <onboarding@resend.dev>" */
  from: string;
  /** Where the email's button points: the web app's address. */
  appUrl: string;
  fetch?: typeof fetch;
}

export function supabaseResendSignIn(cfg: EmailSignInConfig): EmailSignIn {
  const http = cfg.fetch ?? fetch;
  // New secret keys go on `apikey` only; a legacy service_role JWT is also sent as the bearer.
  const adminHeaders: Record<string, string> = { apikey: cfg.secretKey, 'content-type': 'application/json' };
  if (!cfg.secretKey.startsWith('sb_secret_')) adminHeaders.authorization = `Bearer ${cfg.secretKey}`;

  return {
    async generate(email) {
      // Creates the account when it's new; sends nothing (we send the email ourselves).
      const res = await http(`${cfg.supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ type: 'magiclink', email }),
      });
      const body = (await res.json().catch(() => null)) as { email_otp?: string; hashed_token?: string; verification_type?: string } | null;
      if (!res.ok || !body?.email_otp || !body.hashed_token) {
        throw new ApiError(502, 'sign_in_unavailable', 'Could not start sign-in right now. Try again in a minute');
      }
      return { code: body.email_otp, tokenHash: body.hashed_token, type: body.verification_type ?? 'magiclink' };
    },

    async deliver(email, token) {
      // The token sits after `#`, so it never reaches a web server's logs.
      const link = `${cfg.appUrl.replace(/\/$/, '')}/auth/callback#token_hash=${encodeURIComponent(token.tokenHash)}&type=${encodeURIComponent(token.type)}`;
      const res = await http('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.resendKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: cfg.from,
          to: [email],
          subject: `${token.code} is your Splitify code`,
          text: signInText(token.code, link),
          html: signInHtml(token.code, link),
        }),
      });
      if (!res.ok) {
        const reason = (await res.json().catch(() => null)) as { name?: string; message?: string } | null;
        // Resend answers 422 for an address it cannot send to; anything else is on our side (key, sender domain).
        const message = res.status === 422 ? 'Could not send the email. Check the address and try again' : 'Could not send the email right now. Try again in a few minutes';
        throw Object.assign(new ApiError(502, 'email_failed', message), { cause: `resend ${res.status}: ${reason?.message ?? reason?.name ?? 'no reason given'}` });
      }
    },
  };
}

export function signInText(code: string, link: string): string {
  return [
    `Your Splitify sign-in code: ${code}`,
    '',
    'Type it in the app, or open this link to sign in:',
    link,
    '',
    'The code works once and expires soon. If you didn’t ask for it, ignore this email.',
  ].join('\n');
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function signInHtml(code: string, link: string): string {
  const href = escape(link);
  return `<!doctype html><html><body style="margin:0;background:#F4F7F5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111816">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FFFFFF;border-radius:20px;border:1px solid #E3E8E5">
<tr><td style="padding:28px 28px 8px"><div style="font-size:20px;font-weight:800">Splitify</div></td></tr>
<tr><td style="padding:8px 28px 0"><div style="font-size:15px;color:#5B6661">Your sign-in code</div>
<div style="font-size:34px;font-weight:800;letter-spacing:6px;margin:8px 0 4px;font-family:ui-monospace,Menlo,Consolas,monospace">${escape(code)}</div>
<div style="font-size:13px;color:#5B6661">Type it in the app. It works once and expires soon.</div></td></tr>
<tr><td style="padding:24px 28px 8px"><a href="${href}" style="display:block;text-align:center;background:#0B6E4F;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:14px 20px;border-radius:999px">Sign in</a></td></tr>
<tr><td style="padding:8px 28px 28px;font-size:12px;color:#8E9692">The button works in any browser. If you didn’t ask to sign in, ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
}
