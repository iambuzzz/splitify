# Expense workflow: transition table

Source of truth: [`packages/workflow/src/expense.ts`](../packages/workflow/src/expense.ts) and
[`suggestion.ts`](../packages/workflow/src/suggestion.ts). The tests in `packages/workflow/test/` cover every
row below. Update this table whenever a transition changes.

**Terms**
- **Expense owner**: the creator, and the payer if different.
- **Group admin**: a member with the `owner` or `admin` group role.
- **Affected**: current members whose share or payment the expense touches.
- **Eligible reviewer**: an affected member other than the review's author.
- **Counted**: `postedVersion ≠ null`, so the expense's postings are in the ledger. This is true **iff** the status is `active`.

## Expense

| From | Action | Who | Result | Ledger effects |
|---|---|---|---|---|
| draft | submit | expense owner | → active (review off, or amount < threshold) | post v |
| draft | submit | expense owner | → in_review (create) | — |
| draft | edit | expense owner | stays draft, v+1 | — |
| draft | delete | expense owner | → deleted (not restorable) | — |
| in_review (create) | approve(v) | eligible, v = review version | approvals += actor; if satisfied → active | post v |
| in_review (create) | decline(v, reason) | eligible | → draft | — |
| in_review (create) | withdraw_review | review author | → draft | — |
| in_review (create) | edit, material | expense owner | review restarts on v+1, approvals cleared | — |
| in_review (create) | edit, non-material | expense owner | v+1, review version and approvals kept | — |
| active | edit, material, below threshold | expense owner | v+1, disputes cleared | reverse old, post new |
| active | edit, material, ≥ threshold (old or new amount) | expense owner | review (edit) opens on v+1; **old version stays counted** | — |
| active + review (edit) | approve(v) satisfied | eligible | review closes, disputes cleared | reverse old, post v |
| active + review (edit) | decline(v, reason) / withdraw_review | eligible / author | review closes; old version unchanged | — |
| active | edit, non-material | expense owner | v+1 | — |
| active | dispute(reason) | affected non-owner | adds to `disputedBy` (idempotent) | — |
| active | withdraw_dispute | the disputer | removes them | — |
| active / in_review | delete | expense owner, or group admin (flagged `admin_override`) | → deleted; restorable if it was counted | reverse (if counted) |
| deleted | restore | expense owner, or group admin (flagged) | → active with the last counted version | post v |
| any with review | reevaluate_review | system (on membership change) | passes if the remaining eligible members no longer require more OKs | as for approve |

**Review requirement:** `required = min(K, eligible count)`. Approvals from members who are no longer eligible don't count. With nobody eligible, the review passes immediately.

**Concurrency:** `submit`, `edit`, `delete`, `restore` and `dispute` carry `baseVersion`, the version the client last saw. If it isn't the current version, the action is refused with `stale_version` (HTTP 409). The client reloads, shows the other person's change as a diff, and lets the user re-apply. Nothing is silently overwritten. The server must apply transitions for one expense one at a time (a row lock in R1).

**Refusals:** `forbidden` (wrong role) · `not_eligible` (not an eligible reviewer/disputer) · `stale_version` (decision names an old version) · `reason_required` · `invalid_state`. Duplicate approvals and disputes succeed as no-ops (`duplicate: true`), so client retries are safe.

## Suggestion

| From | Action | Who | Result |
|---|---|---|---|
| open | accept | expense owner, and the expense is still at `baseVersion` | → accepted; caller applies it as an owner edit (review rules apply) |
| open | accept | expense owner, expense has changed | refused: `stale_version` |
| open | decline(reason) | expense owner | → declined |
| open | withdraw | suggestion author | → withdrawn |
| open | mark_outdated | system, expense version ≠ `baseVersion` | → outdated |
| closed (any) | anything | — | refused: `invalid_state` |

Group admins cannot accept, decline or directly edit someone else's expense. Nobody can modify ledger rows directly.

## Settlement

Source: [`settlement.ts`](../packages/workflow/src/settlement.ts). "Verified" does not exist in v1: it needs payment-provider evidence.

| From | Action | Who | Result | Ledger effects |
|---|---|---|---|---|
| — | record | payer ("I paid B") | → awaiting_confirmation | — (not counted) |
| — | record | receiver ("B paid me") | → confirmed | post |
| — | record | anyone else, self-payment, amount ≤ 0 | refused | — |
| awaiting_confirmation | confirm | receiver | → confirmed | post |
| confirmed | confirm (retry) | receiver | no-op (`duplicate: true`) | — |
| awaiting_confirmation | decline(reason) | receiver | → declined | — |
| awaiting_confirmation | withdraw | whoever recorded it | → withdrawn | — |
| confirmed | void(reason) | receiver (e.g. UPI reversed) | → voided | reverse |
| declined / withdrawn / voided | anything | — | refused: `invalid_state` | — |

The ledger journal also refuses a second `post` for the same settlement, so a duplicated confirmation can never be counted twice, even if the workflow layer were bypassed.

