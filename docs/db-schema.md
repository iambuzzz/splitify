# Database schema (R1 M2)

Migrations: [supabase/migrations/](../supabase/migrations/). Tests: [tests/db/schema.test.ts](../tests/db/schema.test.ts).

Tests run on PGlite (Postgres 18 in WASM), so they need no Docker in CI. The migrations were also applied and smoke-tested on real Postgres 17.11, the version the Supabase CLI targets. Write SQL that works on Postgres 17. For example, the API generates UUIDv7 ids because Postgres 17 has no `uuidv7()`.

## Shape
- **Schema `app`**, private. The Supabase Data API exposes only `public`. `anon` and `authenticated` have no grants here, and a test checks this.
- **Roles.**
  - `app_api` is used by the Node API in every request: `set local role app_api` plus `set_config('app.user_id', <user>, true)`.
  - `app_worker` is used for reconciliation and notifications. It can read everything and write only reconciliation runs.
  - Both are NOLOGIN. The connecting user (`postgres` on Supabase) switches into them.
- **Tables.**
  - People: `profiles`, `groups`, `members` (the ledger is keyed to these), `invites` (SHA-256 token hash only).
  - Expenses: `expenses`, `expense_versions` (immutable snapshots), `expense_version_lines` (paid and owed per member, computed by `@app/ledger`).
  - Expense workflow: `suggestions`, `review_decisions`, `disputes`.
  - Money and conversation: `settlements`, `messages` (expense questions).
  - System: `activity_events` (append-only audit and outbox), `idempotency_keys`.
  - Ledger: `ledger_batches`, `ledger_entries`, `reconciliation_runs`.
- **Composite foreign keys** `(group_id, member_id)` keep every member reference inside its own group.

## How the ledger stays right
1. The API writes state. A new version plus its lines go in, then the expense's `posted_version` is set: `null` when not counted, as for a draft, a new expense in review or a deleted one. For a settlement the API sets `status`.
2. At commit, deferred triggers do three things:
   - check I1: paid and owed each add up to the total;
   - make the ledger match: reverse the previous batch and post the new one;
   - check I2: every batch sums to 0.
3. The API role cannot insert into the ledger, and nobody can update or delete ledger rows (I4).
4. `app.reconcile()` recomputes what the ledger should hold and lists every difference (I5). `app.run_reconciliation()` records a run for the nightly job.

Positive balance means the member gets money back, the same sign as in `@app/ledger`.

## Rules for the API (M3)
- **One transaction per request**, as `app_api` with `app.user_id` set. RLS then limits every query to the user's groups.
- **Don't store empty lines.** Skip lines where both paid and owed are 0 (tiny totals can give someone a 0 share).
- **Number versions 1, 2, 3, with no gaps.** The database rejects anything else, and two concurrent edits make one of them fail. Return 409 for that.
- **Create groups and accept invites only through `app.create_group` and `app.accept_invite`.** A member can be linked only to the signed-in user.
- **Every new migration must keep the app schema private:** no grants to `anon`/`authenticated`, RLS enabled on new tables, and `revoke execute ... from public` on new functions. The privilege tests catch mistakes.

## Applying to Supabase
Run from the repo root on your machine:
1. `npm run db:login`: one time. It opens the browser to sign in to Supabase.
2. `npm run db:link`: one time. It asks for the database password in your terminal. Never paste it in chat.
3. `npm run db:push`: shows the migrations and asks for confirmation.

Check the result in the dashboard's Table Editor: switch the schema dropdown (top left, it starts on `public`) to `app`. You should see 17 tables and the `member_balances` view, all empty until the API is connected (M4). Pushed to `expense-dev` on 2026-10-22.
