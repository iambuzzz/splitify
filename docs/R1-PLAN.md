# R1 Build Plan: Splitify private alpha ("correct splitter")

Started 2026-10-22, after the design was approved. Scope is [PLAN.md §13](PLAN.md), R1 row. The R0 user research (interviews, UPI test, competitor tests) continues in parallel; its results may change R2+.

Design: https://claude.ai/artifact/9fvZ9L6GvgHwt2KpmxqH6u. R1 ships 4 themes with an in-app switcher:

| Theme | Family | Mode |
|---|---|---|
| Mint | A (cards) | light |
| Neon Lime | A (cards) | dark |
| Receipt | B (bill) | light |
| Thermal | B (bill) | dark |

Themes are data (tokens: colours, fonts, radii) plus a small set of **skinned components** (balance card, expense row, sticky/suggestion card, buttons) that render the A or B look. Screens are written once against these components, so adding a theme later is mostly a new token file.

## Milestones

| # | Milestone | What you can see / test | Status |
|---|---|---|---|
| M1 | Expo app shell, theme system + switcher, all R1 screens on local demo data (real money engine) | App runs in the browser and on a phone via Expo Go; switch between the 4 themes | **Done (demo data)** |
| M2 | Database schema (Supabase migrations), RLS, ledger tables append-only (I4), reconciliation job (I5) | Tables visible in the Supabase dashboard | **Done** (pushed to expense-dev 2026-10-22) |
| M3 | Node/Fastify API: groups, members, invites, expenses (versions, suggestions), settlements, idempotency (I7) | API tests green | **Done locally 2026-10-23** (28 API tests green; see [api.md](api.md)). Migration `20261023090000_api_support.sql` still to push |
| M4 | Sign-in (email OTP, then Google), invite links, client wired to the API | Real sign-in, data saved | **Done, live 2026-10-24** at https://splitify.iambuzzdev.in ([deploy.md](deploy.md)): email code + button (Resend, from login@splitify.iambuzzdev.in), Google sign-in on the web (our own `/auth/google` return + `signInWithIdToken`, so Google names iambuzzdev.in, not the Supabase project), invite links, app on the API. Google on the phone apps still to do |
| M5 | Receipts upload, history and diffs, "Why?", CSV export, Splitwise CSV import, share to WhatsApp + deep links | Full alpha flow | Not started |
| M6 | Mobile offline queue, Sentry, backups, alpha with 5 real groups | Exit criteria: 2 weeks, reconciliation 0 diffs | Not started |

## Known risks
- **TypeScript 7 and Expo tooling.** TS 7 has no programmatic API. If Expo or Metro tooling needs one, the client uses TypeScript 6 locally.
- **Two layout families.** They roughly double the work for the skinned components only. Screens stay shared.
- **No Apple Developer account yet.** iPhone testing via Expo Go only. App Store/TestFlight later.

## M1 result (2026-10-22)
- `apps/client`: Expo SDK 58, React Native 0.88, Expo Router, TypeScript 6 (Expo tooling). Run `npm run app`, then open http://localhost:8081. Add `?theme=neon-lime`, `receipt` or `thermal` to open a theme directly.
- Screens: Home, Group (list or bill), Add/Edit/Suggest expense (equal or by nights; keypad + nights grid in bill themes), Expense detail (suggestion accept/keep, questions, history, "something's wrong"), Settle up (confirm, remind on WhatsApp, record UPI/cash), New group. Laptop: sidebar + list/detail side by side.
- Data is local demo data (resets on reload). Money uses the real `@app/ledger` engine. Tests: `tests/client-model.test.ts`.
- Not yet: sign-in, database, saving, offline, receipts, export/import.

## M1 browser QA (2026-10-22)
Tested in Chrome (Playwright, headless) on a 390px phone, a 320px small phone and a 1440px laptop, in all 4 themes: 23 click-through checks pass, with no console errors. WCAG AA contrast passes for every theme colour pair. Fixed:
- **Delete:** now asks first and says how your balance changes (deleting a settled bill reopens it). Deleted expenses stay restorable: on laptop the panel keeps Restore, and the list has "Deleted (n)".
- **Group balance:** it stays visible when the expenses are gone but money is still owed. The line under it now comes from the suggested payments ("From Chitra ₹1,800 · …"), not raw balances.
- **Empty states:** a new group gets an empty state with Invite. Settle buttons are hidden when nobody owes anything.
- **Suggest form:** no longer shows "Paid by" (a suggestion can't change it). The current amount is shown.
- **Inputs:** browser focus box replaced by a themed focus border. Enter submits the forms and the question/reply boxes.
- **Laptop layout:** the Save/Create button sits under the form. Expense links open the two-pane group view. The theme picker is a centred dialog. Rows get hover.
- **Small details:**
  - Each person has the same avatar colour everywhere.
  - Fixed "You suggests" and "pays You".
  - Payment items say "Check".
  - Chai/coffee get the food icon.
- **Small screens and big amounts:** long amounts shrink instead of wrapping. Long titles stay on one line. The reply box fits at 320px.
- **Receipt theme:** the "owe" colour was darkened for contrast (4.2 → 4.5+).

## M2 result (2026-10-22)
- 3 migrations in `supabase/migrations/`; design and API rules in [db-schema.md](db-schema.md).
- 23 database tests (PGlite, no Docker needed), including 25 random histories checked against `@app/ledger` and a mutation check. Also smoke-tested on Postgres 17.11 (Docker).
- Invariants now enforced in the database: I1, I2, I4, I8, the settlement rules, I11 (RLS), I12. Reconciliation (I5) exists; the nightly schedule comes in M6.

## Dependency security note (2026-10-22)
`npm audit` reports 19 high findings, all from two advisories in Expo's **developer tooling**, with **no patched version published**:
- `braces` ≤3.0.3, GHSA-vfj7-8cjw-p6xm: deep nested patterns can exhaust the stack (DoS). Used by Metro/file watching at build time.
- `node-forge` ≤1.4.0, GHSA-86w9-cpqp-85rv: RSA signature verification accepts extra nested data. Used by the Expo CLI for code signing; we don't use signed updates.

Neither runs in the shipped app. `npm audit fix --force` would downgrade to Expo 44, which is worse, so it was not run.

**Decision (user, 2026-10-22): CI exception "known, waiting for a fix".** `npm run audit` ([tools/audit-check.mjs](../tools/audit-check.mjs)) runs `npm audit` against [audit-allowlist.json](../audit-allowlist.json), which lists only these two advisory IDs, each with a reason and a review date (2026-11-22). CI fails on any other advisory, at any severity, and when a review date passes. When a patch lands, update the dependency and remove the entry.
