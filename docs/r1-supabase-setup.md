# Supabase Setup (do before R1 starts)

You do these steps yourself in the Supabase dashboard; nothing here needs code. Based on Supabase's docs as of 2026-10-22 (sources at the bottom). If a screen looks different, follow the dashboard and tell me what changed.

**Never paste the database password or the secret key into chat, an issue or git.** Share only the project reference ID and region. Secrets go in a local `.env.local` file, which is already covered by `.gitignore`.

## 1. Account and organisation
1. Sign up at supabase.com (GitHub or email). **Turn on MFA** for your own account (Account → Security).
2. Create an organisation, e.g. `expense-app`. **Free plan** is fine for R1 development.
   - Before the public beta, upgrade to **Pro** (from $25/month). Pro is needed for daily backups with longer retention, the optional **Point-in-Time Recovery** add-on (from $100/month for 7 days), and **organisation-wide MFA enforcement**.
   - Free projects can be paused after a period of inactivity, so check the current rule on the pricing page. Fine for development, not for production.

## 2. Create the development project
1. New project → name **`expense-dev`**.
2. **Region: South Asia (Mumbai), `ap-south-1`.** Closest to Indian users; latency matters for the money room's live updates.
3. Database password: generate a long random one and store it in your password manager.
4. Wait for provisioning to finish, then note the **project reference ID** (in the project URL / settings). That's the value to share with me.

Create **`expense-prod`** later, before beta, as a separate project with its own keys. Never share keys between dev and prod.

## 3. Security settings (dev project)
1. **Database → Settings → SSL enforcement: ON.** It's off by default for compatibility; our API will always use TLS.
2. **API keys:** use the new **publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) keys. Supabase is deprecating the legacy `anon` / `service_role` keys (by end of 2026), and new projects may not have them at all.
   - The **secret key bypasses Row Level Security**. It will live only on our Node API server, never in the mobile/web app.
   - The publishable key can ship in the app, because every table will have RLS enabled.
3. **Network restrictions (optional for dev):** you can restrict direct Postgres connections to your IP. Skip this if your home IP changes often; we'll set it for prod.
4. **Auth → Providers:** enable **Email** with one-time codes (OTP). Leave Google and Apple off for now.
   - **Google sign-in** (R1) needs a Google Cloud OAuth client.
   - **Sign in with Apple** needs an Apple Developer account ($99/year), which you'll also need to publish the iOS app.
5. **Auth → URL configuration:** leave it for now; I'll give you the exact redirect URLs in R1.

## 4. Local development (optional, R1 week 1)
- The Supabase CLI plus Docker lets us run Postgres/Auth locally and keep the database schema as versioned migrations in git. Install it using the method in Supabase's official CLI docs when we start R1. I'll confirm the current command then.

## 5. What to send me when done
- Project reference ID and region (e.g. `abcd1234…`, `ap-south-1`)
- Confirmation that SSL enforcement is on and Email OTP is enabled
- Whether you created the Apple Developer and Google Cloud accounts (needed later in R1)
- **Not** the password or secret key. You'll put those into `.env.local` yourself when R1 code needs them.

## Sources
- Regions: https://supabase.com/docs/guides/platform/regions
- API keys and migration: https://supabase.com/docs/guides/api/api-keys , https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- SSL enforcement: https://supabase.com/docs/guides/platform/ssl-enforcement
- Platform security / network restrictions: https://supabase.com/docs/guides/security/platform-security
- Org MFA enforcement: https://supabase.com/docs/guides/platform/mfa/org-mfa-enforcement
- Pricing: https://supabase.com/pricing
