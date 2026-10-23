# Expense platform (working name TBD)

A group expense app that keeps the money record next to the group's WhatsApp chat:
transparent edits, suggestions, disputes, optional review, and balances you can explain.

**Status: R1 in progress.** The app UI runs on demo data (`npm run app`). There is no API or database yet. See [docs/R1-PLAN.md](docs/R1-PLAN.md).

- Current status and next steps: [docs/STATUS.md](docs/STATUS.md)
- Product and technical plan: [docs/PLAN.md](docs/PLAN.md)
- Money invariants and their verification status: [docs/invariants.md](docs/invariants.md)
- Expense / suggestion / settlement rules: [docs/workflow-transitions.md](docs/workflow-transitions.md)
- R0 validation kits: [docs/validation/](docs/validation/)
- Supabase setup for R1: [docs/r1-supabase-setup.md](docs/r1-supabase-setup.md)

## Packages

| Package | Purpose |
|---|---|
| `apps/client` | Splitify app (Expo: Android, iOS, web), 4 themes, demo data for now |
| `packages/money` | Currencies, exact minor-unit amounts, fair allocation, exchange-rate conversion |
| `packages/ledger` | Split engine, postings, balances, debt simplification, append-only journal, reconciliation |
| `packages/workflow` | Expense / review / suggestion / settlement state machines, idempotency model |
| `tests/integration` | Cross-package simulation: commands → workflow → journal → reconciliation |
| `tools/reference/oracle.py` | Independent Python implementation used to generate golden test vectors |

All packages are pure TypeScript with no I/O, to be shared by the future API and client.

## Requirements

Node.js `^22.12.0 || ^24.0.0 || >=26.0.0` (CI runs 22 and 24) and the npm bundled with it.

## Commands

```sh
npm ci              # install exactly what package-lock.json pins
npm run check       # typecheck (packages + app) + all tests
npm run app         # Splitify in the browser at http://localhost:8081
npm run coverage    # tests with coverage thresholds
npm audit           # dependency vulnerabilities

# Regenerate golden vectors (only when the split/rounding spec intentionally changes):
python3 tools/reference/oracle.py > packages/ledger/test/golden/vectors.json
```
