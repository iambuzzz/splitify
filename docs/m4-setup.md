# M4 setup: real sign-in and saved data on expense-dev

Do these once, in order. Never paste a password, the database password or an `sb_secret_` key into chat or git.

| # | Step | How |
|---|---|---|
| 1 | Push the new migrations | `npm run db:push`, then confirm with `Y`. Three files: `…api_support`, `…settle_after_leaving`, `…api_login` |
| 2 | Download the database certificate | Supabase → Project Settings → Database → SSL Configuration → **Download certificate**. Move the `.crt` file into this project's `supabase/` folder. The certificate is public and contains no secret |
| 3 | Create the API's database login | `npm run db:api-login` (details below) |
| 4 | Add the publishable key to the app | In `apps/client/.env.local`, add `EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_…` (Project Settings → API Keys). Never the secret key: the app refuses to start with one |
| 5 | Allow the sign-in link to return to the app | Authentication → URL Configuration. Set **Site URL** to `http://localhost:8081`, and under **Redirect URLs** add `http://localhost:8081/**`. The default email (custom templates need your own SMTP sender) carries a sign-in link; the app takes it back in the same browser (PKCE). Once SMTP is set up (M6), put `{{ .Token }}` in the Magic link template and the app also takes the 6-digit code |
| 6 | Run it | Terminal 1: `npm run api`. Terminal 2: `npm run app`. Open http://localhost:8081, enter your email, and open the link from the email **in the same browser** |

What `npm run db:api-login` (step 3) does:
1. It makes a random password on your machine and copies the SQL that sets it to your clipboard. The password is never printed.
2. You paste and run that SQL in the Supabase SQL editor.
3. It checks that the API can log in over TLS (certificate checked) and act as `app_api`.
4. It writes `DATABASE_URL`, `SUPABASE_URL` and `DATABASE_CA_CERT` to `.env.local`, and the app's public URLs to `apps/client/.env.local`. Both files are git-ignored and readable only by you.

Run it again any time to change the password.

Notes:
- **No Supabase secret key.** The API never uses it. Sign-in tokens are checked against the project's public signing keys, and data goes through the `api_login` role, which can do nothing except act as `app_api` under RLS.
- **Email limits.** Supabase's built-in email sender is rate-limited to a few emails per hour, and that is enough for testing. Set up your own SMTP sender before the alpha with real groups (M6).
- **Invite links.** A link looks like `http://localhost:8081/join#t=…`. The part after `#` never reaches any server or log. Links last 14 days and can be revoked.
