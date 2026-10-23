# API (R1 M3)

The Fastify API in `apps/api` is the only writer of group data. Every request runs in one database transaction as the `app_api` role, with `app.user_id` set to the signed-in user, so Row Level Security applies to every query.

## Running it

1. Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` and `SUPABASE_URL`. Never commit or paste the values.
2. Start it with `npm run dev -w @app/api` (reloads on change) or `npm start -w @app/api`. It listens on `127.0.0.1:3001`.
3. If config is missing, it prints the names of the missing variables, never their values, and exits.

`DATABASE_URL` uses the `api_login` role. That role has no rights of its own: it can only `set role app_api`. It is never the `postgres` superuser. `npm run db:api-login` sets it up (see [m4-setup.md](m4-setup.md)). A remote database is reached only over TLS, with the certificate checked: without `DATABASE_CA_CERT` the API refuses to start.

Other settings, all optional:
- `CORS_ORIGINS`: the exact web app origins allowed to call the API. Default `http://localhost:8081`.
- `RATE_LIMIT_PER_MINUTE`: requests per minute per signed-in user. Default 300. Invite preview and accept get a tenth of that, counted separately.
- `TRUST_PROXY`: the number of proxy hops in front of the API, when it is hosted behind one.

## Conventions

| Topic | Rule |
|---|---|
| Auth | Send `Authorization: Bearer <Supabase access token>`. Tokens must be ES256, signed by the project's keys (JWKS), with audience `authenticated`, `role = authenticated`, and a UUID `sub`. Anything else gets 401 |
| Paths | Every route is under `/v1`. Ids are UUIDs; any other id gets 404. `GET /health` needs no token |
| Money | Strings of minor units: `"60000"` is ₹600.00. Money never passes through a JS number |
| Ids | The client may send `id` (UUIDv7) when creating something, so an offline retry creates it once. Otherwise the server generates one |
| Changes | `POST`/`PUT`/`PATCH` need an `Idempotency-Key` header (8–128 of `A–Z a–z 0–9 - _`) |
| Secrets in URLs | Invite tokens go in request bodies, never in URLs, so they stay out of logs. Only the token's SHA-256 is stored. App invite links carry the token after `#`, which browsers never send to a server |
| Browsers | CORS allows only `CORS_ORIGINS`, with no credentials mode (bearer tokens, no cookies) |
| Limits | 429 `rate_limited` with a `retry-after` header |

### Idempotency (I7)

- The key, a hash of the request (method, URL, body), and the response are stored in the same transaction as the change.
- The same key with the same request returns the stored response, with the header `idempotent-replayed: true`, and the change does not run again.
- The same key with a different request returns 422 `idempotency_key_reused`.
- If the change fails, the key is released along with it, so a corrected retry runs.

### Errors

Every error has the form `{ "error": { "code", "message", "details"? } }`. Messages are written for end users.

