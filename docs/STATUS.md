# Project Status

Last updated 2026-10-23. Read this first when starting a new session.

## Where we are: R1 M1 done (app UI on demo data), M2 done (database schema, live on expense-dev), M3 done (API), M4 code done (sign-in + app on the API), waiting on user setup

**Live since 2026-10-23:** https://splitify.iambuzzdev.in (API at https://api.splitify.iambuzzdev.in) on one EC2 server in Mumbai. See [deploy.md](deploy.md); ship changes with `deploy/deploy.sh`. Sign-in: email code (Resend) and Google (web), both tested live 2026-10-24.

The user chose to start R1 while the R0 research continues. See [R1-PLAN.md](R1-PLAN.md). Splitify app: `npm run app` → http://localhost:8081, with themes Mint, Neon Lime, Receipt and Thermal. Data is demo data that resets on reload.

## R0 (validation and foundation)

**R0 engineering is done.** The R0 fieldwork below is still open and runs in parallel with R1.

### Done
- Plan Rev 3 approved: [PLAN.md](PLAN.md).
- Pure TypeScript packages, with no I/O:
  - `packages/money`: amounts, currencies, fair allocation, FX conversion.
  - `packages/ledger`: splits, postings, balances, simplify, journal, reconciliation.
  - `packages/workflow`: expense, suggestion and settlement state machines, plus idempotency.
- Tests:
  - 447 tests in 11 files, all passing.
  - Coverage: 99.8% statements, 97.1% branches, 100% functions and lines.
  - 338 golden vectors from an independent Python oracle.
  - Cross-package simulation in `tests/integration`.
- Checks:
  - Typecheck clean (TypeScript 7.0.2).
  - `npm audit`: 0 vulnerabilities.
  - CI workflow runs on Node 22 and 24.
- Docs:
  - [invariants.md](invariants.md): I1–I12 and their verification status.
  - [workflow-transitions.md](workflow-transitions.md)
  - [r1-supabase-setup.md](r1-supabase-setup.md)
  - 6 validation kits in [validation/](validation/): interviews (with recruitment messages and pricing questions), competitor tests, UPI device tests, desktop usability, diary study, and pricing test.
- Nothing is committed to git yet.


### Not built yet

## User-side tasks (gate R0 close)
| Task | Kit | Status |
|---|---|---|
| 15–20 user interviews | [01](validation/01-interview-script-and-screener.md) | Not started |
| Hands-on competitor tests | [02](validation/02-competitor-testing-checklist.md) | Not started |
| UPI device tests (GPay, PhonePe, Paytm, BHIM) | [03](validation/03-upi-device-testing-sheet.md) | Not started |
| Concierge diary study, 3–5 groups on real trips | [05](validation/05-diary-study-kit.md) | Not started |
| Pricing questions (inside the interviews) | [06](validation/06-pricing-test-kit.md) | Not started |
| Desktop usability spike (can come just before R1 client work) | [04](validation/04-desktop-usability-checklist.md) | Not started |
| Create the Supabase dev project (`expense-dev`, ref `ifqcjehhdqpyiehnkorw`, `ap-south-1`) | [r1-supabase-setup.md](r1-supabase-setup.md) | **Done 2026-10-22**: project healthy, SSL enforced, Email provider on, new publishable/secret keys present, MFA skipped. Apple Developer account: user does not have one (needed only before iPhone release, R1 end or R2; $99/year). Google Cloud account: yes |

## Open gaps and risks
- **Database-level invariants.** I4, I5 and I7 need R1 database enforcement. I11 and I12 can only be checked in R1. I10 still needs runs on Hermes and in a browser.
- **TypeScript 7 tooling.** TS 7 has no programmatic API, which may break typescript-eslint or the Expo tooling in R1. Fallback: alias TS 6 for those tools.
- **Supabase account MFA is OFF** (user chose to skip for the dev project, 2026-10-22). Must be turned on before the public beta, when real user data exists.
- **No lint.** No linter is configured yet.
- **Audit allowlist review due 2026-11-22** (`braces`, `node-forge` in Expo tooling). CI fails after that date until it is reviewed.
- **Node versions.** The local Node is 22.23.3; update to the 22.23.4 security release. Add Node 26 to CI after 2026-10-28.

