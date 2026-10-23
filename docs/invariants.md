# Money invariants: verification status (end of R0)

Status key: **Verified**: an automated test exercises it and passes. **Verified (domain)**: proven for the
pure packages; the R1 database/API must still enforce it, with its own test. **Not yet verifiable**: needs
R1 components (database, auth, API). Not claimed.

Run everything with `npm run check` (or `npm run coverage`).

| ID | Invariant (from the plan) | Status | Evidence |
|---|---|---|---|
| I1 | Every version: Σ shares = total = Σ payer amounts | **Verified** | Property tests over all split methods, multi-payer and foreign currency ([ledger.test.ts](../packages/ledger/test/ledger.test.ts)); 338 golden vectors from an independent Python oracle ([golden.test.ts](../packages/ledger/test/golden.test.ts)) |
| I2 | Every posting source sums to 0 | **Verified** | Property test on `breakdownExpense`; `LedgerJournal.post` refuses unbalanced batches ([journal.test.ts](../packages/ledger/test/journal.test.ts)) |
| I3 | Every group's balances sum to 0 | **Verified** | Property test over up to 25 random expenses; cross-package simulation checks after every command ([ledger-consistency.test.ts](../tests/integration/ledger-consistency.test.ts)) |
| I4 | Ledger rows are never updated or deleted | **Verified (domain + DB)** | `LedgerJournal` has no update/delete API. **DB (M2):** the API role has SELECT only on ledger tables, and triggers block UPDATE/DELETE/TRUNCATE even for the owner. Tested in PGlite ([schema.test.ts](../tests/db/schema.test.ts)) and smoke-tested on Postgres 17 |
| I5 | Ledger = postings of exactly the counted versions and confirmed settlements | **Verified (domain)** | `reconcile()` detects missing, unexpected, wrong-version and wrong-amount postings. The simulation (1,500 random runs × 20–120 commands) reconciles after every command. **DB (M2):** ledger rows are derived at commit from stored state by `app.sync_*_ledger`; `app.reconcile()` / `app.run_reconciliation()` report any difference. 25 random histories match the engine with 0 diffs, and a mutation (skipped reversal) is caught. **Still open:** schedule it nightly and alert (M6) |
| I6 | Drafts, in-review items, open suggestions and awaiting settlements have zero ledger impact | **Verified** | Workflow property test: `postedVersion ≠ null` iff status is active; settlement tests (awaiting → no post); suggestions emit no ledger effects |
| I7 | Same key + same payload → same result; same key + different payload → rejected | **Verified (domain)** | `IdempotencyRegistry` tests (100 replays → 1 execution; conflict on a different payload; failed attempts retryable). The simulation replays about 25,000 commands with no state change. **DB (M2):** `app.idempotency_keys` primary key (user, key) with request hash. **API (M3):** key, request hash and response stored in the same transaction as the change; replay returns the stored response, a different payload gets 422, a failed change releases the key (`tests/api`). **Real Postgres (`npm run test:pg`, also in CI):** 20 simultaneous requests with one key create one group, and the other 19 get the stored response |
| I8 | A decision counts only for its exact version; no self-approval; one per member | **Verified** | Workflow unit and property tests (stale version → refused; author never in approvals; duplicates are no-ops) |
| I9 | Simplified transfers zero all balances; ≤ n−1 transfers | **Verified** | Property test applies the suggested transfers as settlements → all balances 0. Transfers above the per-amount cap are split (found by property testing, see below) |
| I10 | Split output identical on client and server | **Verified (Node)** | Engine matches the independent Python oracle on 338 vectors. A mutation check (flipping the tie-break) breaks 66 vectors, so the test is sensitive. **R1:** run the same vectors on Hermes (React Native) and in browsers |
| I11 | Removed members can't read group data beyond their own balance view | **Verified (DB)** | RLS test: a former member sees only their own balance, their settlements and the expenses that involved them, no chat, and cannot write; outsiders see nothing ([schema.test.ts](../tests/db/schema.test.ts)). **Still open:** endpoint × role matrix test in M3 |
| I12 | Account deletion leaves other members' balances unchanged | **Verified (DB)** | Deleting the auth user unlinks the member (`on delete set null`); balances are unchanged and reconciliation is clean ([schema.test.ts](../tests/db/schema.test.ts)). **Still open:** the in-app deletion flow (M4) |

## Additional requirements checked in R0

| Requirement | Status | Evidence |
|---|---|---|
| Concurrent edits never silently overwrite | **Verified (domain)** | Every member mutation carries `baseVersion`; stale writes → `stale_version`. Unit test of two phones editing the same version; property test asserts no stale write ever applies. **R1:** row lock per expense, and an API returning 409 |
| Refunds | **Verified** | Refund = exact mirror of the expense (including FX plus multi-payer); partial refund equals the net expense |
| Multi-currency | **Verified** | Ledger currencies with 0, 2 and 3 decimals; convert once, then allocate exactly; rate correction = reverse + repost; rounding to zero and overflow rejected |
| Rounding fairness | **Verified (statistical)** | Leftover units rotate across members within ±15% of an even share (UUID member ids, 3–7 members) |
| Settlement correctness | **Verified** | Payer-recorded waits for the receiver; receiver-recorded posts; confirm retries are no-ops; void reverses exactly; journal refuses double posting |
| Over-payment warning | **Verified** | `settlementWarnings` unit tests |

## Defects found and fixed in R0
1. **Biased rounding tie-break.** Raw FNV-1a gave one member the extra unit about 50% of the time instead of about 33%. Fixed with the murmur3 finaliser; covered by fairness tests.
2. **Oversized settle-up suggestions.** Balances accumulated over many expenses can exceed the per-amount cap (₹1,000 crore), so `simplifyDebts` suggested a transfer that `settlementPostings` refused. Fixed by splitting such transfers; regression test added. Found by a property test that failed intermittently.
3. **Vacuous simulation (test-quality defect).** The first version of the random command simulation reached only 3 expense posts in 1,500 runs. Generator re-weighted; the test now asserts each path (expense post/reverse, settlement post/reverse, replays) is exercised more than 20 times. Typical counts are in the hundreds, or tens of thousands for replays.