| Status | Codes |
|---|---|
| 400 | `invalid_request` (details are the zod field errors), `idempotency_key_required` |
| 401 | `unauthenticated` |
| 403 | `forbidden`, `not_eligible`, `not_a_member` (a former member trying to change something) |
| 404 | `not_found` (also for groups you are not in: ids can't be probed), `invite_invalid` |
| 429 | `rate_limited` |
| 409 | `invalid_state`, `stale_version` (reload and retry), `conflict`, `balance_not_zero`, `owner_must_stay`, `already_exists` |
| 422 | `reason_required`, `unknown_member`, `display_name_required`, `idempotency_key_reused`, money and ledger errors (e.g. a split that doesn't add up) |

## Endpoints

### Sign-in email (no sign-in needed)

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/email-code` | `{ email }` → `{ ok: true, codeLength }`. The answer is the same whether or not the address has an account. It emails a code (its length, 6–10 digits, is the Supabase project's "Email OTP length" setting; the app shows a box that fits it) and a "Sign in" button (`/auth/callback#token_hash=…&type=…`) through Resend, using Supabase `admin/generate_link`. It returns 429 after 1 per minute or 5 per hour per address, or 20 per hour per IP (`app.claim_login_email`). It returns 503 `email_not_configured` without `SUPABASE_SECRET_KEY` and `RESEND_API_KEY`, and the app then uses Supabase's own email. |

### Profile
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | `{ userId, displayName }` |
| PUT | `/me` | `{ displayName }` |

### Groups and members
| Method | Path | Notes |
|---|---|---|
| GET | `/groups` | My groups, each with `me`, `memberCount` and `myBalance` |
| POST | `/groups` | `{ name, kind?, currency?, displayName?, placeholders? }` → group detail (201) |
| GET | `/groups/:groupId` | Members, non-zero balances, and the simplified `transfers` (current members only) |
| PATCH | `/groups/:groupId` | Admins: `name`, `kind`, `reviewThreshold` (null turns review mode off), `reviewRequired`, `archived` |
| POST | `/groups/:groupId/members` | Add a placeholder by name (201) |
| PATCH | `/groups/:groupId/members/:memberId` | Rename: yourself, an admin, or a placeholder. Role: owner only |
| POST | `/groups/:groupId/members/:memberId/remove` | Admins. `{ acknowledgeBalance }` is required when the person's balance is not zero |
| POST | `/groups/:groupId/leave` | Same balance rule. The owner can't leave while others who have joined remain |

### Invites
| Method | Path | Notes |
|---|---|---|
| GET | `/groups/:groupId/invites` | Invites that still work |
| POST | `/groups/:groupId/invites` | `{ expiresInDays?, maxUses? }` → `{ id, token, expiresAt, maxUses }`. The token is shown only once |
| POST | `/groups/:groupId/invites/:inviteId/revoke` | The creator or an admin |
| POST | `/invites/preview` | `{ token }` → group name, member count, placeholders to claim. Does not join |
| POST | `/invites/accept` | `{ token, claimMemberId?, displayName? }` → group detail |

### Expenses
| Method | Path | Notes |
|---|---|---|
| GET | `/groups/:groupId/expenses` | Newest first (up to 500). Each row has `counted`, `pendingChange`, `lines`, `openSuggestions`, `openQuestions` and `disputed`. Drafts appear only to their creator |
| GET | `/expenses/:expenseId` | Full detail: versions with lines, review, disputes, suggestions, messages, `ownerIds`, `canEdit` |
| POST | `/groups/:groupId/expenses` | Content plus `{ id?, kind?, draft? }` (201). Counts at once, unless review mode holds it |
| PUT | `/expenses/:expenseId` | Content plus `{ baseVersion }`. Creator or payer only; everyone else suggests |
| POST | `/expenses/:expenseId/submit` · `delete` · `restore` | `{ baseVersion }` |
| POST | `/expenses/:expenseId/approve` | `{ version }` |
| POST | `/expenses/:expenseId/decline` | `{ version, reason }` |
| POST | `/expenses/:expenseId/withdraw-review` · `withdraw-dispute` | `{}` |
| POST | `/expenses/:expenseId/dispute` | `{ baseVersion, reason }` |

Expense content is `{ title, notes?, category?, date, currency, total, rate?, rateSource?, payers: [{ memberId, amount }], split }`. The split is one of:
- `{ method: "equal", members }`
- `{ method: "exact", amounts: [{ memberId, amount }] }`
- `{ method: "percent", basisPoints: [{ memberId, basisPoints }] }` (must total 10000)
- `{ method: "shares", shares: [{ memberId, shares: "1.5" }] }`

### Suggestions and questions
| Method | Path | Notes |
|---|---|---|
| POST | `/expenses/:expenseId/suggestions` | `{ baseVersion, proposal: <content>, reason? }` (201) |
| POST | `/suggestions/:id/accept` | Owner. The suggestion becomes the next version |
| POST | `/suggestions/:id/decline` | Owner, `{ reason }` |
| POST | `/suggestions/:id/withdraw` | Author |
| POST | `/expenses/:expenseId/messages` | `{ kind: "text" \| "question", body, replyTo? }` (201) |
| POST | `/messages/:id/resolve` | Questions only. The asker or an expense owner |

### Snapshot
| Method | Path | Notes |
|---|---|---|
| GET | `/groups/:groupId/snapshot` | Group detail plus every expense in full (up to 500) plus payments, in one call. The app loads this per group. The cursor-based sync replaces it in M6 |

### Conversation, seen and live updates
The rules here were agreed with the user on 2026-10-23: conversation stays about money, there is no general chat, no online status and no per-message ticks.

| Method | Path | Notes |
|---|---|---|
| POST | `/expenses/:id/messages` | Only people **in the expense** (the creator, plus anyone who paid or owed in any version) can read or write its thread. Anyone else gets 403 `not_in_expense`, and RLS hides the messages. `replyTo` must point into the same thread |
| GET | `/groups/:groupId/pairs/:memberId` | Private settle-up thread between me and one member: `{ members, messages, seen }`. Only the two of them can see it, including after one leaves |
| POST | `/groups/:groupId/pairs/:memberId/messages` | `{ id?, body }` (201) |
| POST | `/seen` | `{ items: [{ groupId, type: expense\|settlement\|pair, id, version? }] }`. Records "seen" on money items only. Items this person can't see are skipped. Repeats within 5 s are not news |
| GET | `/pulse` | `{ groups: { [groupId]: token } }`. The token changes whenever anything this person can see in that group changes (activity, messages, seen, members). It is the safety net behind the Realtime hints: the app checks it every 30 s while the hint channel is connected, every 3 s while it is not, and when the app comes back to the front. It then reloads only the groups that changed |

The snapshot also carries `pairMessages` (my pair threads only) and `seen` (filtered by the same rules). Expense detail carries `canChat` and `seen`.

### Settlements
| Method | Path | Notes |
|---|---|---|
| GET | `/groups/:groupId/settlements` | Newest first. A former member sees only their own |
| POST | `/groups/:groupId/settlements` | `{ from, to, amount, method, note? }` (201). The recorder must be one of the two, and may have left the group (settling up after leaving). Recorded by the receiver: `confirmed` (counts). Recorded by the payer: `awaiting_confirmation` |
| POST | `/settlements/:id/confirm` | Receiver. Repeating it returns the same result |
| POST | `/settlements/:id/decline` | Receiver, `{ reason }` |
| POST | `/settlements/:id/withdraw` | Whoever recorded it, while it awaits confirmation |
| POST | `/settlements/:id/void` | Receiver, on a confirmed payment, `{ reason }`. Reverses it in the ledger |

## How the rules map to the database

- **Workflow rules.** The rules come from `@app/workflow` (`transitionExpense`, `transitionSuggestion`, `recordSettlement`, `transitionSettlement`). Routes load the rows, ask the state machine, and save the result.
- **Ledger.** The ledger follows `expenses.posted_version` and the settlement status through deferred database triggers. API code never writes ledger rows. An edit that keeps every amount (for example a title change) writes no ledger rows.
- **Edits under review.** An edit under review is stored as `in_review`, with the old version still in `posted_version` and the edit in `review_version`. If the edit is declined, the counted version is saved again as the newest version, so the history reads "changed, then changed back".
- **Who can review.** Reviewers are current members who have signed up and are affected by the expense. A placeholder can never give an OK, so it never blocks a review.
- **Activity log.** Every change writes an `activity_events` row in the same transaction. This is the outbox for notifications in M5.

## Tests

- **`tests/api`** runs the real app with `app.inject()` against PGlite, using the real migrations and a local ES256 signing key. It covers:
  - auth, idempotency, CORS and rate limits;
  - groups, invites and the snapshot;
  - leaving with a balance, former-member visibility, and settling up after leaving;
  - expenses, drafts, disputes, questions, suggestions and review mode;
  - settlements.
- **`tests/api/client-remote.test.ts`** drives the app's own data layer (`apps/client/src/data/remote.ts`) against the API over HTTP. After every step, the balance the screens compute must equal the server ledger.
- **`npm run test:pg`** starts a throwaway PostgreSQL 17 and runs the API suite on it, plus `tests/pg`, the races PGlite can't show:
  - 20 requests with the same idempotency key;
  - 10 edits against one version;
  - a payment confirmed 10 times at once;
  - a single-use invite accepted by 5 people at once;
  - parallel review OKs;
  - a suggestion accepted while the owner edits.
  CI runs it on `postgres:17.11`.

## Known gaps (planned)

- **Idempotency-key cleanup.** `app.purge_idempotency_keys()` exists, granted to the worker only, but nothing runs it on a schedule until the worker arrives (M5).
- **Review mode in the app.** The app hides expenses that are waiting for review, and has no screen to review them yet (R2).
- **Multi-payer and foreign-currency expenses** entered elsewhere show in the app with their largest payer and the converted total. The app computes balances from that, so such expenses can differ from the server until "Why?" uses the server's lines (M5).
- **Live updates are Supabase Realtime hints plus `/pulse`.** Migration `20261025090000_live_hints.sql` works as follows:
  - **What triggers a hint:** triggers on `activity_events`, `messages` and `seen` call `realtime.send()`.
  - **Where it goes:** each affected person gets `{"g": groupId}` on their private channel `user:<auth user id>`.
  - **Who counts as affected:** the people who may see the change. That means current members for group activity, the expense's people for its thread and seen marks, the two people for a pair thread, and a removed member as well.
  - **When:** a hint goes out only if the change commits. Each person gets at most one hint per group per transaction. A failed send never blocks the change.
  - **Listening:** RLS on `realtime.messages` (`splitify_own_hints`) lets a signed-in person join only their own channel. There is no insert policy, so apps cannot broadcast.
  - **What the app does:** it reloads the hinted groups through the API. Hints carry no data.
  - **Gaps:** a pair-thread or expense-thread hint goes only to that thread's people. A group-activity hint goes to all current members, as `/pulse` does.
- **Snapshot cost.** It runs about six queries per expense, which is fine for alpha groups. The M6 sync replaces it.