## Next step
1. ~~Push the schema to `expense-dev`~~: **done 2026-10-22**. 3 migrations applied, 17 tables plus the `member_balances` view in schema `app`, roles `app_api` and `app_worker` present (checked with `supabase migration list` and `inspect db`).
2. **R1 M3 done (2026-10-23):** the Fastify API in `apps/api`. See [api.md](api.md). M3 gaps fixed the same day:
   - Former members can settle up: RLS and the API now let the payer and the receiver record, confirm, decline or void their own payments.
   - Concurrency is tested on real PostgreSQL 17 (`npm run test:pg`, plus a CI job on `postgres:17.11`). The API suite also runs there.
   - `app.purge_idempotency_keys()` exists for the worker.
   - Fixed: the expense detail ran parallel queries on one connection, which pg@9 will reject.
3. **R1 M4 code done, waiting on user setup (2026-10-23):**
   - API:
     - CORS, limited to the app's origins;
     - per-user rate limits (invite routes 1/10);
     - TLS with the certificate checked, required for remote databases;
     - the `api_login` role, with no rights of its own;
     - `GET /groups/:id/snapshot`.
   - App:
     - email-code sign-in (Supabase Auth), then a name step;
     - the remote store maps the API into the existing screens (my member id in each group shows as `me`);
     - real invite links (token after `#`) and a `/join` screen to claim a placeholder;
     - an error banner and sign-out;
     - the app creates the ids for new groups and expenses.
     Without `apps/client/.env.local`, the app still runs on demo data.
   - Tests: 514 in the normal run, 40 on real Postgres. A client-to-API integration test checks that the app's balances equal the server's after each step. Web bundles build in both modes. Browser check: the sign-in screen and demo home render.
   - **User steps:** [m4-setup.md](m4-setup.md). Steps 1–4 done and verified on 2026-10-23: migrations live, `api_login` logs in over checked TLS, the publishable key is set, and the project signs tokens with ES256. Left: step 5 (Site URL and redirect URL `http://localhost:8081/**`), because templates are locked without custom SMTP, so the app signs in from the emailed link (PKCE).
   - Then: a live sign-in test together, and Google sign-in.

