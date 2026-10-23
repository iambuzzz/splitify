# Pricing Test Kit (R0 interviews + R2 beta fake door)

**Hypothesis ([PLAN.md §14](../PLAN.md)):** the core stays free with no daily caps and no ads. A **one-time group pass** (per trip/group) unlocks OCR, the forwarding inbox, PDF/Excel export and insights for every member. We don't yet know whether people will pay, or how much.

| Stage | Method | Answers |
|---|---|---|
| **R0** (now) | Van Westendorp price questions + a past-spend question, inside the interviews | Acceptable price range; who in a group would pay |
| **R2** (beta) | Fake-door "Group pass" button in the app | Real click-through intent (go/no-go: ≥5% go, <2% rethink) |
| **R3** | Real in-app purchase | Conversion and refunds |

---

## Part A: R0 interview questions (5 minutes, end of interview)

Ask these **after** section E of the interview script ([01](01-interview-script-and-screener.md)), before the wrap-up. Ask about past behaviour first.

**A1. Past spend (behaviour):** "Have you ever paid for an app or tool to manage group money (Splitwise Pro, Settle Up Premium, anything)? What did you pay, and why?" Record the amount and the reason.

**A2. Describe the pass neutrally, then ask Van Westendorp's four questions.** Read exactly:
> "Imagine a group expense app where the basic version is free with no limits. For one trip or group, someone can buy a **Group pass** that unlocks, for everyone in that group: scanning receipts to fill in amounts automatically, forwarding booking emails to create expenses, a PDF/Excel summary, and spending insights. It's a one-time payment for that group, not a subscription."

Then, in this order (record a rupee number for each):
1. "At what price would this Group pass be **so cheap** that you'd doubt its quality?"
2. "At what price would it be **a bargain**, a great buy for the money?"
3. "At what price would it start to feel **expensive**, but you'd still consider it?"
4. "At what price would it be **too expensive** to consider?"

**A3. Who pays:** "On your last trip, who in the group would have bought this, if anyone? Would you split the cost?"

**A4. What matters:** "Which one of these would make you actually buy it: receipt scanning, email forwarding, PDF summary, or insights? Or none?"

**Rules:**
- Don't anchor. Never mention ₹99 or any competitor price before A2 is done.
- If the answers are illogical (too cheap > bargain), ask once to clarify, then record what they say.
- Don't treat stated prices as willingness to pay. They give a range only. The fake door and the real purchase are the evidence.

## Part B: R0 analysis

1. Put each participant's four answers in a sheet (`too_cheap`, `bargain`, `expensive`, `too_expensive`).
2. For each price from ₹0 to ₹500 in steps of ₹10, compute the share of participants for whom:
   - the price is ≥ their `too_cheap` (reverse cumulative "too cheap")
   - the price is ≥ their `bargain` (reverse cumulative "not a bargain")
   - the price is ≥ their `expensive` ("expensive")
   - the price is ≥ their `too_expensive` ("too expensive")
3. Plot the curves. The usual reading is:
   - **Point of marginal cheapness:** "too cheap" crosses "not a bargain".
   - **Point of marginal expensiveness:** "not a bargain" crosses "expensive".
   - The **acceptable range** lies between the two.
4. With 15–20 interviews, this gives a **rough range only**. Report it as such, with n.
5. Also report the share with past paid usage (A1), who would pay (A3), and the feature that drives buying (A4).

**Decision for the R2 fake door:** test **two prices** inside the acceptable range (for example the lower bound and the midpoint), split randomly between groups.

## Part C: R2 beta fake door (spec for later; not built in R0)

| Item | Spec |
|---|---|
| Placement | (1) A "Group pass" row in group settings; (2) contextually, when someone taps a pass feature (e.g. "Scan receipt") |
| Copy | "**Group pass ₹{price}** — one-time, for everyone in {group}. Unlocks receipt scan, email forwarding, PDF/Excel export, insights." Button: **Get Group pass** |
| On tap | Honest message: "Thanks! Group pass isn't available yet. We're checking whether people want it. We'll let you know when it launches, and early groups get it free." Optional: **Notify me** |
| Never | Charge money, ask for payment details, or pretend a purchase happened |
| Randomisation | By group, not by user (one price per group), 50/50 between the two prices |
| Events | `pass_impression` (group, placement, price), `pass_tap`, `pass_notify_me` |
| Metric | Groups with ≥1 tap / groups shown the pass, per price; 4-week window |
| Go/no-go | ≥5% of active groups tap → build the real purchase (R3). <2% → rethink: a different bundle, a lower price, or no pass |
| Ethics | One fake door per group; after launch, honour the "early groups get it free" promise |

## Part D: store and legal notes (for R3, verify then)
- Digital unlocks inside iOS and Android apps normally must use **in-app purchase** (Apple App Store guideline 3.1.1; Google Play billing policy). Re-check both policies and any India-specific alternative-billing rules before building.
- Show prices in INR, with tax included as the stores require.
- Refund handling follows the store's rules.
