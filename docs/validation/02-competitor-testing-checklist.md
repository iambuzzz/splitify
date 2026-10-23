# R0 Competitor Testing Checklist

**Goal:** replace the "?" cells in the competitor matrix ([PLAN.md §2](../PLAN.md)) with **observed** behaviour, and record what competitors do well, so we copy the good patterns and avoid their friction.

**Apps:** Splitwise, Tricount, Splid, Settle Up, Spliit (web), Kittysplit (web/app). Optional: Splitser, TravelSpend.

---

## Rules (lawful testing only)

- Use **our own test accounts, devices and made-up data**. Never use real friends' data or anyone else's account.
- Normal app use only. **No** decompiling, traffic interception of other people's data, private APIs, or bypassing paywalls/limits.
- Paying for a Pro/Premium tier to observe it is fine. Record the price shown in the India store.
- Don't copy branding, text or assets. Screenshots are for internal notes only.
- Label every finding **Observed** (we saw it), **Claimed** (store/website says so) or **Unknown**.

## Setup

| Item | Detail |
|---|---|
| Devices | 1 Android (record model + OS), 1 iPhone (model + iOS), 1 laptop browser (Chrome) |
| Test identities | 4 test accounts: **Asha** (organiser), **Bilal**, **Chitra**, **Dev**, using separate test email addresses you control |
| Region / store | India store; note the date tested, app version and price shown |
| Recording | Screen recording on, notifications visible, airplane mode available |
| Evidence folder | `research/competitors/<app>/<scenario>/` (screenshots + notes; keep out of git if they contain account emails) |

---

## The 8 scripted scenarios (run each in every app)

For each, record: **steps taken (tap count), time, what each member sees, notifications received (exact text and whether amounts show on the lock screen), errors, empty states, and anything confusing.**

### S1. Hotel ₹6,000 shared by four
Asha creates group "Goa Test", invites Bilal/Chitra/Dev (by link if possible), adds "Hotel ₹6,000, paid by Asha, split equally".
- [ ] Can invitees join without installing? Without an account?
- [ ] Taps from app open to saved expense
- [ ] Do others get notified? What does the notification say?
- [ ] Does it count immediately, or is there any review/approval?

### S2. Late arrival: unequal split
Chitra arrived a day later: change the hotel to nights 3/3/2/3 (or the closest the app allows).
- [ ] Which split types exist (equal, exact, %, shares/weights, itemised)?
- [ ] Is there a "shares/nights" style option, or must you calculate amounts manually?
- [ ] How are the leftover paise rounded? Who gets them? (₹6,000 ÷ 11 shares)

### S3. Edit by someone else, after the fact
Bilal (not the creator) edits the hotel amount to ₹5,400.
- [ ] Can a non-creator edit? Can they delete?
- [ ] Is Asha notified? Is the change shown as a **diff** (old → new)?
- [ ] Is there an edit history? Who/when/what is visible?
- [ ] Can anyone object, comment or dispute in the app?

### S4. Delete and restore
Dev adds "Taxi ₹900" then deletes it.
- [ ] Who is notified? Can it be restored, and by whom?
- [ ] Does the activity log show the deletion?

### S5. Foreign-currency expense
Add "Dinner €100 paid by Bilal, split equally" in an INR group.
- [ ] Is conversion automatic? Which rate (shown? editable?) Is this a paid feature?
- [ ] Are balances shown in one currency or several?
- [ ] Does editing the rate later recalculate balances?

### S6. Partial settlement
Chitra pays Asha ₹1,000 of a larger debt.
- [ ] Who can record a payment (payer, receiver, anyone)?
- [ ] Does the receiver confirm? Is there an "awaiting confirmation" state?
- [ ] Any UPI/payment integration in India? What happens when you tap it?
- [ ] Settle-up suggestions: how many transfers? Is "simplify debts" on by default?

### S7. Remove a member who still owes money
Asha removes Dev while Dev has a non-zero balance.
- [ ] Is it blocked, warned, or allowed silently?
- [ ] What does Dev still see afterwards? What happens to his history?

### S8. Export → import
Export the group (CSV/PDF/Excel), then import it into another app if supported (e.g. Splitwise CSV into Splitser/Spliit).
- [ ] Formats available, free vs paid
- [ ] What's lost (receipts, history, per-person paid/owed)?

### Extra observations (any time)
- [ ] Free-tier limits hit (daily caps, ads, paywalls): exact message and when
- [ ] Offline: add an expense in airplane mode, then reconnect. Duplicates? Conflicts?
- [ ] Receipt attach/scan: free or paid? OCR quality on a test receipt
- [ ] Comments/chat on expenses? Group chat?
- [ ] Roles/permissions/admin?
- [ ] Accessibility spot-check: VoiceOver/TalkBack read amounts correctly? Text scaling at 200%?

---

## Results matrix (fill one column per app)

| Dimension | Splitwise | Tricount | Splid | Settle Up | Spliit | Kittysplit |
|---|---|---|---|---|---|---|
| Version / date / price (India) | | | | | | |
| Join without install / account | | | | | | |
| Split types | | | | | | |
| Shares/nights helper | | | | | | |
| Rounding behaviour | | | | | | |
| Non-creator can edit / delete | | | | | | |
| Change notification shows diff | | | | | | |
| Edit history | | | | | | |
| Comments on expense | | | | | | |
| Group chat | | | | | | |
| Approval / dispute | | | | | | |
| Roles / admin | | | | | | |
| Restore deleted | | | | | | |
| Multi-currency (auto rate / editable) | | | | | | |
| Balances single vs multi currency | | | | | | |
| Who records payments / receiver confirms | | | | | | |
| UPI / payment integration | | | | | | |
| Simplify debts default | | | | | | |
| Member removal with balance | | | | | | |
| Export formats (free/paid) | | | | | | |
| Import from others | | | | | | |
| Offline add + sync behaviour | | | | | | |
| Receipt attach / OCR (free/paid) | | | | | | |
| Free-tier limits / ads | | | | | | |
| Lock-screen notification privacy | | | | | | |
| Accessibility spot-check | | | | | | |

Mark each cell **O** (observed), **C** (claimed) or **?** (unknown), plus a short note.

## Teardown summary (one page per app)
1. Who it's for, and its positioning
2. Best thing to learn from (with screenshot reference)
3. Biggest friction we saw (with steps and screenshot)
4. Where our plan is genuinely better, and where it is **not** (be honest)
5. Anything that changes our plan → list it as a proposed plan change