4. **First live test passed (2026-10-23).** Two real users (Ambuj and Riya) on expense-dev: expense, questions, dispute, 3 versions. The user then asked for members, admin controls, personal chat, real time and seen/online. The user decided (asked, all three recommended options):
   - **Personal chat:** a money-only 1:1 page per pair: the balance between you, payments, and a private thread. No general DMs.
   - **Expense thread:** visible only to the people in that expense.
   - **Seen:** on money items only (expense version, payment, pair thread). No online status and no per-message delivered/seen ticks.
   - **Built:**
     - Migration `20261024090000_threads_and_seen.sql`: `is_in_expense`, pair threads on `messages`, `app.seen`, and RLS for all of it.
     - API: pair routes, `/seen`, `/pulse`, `canChat`.
     - App: the sidebar lists the open group's members (unread dot, balances, "Manage members").
     - Members screen: add by name; admins remove (with a balance warning); the owner makes and removes admins.
     - "You & X" page: the balance between you, pay or confirm (no double-recording while a payment is pending), and the private chat.
     - Expense chat: text and questions, "Mark resolved", "Seen by".
     - The inbox shows unread pair messages.
     - Live updates every 3 s while the app is visible.
   - Tests: 519 in the normal run, 45 on Postgres. Browser check in demo mode: sidebar, members, pair page and expense chat render.
   - Migration `20261024090000_threads_and_seen.sql` pushed to expense-dev on 2026-10-23 (the API runs under `tsx watch`, so it needed no restart).
   - **UX pass (2026-10-23):**
     - **Live-update fix:** if the first load failed, the app stayed empty until a manual refresh. Now every live check reloads any group that never loaded.
     - **Loading states:** groups show "Loading…" or "Offline · trying again" instead of a blank page. Home has an empty state.
     - **Shared `Missing` screen:** group pages show it instead of "not found" while data loads.
     - **Add-expense form:** it waits for the group to load. A direct link used to start with nobody in the split.
     - **Who-owes-whom amounts:** the sidebar shows the amount between you and each person (+ they pay you, − you pay them). Phones get the same in a people strip on the group page.
     - **Layout:** laptop top spacing now matches the sidebar, and the amount input is centred.
     - **Sign-in copy:** it now says "sign-in link".
   - **Supabase Realtime (2026-10-23):**
     - Migration `20261025090000_live_hints.sql` is pushed and verified live: the policy, three triggers, and the hint owner's permission to call `realtime.send`.
     - The app listens on `user:<id>` (private) and reloads the hinted groups. `/pulse` runs every 30 s while connected and every 3 s while not.
     - Fixed: the polling loops multiplied each time the tab or app came back to the front.
     - **Tests:** 522 normal and 46 on Postgres. They cover who gets hints, one hint per change, the channel policy, and that a failed send still saves the change.
     - **Not tested yet:** live WebSocket delivery from Supabase to a browser. It needs a signed-in user, so it waits for the user's two-window test.
   - **Speed and flicker fixes (2026-10-23, after the user's live test):**
     - **Snapshot speed:** it loads every expense in a fixed set of batched queries (`expenseDetails`). For a 10-expense group that is 16 queries instead of 97. A test checks that the snapshot matches each expense's own page for three users, covering review, dispute, suggestion, thread, seen and draft.
     - **Request set-up:** each request's transaction now starts in 2 round trips instead of 4.
     - **App reloads:** a hint reloads only that group, with no group list fetched first. Each snapshot is numbered by when it was requested, so an older response never replaces a newer one.
     - **No more jump-back:** my unsaved changes stay on screen over any snapshot requested before they were saved (`withPending`). This fixes "settled → unsettled → settled" after confirming a payment, and has a test.
     - **Sidebar:** the open group's members are drawn as a tree (├ … └), with "You" included.
     - **Development console:** shows `[live] SUBSCRIBED` (or an error) for the Realtime channel.
   - **Duplicate-message fix and dots (2026-10-23):**
     - **Duplicate fix:** an unsaved change is re-applied only over snapshots requested *before* the tap. The live hint's reload can arrive before the API's reply and already contain the change, which caused the duplicate-key warning when asking a question. A test covers this.
     - **Dots:** `newMarks()` puts a dot where something new came from: the group (sidebar and home), the expense row, the person (sidebar tree and phone strip), and the Settle button when a payment waits for me.
     - **Unread expense threads:** a thread counts as unread when someone else wrote after my seen mark and after my own last message.
     - **Dots clear immediately:** what I open counts as seen on the device right away (`seenLocally`), even within the server's 5 s seen guard.
   - **Safari blank-screen fix (2026-10-23):**
     - **Cause:** in WebKit, expo-font 58.0.9's `document.fonts.load()` never settles. It timed out after 12 s, and the root layout rendered nothing while fonts were "not loaded", even after that error, so the screen stayed blank.
     - **Fix:** the root now renders when fonts are loaded, or on a font error, or when our own `document.fonts.load()` (asked 30 ms later, which WebKit answers) resolves, with 1.5 s as the last fallback.
     - **Measured:** visible after about 250 ms in Playwright WebKit 26, and the full screen sweep renders in WebKit.
     - **Invite join screen:** a placeholder matching my name is preselected. Joining as new has a name field that warns about clashes before submitting. The API answers `name_taken` or `name_claimed` instead of "This already exists".
     - **Invite sheet:** link with Copy, WhatsApp (`wa.me` with the link on its own line), More options (system share), the 14-day note, and a localhost warning.
     - **Icon fonts:** Feather and MaterialCommunityIcons are added to the root font list. In WebKit the icon set's own load also hung, so icons such as the ₹ logo stayed empty.
   - **Own sign-in emails (2026-10-23):**
     - **Route:** `POST /auth/email-code` (no sign-in) calls Supabase `admin/generate_link` (type magiclink; it creates new users) with `SUPABASE_SECRET_KEY` and gets back `email_otp` and `hashed_token`.
     - **Email:** sent through Resend, with the code and a "Sign in" button to `/auth/callback#token_hash=…&type=…`.
     - **App:** a typed code goes to `verifyOtp({ email, token, type: 'email' })` and submits automatically at 6 digits. The button goes to `verifyOtp({ token_hash, type })` and works in any browser.
     - **Rate limits:** `app.login_email_log` holds hashed email and IP, rows are dropped after a day, and `app.claim_login_email` allows 1 per minute and 5 per hour per address, and 20 per hour per IP. Migration `20261026090000` is pushed live.
     - **Fallback:** without the keys the API answers `email_not_configured` and the app falls back to Supabase's own link email.
     - **Tests:** route, limits, Supabase and Resend calls with a stub fetch, HTML escaping, and client wiring.
     - **User step:** add `SUPABASE_SECRET_KEY` and `RESEND_API_KEY` to `.env.local`. Resend without a verified domain sends only to the account owner's own address, so a domain is needed for friends.
   - **"Check your email" screen (2026-10-23):** it leads with the link, since Supabase's built-in emails have no code. It shows three steps, an "Open Gmail/Outlook/Yahoo" button, and the same-browser hint, with the code field behind "My email has a code instead". It continues by itself when the link is opened in another tab (supabase-js syncs sign-in across tabs). Codes come with custom SMTP before alpha.

The npm audit decision is made: a CI allowlist with a review date of 2026-11-22. See the R1-PLAN.md security note.
