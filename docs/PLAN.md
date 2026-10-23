# Group Expense & Financial Collaboration Platform: Research and Plan, Revision 3

> **Rev 3 clarification (from you):** we are **not** replacing WhatsApp or building a general messenger. WhatsApp stays the place for personal and general conversation. In-app conversation exists **only to support expense management and financial collaboration**. General messages are allowed but stay lightweight. Changes are listed in **§R3** right below.

---

## Rev 3.1 refinement (2026-10-23, user decision)
After the first live test, the user chose the money-focused versions of personal chat and presence:
- **Personal chat:** a 1:1 settle-up page per pair (balance, payments, private thread). No general DMs.
- **Expense threads:** readable only by the people in the expense.
- **Seen:** on money items only (an expense version, a payment, a pair thread). No online status and no per-message delivery or read ticks.
- **Live updates:** within about 3 seconds while the app is open.

## §R3: What changed in Revision 3 and why
| Area | Rev 2 | Rev 3 | Why |
|---|---|---|---|
| Positioning | "Nobody's numbers change behind their back", with chat as "one place" | **"Keep chatting on WhatsApp. Keep the money here."** The app is the group's **money room**: the record, the receipts, the questions about them, and the decisions | Matches your vision; avoids an unwinnable fight with WhatsApp; clearer pitch |
| Conversation design | Main group chat plus expense threads (messenger-shaped) | **Expense-centred timeline.** Financial records and system updates are the backbone. **Structured, actionable cards** (Question, Suggestion with diff, Review, Dispute, Settlement, Receipt) sit inline. Expense threads hold the discussion. Plain general messages are allowed but are secondary (§4) | Discussion is anchored to records, so nothing gets lost in a scroll |
| Messenger features | Deferred reactions, read receipts, typing, voice, chat search | **Explicitly out of scope** (not "deferred"): voice/video, stickers/GIFs, typing, presence, read receipts, DMs, forwarding, link previews, stories, polls. Kept: text, reply, @mention, photos/PDFs, edit/delete own, report/block, mute | Avoids over-engineering; less moderation and cost |
| WhatsApp relationship | Implicit competitor | **Bridge**: share expense cards, balance summaries, settle-up plans and payment-request pages to WhatsApp, with deep links back to the exact expense or thread | Uses the channel people already use |
| Success metrics | Human messages per week; displacement of WhatsApp | **Expense-collaboration outcomes**: questions resolved in-app, time-to-resolution, % of material changes seen by affected members, disputes resolved, pre-settlement "all clear" rate (§12.5) | Measures what the conversation is *for* |
| Kill switch | Collapse main chat if message volume is low | Low general-message volume is **fine**. The switch triggers only if *expense-linked* collaboration is unused (§4) | General chat isn't the goal |
| Data model | `conversation` kinds group/expense/settlement | **Simpler:** one `messages` table with an optional anchor (`expense_id` / `settlement_id`). The group timeline = unanchored messages plus activity cards (§7.3) | Less machinery; one source of truth |
| Notifications | Group messages on for small groups | General messages **off by default** (digest only). Questions to me, @mentions, items needing my action and changes affecting me stay **on** | Avoids the WhatsApp-style noise users already hate |
| New features | — | **Feature opportunity evaluation (§3A)**: about 30 ideas scored on value / usability / complexity / cost / reliability risk, split into launch essentials vs later. New launch items: **Needs-your-action inbox**, **duplicate detection**, **Question cards with resolved state**, **pre-settlement check**, **stay/days-based split**, **undo**, **WhatsApp share cards plus deep links**, **trip close-out** | Make sharing easier, smarter, more transparent and more reliable |
| Roadmap | R2 = threads plus group chat lite | R2 = **expense-centred collaboration** (timeline, structured cards, inbox, close-out). R3 adds **itemised bills**, OCR, forwarding inbox, payment-request page. Pot/kitty and recurring come later (§13) | Value-ordered |
| Validation | "Willing to chat in-app?" | "How do expense questions get resolved today, how long does it take, and what gets lost in WhatsApp scroll?" plus behavioural metrics (§12) | Tests the real job, not chat appetite |

> Working name **TBD**. Status: **planning only**. No code, files or dependencies until you approve.
> Evidence date 2026-10-22. Labels: **[V]** verified from an official or primary source this session · **[C]** vendor claim, store listing or third-party summary · **[CF]** community feedback (anecdotal) · **[H]** our hypothesis · **[U]** unknown.
> **Honesty note:** all research is desk research (official pages, store listings, docs, reviews). **No competitor app has been installed or tested hands-on yet.** That happens in R0 (§12.2) with our own test accounts and data.

---

## 0. Context

You gave two near-identical briefs, now merged. Revision 1 was rejected as not critical enough. This revision starts with a **critical review** (Part A), then gives the corrected plan (Part B).
Repository state: `/Users/iambuzz/CODING/Projects/Expense` is **empty** (not a git repo). Greenfield, nothing to preserve.

---

# PART A: Critical review of Revision 1

### A.1 What Revision 1 got wrong (summary)
1. **It treated "approvals" as the product.** The bigger, better-evidenced pain is **silent or unilateral edits** and **unexplained balances**. Splitwise's own help centre carries FAQs titled *"Why can other people edit or delete expenses that I add?"* and *"Can I set a 'group admin', or set different permissions for different group members?"* [V, titles on feedback.splitwise.com]. A user asks Splitwise-style apps for a *full diff* of edits/deletions in activity logs [CF]. The fix is a better **editing model**, not a heavy approval engine.
2. **The policy engine was too complex for friends.** It had three modes, lazy consensus, category rules, an approver flag, exact minimum-transfer search, and a 4-role matrix. Each is defensible alone, but together they produce a settings screen nobody understands.
3. **Chat was deferred for convenience, not user value.** The expensive parts of chat are realtime delivery, push, attachments, moderation (report/block, a legal requirement) and offline queues. **Expense threads need all of them anyway.** Once threads exist, adding one main group conversation is mostly incremental UI.
4. **Per-currency balances were the wrong default** for the beachhead (trips). They push users into manual conversion and complicate settle-up.
5. **The ledger was keyed to users.** It must be keyed to **group members** so placeholders, account claims and account deletion never touch financial history.
6. **Desktop via Tauri in the core roadmap** adds code signing, notarisation, auto-update and Linux packaging for little proven value. An installable web app covers Windows, macOS and Linux first.
7. **Offline scope was vague.** Full offline everywhere is expensive. It must be scoped per operation and per platform.
8. **Operations were missing:** backups and restore drills, reconciliation, observability, incident runbooks, account recovery, App Store UGC rules.
9. **Factual corrections:** the Apple login rule (4.8) requires *an equivalent privacy-focused login option*, which Sign in with Apple satisfies; it is not a blanket "SIWA required" [C, Apple forums quoting the guideline]. goDutch is **inactive** (YC directory) [V], so it is evidence that "chat + split + payments" alone did not sustain a company (cause [U]). Splid's official site publishes no feature detail [V], so its claims stay [C].
10. **Estimates were optimistic.** 15 weeks to the differentiating release was unrealistic for one person once chat, push, moderation, offline and stores are included.

### A.2 Major changes: what, why, cost and measurement
| # | Problem in Rev 1 | Improvement | User benefit | Evidence / reasoning | Trade-off / cost | Success measure |
|---|---|---|---|---|---|---|
| **1** | Approval engine was the centrepiece | **"Owner edits, others suggest" as the default.** The creator or payer edits directly, and every material edit notifies affected members with a **diff plus one-tap Dispute**. Others submit a **suggested change** that the owner accepts in one tap. **Review mode** (approvals) is an opt-in group setting with **one rule**: expenses ≥ ₹X need K OKs from affected members | Mistakes get fixed fast, nobody's numbers change silently, no bureaucracy | Splitwise FAQ titles [V]; diff request [CF]; approval demand unproven [H] | Less configurability (no category/role/delegation rules in v1) | ≥80% of suggestions resolved within 48h; <5% of groups turn Review mode on and then off within 7 days |
| **2** | Group chat in Phase 3, gated | *(Superseded by Rev 3.)* An **expense-centred timeline with structured cards** ships in the first public release, on the same infrastructure as expense threads. General messages are allowed and lightweight. Messenger features are out of scope | Questions, receipts, corrections and decisions stay attached to the record | Shared infrastructure cost [reasoning]; your clarification that WhatsApp stays for general chat | About 2 extra weeks over threads-only; moderation obligations apply anyway | ≥60% of expense questions asked in-app get marked resolved; median question→resolution under 24h; ≥25% of corrections start from a card or thread |
| **3** | Per-currency balances | **One ledger currency per group.** Foreign expenses keep their original amount plus a **stored, editable rate** (default from a reference-rate feed). Balances and settle-up use a single currency | Trips "just work"; the actual card rate can be entered | Tricount's model converts per expense into the group currency [C]; simpler settle-up | Not ideal for groups that truly settle in several currencies (deferred "keep currencies separate" mode) | Zero support tickets about "why two balances"; FX expenses ≥10% of trip expenses |
| **4** | Rounding tie-break favoured the same members | Largest-remainder with tie-break **seeded by expense id** (deterministic, but extra paise rotate across members) | Fair over hundreds of expenses | Fixed member order systematically overcharges the same person [reasoning] | Slightly harder to explain; documented in "How we split" | Property test: over 10k equal splits, the per-member rounding skew is at most 1 minor unit × √n bound |
| **5** | Ledger keyed to users | Ledger references **`group_member_id`**. Users link to members. Placeholders, claims, merges and deletions only change the link | Add friends before they sign up; deleting an account never breaks others' balances | Placeholders are universal in competitors [C] | One indirection | Claim and delete flows pass the reconciliation invariant |
| **6** | Tauri desktop in the roadmap | **Installable web app (PWA) for Windows, macOS and Linux in the public beta.** macOS 14+ Safari "Add to Dock" supports notifications and badges [V Apple support]; Chromium installs PWAs on all three [known, re-verify]. **Tauri only if** a validated need appears (tray, OS-level background notifications) | Desktop users get the full app without installers | Removes signing, notarisation and update pipelines | No offline writes on desktop in v1; no Mac App Store or Microsoft Store presence | Desktop share of weekly users; requests for a native app |
| **7** | Vague offline | **Per-operation offline matrix** (§7.4). Mobile: cached reads, create/edit own expenses, queued messages. Web/desktop: online-only in v1. Approvals, suggestion decisions, settlement confirmations and membership changes are **online-only** | Works on a mountain trip without false promises | Offline is a competitor selling point (Splid, Settle Up [C]) | Web users can't add while offline in v1 | 0 duplicate records from replays; ≥99.9% of queued ops applied or explicitly rejected with a reason |
| **8** | Ops missing | Backups plus monthly **restore drill**, nightly **ledger reconciliation**, error tracking, structured logs and traces, SLOs, incident runbook, status page | Trust that the data never silently drifts | Correctness is the brand promise | About 1 week, plus monitoring costs | Reconciliation mismatches = 0; restore drill RTO ≤ 4h, RPO ≤ 5 min (with PITR) |
| **9** | Auth undecided | **Supabase Auth plus Postgres plus Storage (managed), Node/TS API as the sole writer of domain data** | Fast, reliable sign-in (Google, Apple, email OTP) and fewer ops | Supabase free tier is 50k MAU, Pro is 100k MAU [V pricing page via search]; Postgres stays portable | Moderate lock-in on auth; PITR is a paid add-on ($100/mo for 7 days) [V] | Sign-in success ≥98%; time-to-first-group under 60 s |
| **10** | Settlement could get stuck or was ambiguous | Payment **recorded by the receiver posts immediately**. Payment **recorded by the payer shows as "awaiting confirmation"** (visible, not in the ledger) until the receiver taps *Received*, with a reminder at 48h. "Verified" is reserved for provider evidence (not in v1) | Mirrors the real "sent on GPay / got it" flow, with no false claims | UPI P2P collect is banned [C, multiple outlets on NPCI circular]; no verification without a regulated partner | Some balances wait on the receiver | Median confirm time under 24h; <2% disputed settlements |
| **11** | 4 roles plus approver flag | **3 roles: Owner, Admin, Member.** Guest/viewer deferred | Simpler mental model | Splitwise reportedly has equal permissions for all members [C], so even one admin level is an upgrade | Families wanting read-only kids or parents must wait | Admin features used in ≥20% of groups with 6+ members |
| **12** | Validation was thin | R0 has a screener, an interview script, a **concierge diary study** on real trips, scripted competitor tests, prototype task tests, fake-door pricing, and **kill criteria** (§12) | Avoids building the wrong thing | Demand for approvals and chat is unproven [H] | 3–4 weeks before heavy coding (ledger packages built in parallel) | Go/no-go table in §12.5 |
| **13** | Optimistic roadmap | Re-estimated with ranges: **public beta in about 24–30 weeks solo full-time** (§13) | Realistic expectations | Scope now includes chat, push, moderation and stores | Later launch | Milestones hit within ±25% |

### A.3 Things deliberately removed or deferred (and why)
Lazy-consensus timers (surprising behaviour) · category/role-based approval rules · delegation and escalation · exact minimum-transfer search (greedy is enough, at most n−1 transfers) · viewer role · **messenger features (reactions, read receipts, typing, voice, DMs, chat-wide search) are out of scope per Rev 3, not just deferred** · Tauri desktop · Gmail API · WhatsApp Business API · Instagram (no consumer value) · recurring expenses (until the home segment is targeted) · budgets · E2EE · payment verification · natural-language quick-add.

---

# PART B: Revised plan

## 1. Executive strategy
**Positioning:** *"Keep chatting on WhatsApp. Keep the money here."* The app is the group's **money room**: the authoritative record of what was spent, the receipts behind it, the questions and corrections about it, and the decisions that settled it. Nobody's numbers change behind their back, and every balance can be explained.

- **Primary differentiator:** transparent, collaborative correction *anchored to the record*. Visible diffs, one-tap suggestions, Question cards that get resolved, disputes, optional review, and a "why do I owe this?" trace.
- **Supporting 1:** **an expense-centred conversation**, not a messenger. System updates and actionable cards form the backbone. People discuss *a specific expense* in its thread. Light general messages are allowed. A **WhatsApp bridge** shares cards and summaries out and deep-links back.
- **Supporting 2:** *low-friction capture and settle-up* for India. Share a receipt to get a prefilled draft, itemised bills, UPI QR/intent handoff via a payment-request page, no daily caps, no ads.

**Not our goal:** replacing WhatsApp, social features, a general chat experience, or engagement driven by message volume.

**Beachhead (D1):** Indian college/hostel friends and trip groups (4–12 people, INR plus foreign trips).
**Table stakes we must match:** free unlimited expenses (Tricount, Splid, Spliit, Kittysplit [C/V]), all split types, receipts, multi-currency, export, import from Splitwise (Splitser runs a "switch from Splitwise" service [C], and Splitwise offers a group CSV export [C]).

## 2. Competitor research (updated)
| Product | Status / model | Evidence-backed notes | Relevance |
|---|---|---|---|
| Splitwise | Leader, freemium | Pro [V]: receipt scan plus itemization, currency conversion, search, charts, default splits, US card import. Free daily cap plus ads, cap not published [C/CF]. Help-centre FAQs on others editing/deleting and on admin/permissions [V titles]. Members reportedly have equal permissions [C]. Edit history and restore claimed [C]. "Bad UPI integration" [CF] | Main switching source; import CSV |
| Tricount (bunq) | Free | 2024 rebuild dropped Premium; export, custom categories and per-expense exchange rates were removed at relaunch, and insights later returned [C, Tricount pages via search]. Auto-adds bunq payments [C] | Free benchmark; gaps in export and control |
| Splid | Free plus one-time unlock | Offline, no sign-up, 150+ currencies, Excel paid [C]. Official site has no feature detail [V] | Offline benchmark |
| Spliit | MIT open source | [V GitHub] Next.js/Prisma/Postgres, activity tab, receipt scan opt-in, no accounts, no comments/approvals on roadmap | Reference data model (study only, attribute if reused) |
| Settle Up | Freemium plus Group Premium | Offline, browser view without install, read-only access exists (mechanics [U]), reminders; Group Premium $39.99 / $149.99 lifetime US [C] | Group-pass pricing precedent |
| Splitser (NL) | Free plus €0.35 payments | iDEAL/Bancontact in-app payments, Splitwise switch service [C] | Shows payment monetisation needs a regulated rail |
| Kittysplit | Link-based, about €3 per Kitty | No account [C] | One-time group pricing precedent |
| goDutch (India) | **Inactive** (YC W20) [V] | Had chat, UPI handoff and a card [C] | Warning: chat plus UPI alone isn't a moat |
| Revolut Group Bills | Bank feature | Chat for bills (2023) [C, page 403 to fetcher] | Banks can bundle chat |

The full 24-dimension feature matrix and teardowns are produced in R0 from hands-on tests (§12.2). Dimensions remain **?** until observed. Absence is never inferred from a homepage.

## 3. Core UX: make the common path effortless
**Defaults** (no settings needed): payer = me · split = equally among all members (or group default) · currency = group currency · date = today · category auto-suggested (optional) · simplify debts ON for trips.

**Key journeys (target taps/time, measured in prototype tests):**
1. **Create group and invite:** name → template (Trip / Home / Couple / Event / Other) → share link or QR (WhatsApp via share sheet). Friends tap the link, pick their placeholder name or add themselves, and sign in with Google, Apple or email OTP. *Target: under 60 s for the creator, under 45 s for an invitee.*
2. **Add expense:** amount → description → Save (3 interactions for the equal-split case). *Target median under 15 s.* Unequal split: one "Adjust split" sheet with tabs Equal / Exact / % / Shares, live "₹X left to assign", undo.
3. **Add from receipt:** share photo or PDF from any app (or the camera) → draft prefilled (amount, merchant, date) → confirm. Drafts are always visibly drafts.
4. **Fix a mistake:** owner taps Edit and saves; affected members get "Hotel changed ₹6,000 → ₹5,400 (by A)" with **View change · Dispute**. A non-owner taps **Suggest change**, edits, adds an optional reason; the owner sees the diff and taps **Accept** or **Decline (reason)**.
5. **Dispute:** "Something's wrong" → reason → the expense gets a *Disputed* badge (still counted, clearly labelled) and the thread opens. It is resolved when the owner edits or deletes, a suggestion is accepted, or the disputer withdraws.
6. **Understand balance:** tap any balance → "Why?" list of contributing expenses and settlements, each with its history.
7. **Settle up:** "Settle" → suggested transfer → **Pay via UPI** (QR or intent, or copy the UPI ID) → "I've paid" → the receiver gets **Received?** → confirmed.
8. **Remove member / leave:** blocked if their balance ≠ 0 unless acknowledged; they keep a read-only view of their own balance and settlements (D7).
9. **Export / import:** export CSV/PDF per group; import a Splitwise group CSV with a mapping preview.
10. **Ask about an expense:** on the expense, tap **Ask** → type "Does this include breakfast?" → a **Question card** appears in the thread and in the timeline digest, and the owner is notified. The owner answers, and the asker or owner taps **Resolved**. Unresolved questions show as a badge on the expense and in the pre-settlement check.
11. **Needs your action:** a single inbox (badge on the group and app-wide) lists suggestions to review, review requests, disputes on my expenses, questions to me, and payments to confirm. Each row has its one-tap action inline. *Target: clear 3 items in under 30 s.*
12. **Share to WhatsApp:** from a balance, settle-up plan, expense or "trip summary", tap **Share** → WhatsApp (OS share sheet) receives a short text plus link (and optionally an image card). The link opens the exact screen in the app, or the web if not installed. The default text contains **no amounts** unless the user toggles "include amounts".
13. **Finish trip:** owner taps **Finish trip** → pre-settlement check (open questions, disputes, pending reviews, unconfirmed payments) → final settle-up plan → share → when all are settled, the group is archived read-only with a PDF summary.

**States on every screen:** empty (one primary action), loading (skeletons), offline (banner plus "pending sync" chips), error (retry, never silent), conflict (diff plus "use theirs / reapply mine"). **Pending money is visually distinct** ("not counted yet").
**Accessibility:** WCAG 2.2 AA, amounts announced in words, status never colour-only, dynamic type, 44pt targets.
**Copy:** avoid bureaucratic words. "Suggest a change", "Something's wrong", "Needs 1 OK". Never "approve proposal revision 3".

## 3A. Feature opportunity evaluation
Scores: **Value** (to target users) H/M/L · **Usability** impact (+ simplifies, ~ neutral, − adds friction or UI) · **Complexity** (build effort) L/M/H · **Cost** (running) L/M/H · **Reliability risk** (chance of wrong money or a broken promise) L/M/H. Evidence is [H] unless noted.

### Launch essentials (R1–R2)
| Feature | Value | Usab. | Cplx | Cost | Risk | Notes / evidence |
|---|---|---|---|---|---|---|
| **Needs-your-action inbox** | H | + | L | L | L | Turns collaboration into a short to-do list; keeps the timeline calm |
| **Question cards with Resolved state** | H | + | L | L | L | Core of "discuss an expense"; open questions are visible before settling |
| **Suggestion with side-by-side diff** | H | + | M | L | M | Addresses the edit-surprise pain (Splitwise FAQ titles [V], diff request [CF]); version-bound |
| **Change notifications with diff plus one-tap Dispute** | H | + | M | L | M | Transparency without approval friction |
| **Duplicate detection at entry** (same payer, amount within ±1%, date ±1 day, similar title, or same receipt hash) | H | + | L | L | L | Prevents the most common silent error; a warning, never a block |
| **Undo (10 s) after save/delete** plus restore deleted | H | + | L | L | L | Cheap safety net; restore reposts via the ledger |
| **Stay/days-based split** ("nights" preset on Shares) | H | + | L | L | L | Directly solves your hotel "arrived a day later" case |
| **Remembered splits / subgroups** ("Usual 4", "Everyone except Rahul") | H | + | L | L | L | Faster repeated entry |
| **Balance "Why?" trace** | H | + | M | L | L | Explainability differentiator |
| **Pre-settlement check** (open questions, disputes, pending reviews, unconfirmed payments) | H | + | L | L | L | Prevents settling on wrong numbers |
| **Settle-up plan plus share to WhatsApp** | H | + | L | L | L | Bridge to where people coordinate |
| **Deep links** (universal/app links to expense/thread) | H | + | M | L | L | Makes shared links useful |
| **Trip close-out** (final plan → archive → PDF) | M-H | + | M | L | L | Natural end of a trip; drives the export moment |
| **Group templates** (Trip / Home / Couple / Event) with defaults | M | + | L | L | L | Fewer settings decisions |
| **Expense search and filters** (member, category, date, status) | M | + | L | L | L | Splitwise sells search in Pro [V] |
| **Category auto-suggest (keyword rules)** | M | + | L | L | L | No ML needed in v1 |
| **Multi-currency with stored editable rate** | H (trips) | + | M | L | M | Rate feed dependency |
| **Splitwise CSV import** | H (switching) | + | M | L | M | Splitser runs a switch service [C]; Splitwise CSV gives net columns only, so the import is balance-level per expense [C] |
| **Export CSV** (+ PDF at close-out) | M | ~ | L | L | L | Tricount dropped export at relaunch [C], an opening |
| **Dark mode, i18n-ready strings, accessibility** | M | + | L | L | L | Cheap if done from day 1 (Hindi translation later) |

### Later enhancements (R3+)
| Feature | Value | Usab. | Cplx | Cost | Risk | Release / notes |
|---|---|---|---|---|---|---|
| **Itemised bill split** (assign items; tax/service/tip/discount proportional) | H (restaurants, food delivery) | + | M | L | M | **R3**; works manually first, OCR fills items later. Splitwise Pro has itemization [V] |
| **Receipt OCR prefill** | H | + | M | M | M | **R3**, opt-in; always a draft |
| **Forwarding inbox** (bookings → drafts) | M | + | M | L | M | **R3**; verified senders, DKIM/SPF |
| **Payment-request page** (web link with amount, UPI QR, intent button, expiring token) | H (India) | + | M | L | M | **R3**, after the UPI spike. Whether WhatsApp linkifies a raw `upi://` is [U], so we share an https link instead |
| **Settle reminders** (gentle, scheduled, user-sent via share) | M | ~ | L | L | L | R3 |
| **Pot / kitty** (members contribute to a shared fund; the pot pays) | H (Indian trips) | ~ | M-H | L | **H** | R4; modelled as a virtual member; needs careful ledger tests |
| **Recurring expenses** (rent, Wi-Fi, maid) | H (home) | + | M | L | M | R4, when the home segment is targeted |
| **Trip budget with progress** | M | ~ | M | L | L | R4 (TravelSpend overlap) |
| **Personal cross-group insights** (my share by category or month) | M | ~ | M | L | L | R4; Tricount brought insights back [C] |
| **Natural-language quick add** ("Dinner 2400 with Rahul, Amit") | M | + | M | M (LLM) | M | R4, opt-in; parses to a draft only |
| **Thread summary** ("what was decided?") | L-M | ~ | M | M | M | R4+, opt-in; privacy review |
| **Home-screen widget / quick-add shortcut** | M | + | M | L | L | R4 |
| **"Seen" acknowledgement on money changes** | M | ~ | L | L | L | Only if transparency research supports it |
| **Hindi and other Indian languages** | M | + | M | L | L | R4 (strings ready from R1) |
| **Receipt-required above ₹X** (group rule) | L-M | − | L | L | L | R4, only if groups ask |

### Rejected (and why)
| Feature | Reason |
|---|---|
| Android bank-SMS parsing | Google Play restricts SMS permissions to apps whose core function needs them, via declaration [C, Android Developers Blog 2019; re-verify current policy]; privacy-invasive |
| Reading UPI-app notifications (notification listener) | Invasive; policy and review risk; unreliable |
| Account Aggregator bank-feed import (India) | Requires being a regulated Financial Information User; far beyond v1 [U on exact requirements] |
| Reading WhatsApp/Instagram chats | Not officially possible [V for Instagram scope; WhatsApp has no personal-chat API] |
| Gamification, streaks, social feed, stickers | Adds noise; conflicts with "money room" seriousness |
| Auto-confirming payments from screenshots | Can't verify; would break the "never claim verified" rule |

## 4. Expense-centred group conversation (first public release)
**Purpose:** support the money workflow: discuss expenses, share receipts and bills, ask questions, suggest and compare corrections, approve or dispute, coordinate settlements, and see clear system updates when records change. **It is not a general messenger.** WhatsApp remains the place for everything else.

### 4.1 Structure
- **Group timeline** (the group's home tab, replacing a separate "Activity" and "Chat"): a chronological stream whose backbone is **financial events and cards**. Light general messages sit in between.
  - Filter chips: **All · Needs action · Money changes · Messages**.
  - Pinned header strip: *"You owe ₹1,200 · 2 items need you · 1 open question"*.
- **Expense thread** (one per expense, created lazily): all discussion about that expense. In the timeline it appears as **one card that updates in place** ("Hotel ₹6,000 · 3 comments · 1 open question · Suggestion pending"), never as duplicated messages. Replying from the card opens the thread.
- **Settlement thread:** same pattern, for "sent/received" coordination.

### 4.2 Message and card types
| Type | Who creates | What it does | Actionable? |
|---|---|---|---|
| **Text** (general or in-thread) | Member | Plain message; reply-to; @mention | — |
| **Receipt/Bill** | Member (photo or PDF, or shared in from WhatsApp, Gmail etc.) | Shows the image or file; **"Create expense from this"** → draft prefilled (OCR in R3) | Yes (owner) |
| **Question** | Member, on an expense | Shows as an open question on the expense; notifies the owner | **Resolve** (asker or owner) |
| **Suggestion** | Member | Shows a **side-by-side diff** (amount, split, payer, participants) with an optional reason | **Accept / Decline** (owner); others see the status |
| **Review request** | System (Review mode) | "Needs 1 OK", with the version diff if it's an edit | **OK / Decline** (eligible members) |
| **Dispute** | Member | Adds the *Disputed* badge, with reason | **Resolve** via edit/accept, or **Withdraw** (disputer) |
| **Settlement** | Member | "A paid B ₹1,500 via UPI · awaiting confirmation" | **Received / Didn't receive** (receiver) |
| **System update** | System | "A changed Hotel: ₹6,000 → ₹5,400 · View change"; member joined/left; settings changed | View diff |

### 4.3 Rules
- **Free text never changes money.** Typing "I paid ₹2,000" offers an optional **"Turn into expense draft"** chip (simple amount detection, client-side). A typed "approved" counts for nothing; only card buttons bound to a specific version do. "I've paid you" text offers a chip leading to **Record payment**, which needs receiver confirmation.
- Every card shows **status in words** (Open, Accepted, Declined, Outdated, Resolved) and **who acted, and when**.
- Cards are **live views of the record**, not snapshots: if an expense changes, its old Suggestion cards show "Outdated, expense changed since" with a link to the current diff.

### 4.4 Messaging features: in vs out
**In (v1):** text, reply-to, @mention, photo/PDF attachments, edit own (history plus "edited" label), delete own (tombstone), mute group or thread, report message, block member, admin hide (audited stub), expense search (records, not chat).
**Out of scope (by design, not "later"):** voice notes, video, calls, stickers/GIFs, typing indicators, presence/online status, read receipts, 1:1 DMs, message forwarding, link previews, stories, polls, chat-wide full-text search.
**Possible later, only with evidence:** a single "👍 Seen" acknowledgement on *money change* cards (transparency, not social), and a poll for "split equally or by nights?" (suggestions may already cover it).

### 4.5 WhatsApp bridge (complement, not compete)
- **Share out:** expense card, balance summary, settle-up plan, trip summary, invite link, payment-request page link, via the OS share sheet or a `wa.me` link [V share mechanisms]. Text is generic by default; amounts are opt-in per share.
- **Deep links back:** universal links (iOS) and app links (Android) to `/{group}/expense/{id}` or `/thread/{id}`. Opens the web if the app isn't installed. Links require membership; non-members see only "Join this group" if the link is an invite.
- **Share in:** receipts, bills and booking PDFs forwarded from WhatsApp land as a **Receipt/Bill** message or a draft (share-target, §8).
- We never read WhatsApp chats and never post into them ourselves.

### 4.6 Delivery, compliance, kill switch
- **Delivery:** client UUIDv7 id → API inserts in a transaction assigning a gap-free per-group `seq` → commit → publish a hint on the realtime channel → clients pull `since seq`. Dedupe is by id. Retries are idempotent. Message volume is expected to be **low** (expense-scoped), which reduces realtime cost and moderation load.
- **Compliance:** App Store 1.2 UGC requires filtering, reporting with timely response, blocking and published contact details [V guideline summary]. Reviewers reportedly expect action on reports within 24h [CF]. Google Play has a similar UGC policy [U, verify]. Even this lightweight messaging counts as UGC.
- **Kill switch:** low *general* message volume is acceptable. If after 6 beta weeks fewer than 15% of active groups use **any** expense-linked card (Question, Suggestion, Dispute, Settlement confirm), simplify to plain per-expense comments plus the activity feed.

## 5. Expense lifecycle, suggestions & review mode
**Entities:** `expense` → immutable `expense_version`s (current pointer) · `suggestion` (a proposed new version against a base version) · `review_request` (only in Review mode) · `decision` · `ledger_entry` (active versions only).

**Expense states:** `draft` (private; not counted) → `active` (counted) | `in_review` (Review mode only; *not counted*, shown as pending) → `deleted` (reversal posted, restorable by owner/admin, which reposts).
**Flags:** `disputed` (on active only; still counted, badge plus thread).

**Suggestion states:** `open` → `accepted` (applies atomically as a new version) | `declined` (reason) | `withdrawn` | `outdated` (base version changed: "rebase?" with diff).

**Review mode (opt-in, one rule):** expenses (new, or material edits) with amount ≥ ₹X need **K OKs** (default K=1) from **affected members other than the author**.
- *(Refined during R0 implementation)* A material edit to an **active** expense under review keeps the **old version counted** until the edit is approved; a decline leaves the old version in place. Only *new* expenses under review are uncounted. This avoids balances flickering during review. The threshold compares the larger of the old and new amounts, so shrinking a big expense is also reviewed.
- `required = min(K, eligible)`, evaluated against current members.
- A member leaving drops their vote. If there are 0 eligible, the item auto-activates with a system note.
- Any **Decline** returns it to the author (still not counted).
- Material edits during review restart it, and previous OKs are discarded.
- Turning Review mode off activates pending items only after an explicit admin confirmation, which is audited.
- The setting change is posted to the group feed.

**Material fields:** amount, currency/rate, payers, participants, split inputs. **Non-material:** title, notes, category, date, receipts. Owner edits these freely, all versioned.

**Authorisation:** the owner = creator, or payer if different; both can edit. Admins **cannot** edit others' expenses silently; they use suggestions like everyone else, except they can delete abusive or spam expenses, which is audited and announced. Nobody can modify ledger entries.

**Concurrency:** every write carries `base_version`. A mismatch returns `409` plus the latest version, and the client shows a diff. Decisions are bound to `(item_id, version)`. One decision per member per version (unique). Replays are idempotent. Stale decisions are rejected.

**Deliverable before code:** a complete transition table (state × action × actor → result, side effects, notifications, authZ), exhaustively tested.

## 6. Financial engine
- **Money:** `bigint` minor units plus ISO-4217 exponent table (0/2/3). Max per expense 10¹² minor units. No floats on client or server. One shared `money` package.
- **Splits:** equal, exact, percentage (basis points, must total 10,000), shares (positive decimals, scale 2), participant subset, multi-payer (payers must total the amount). **Refunds/credits** = expense kind `refund` (signs inverted, same engine). Zero or negative user input is rejected.
- **Rounding:** exact rational shares → floor → distribute remainder by largest fractional remainder, **ties broken by a stable hash of (expense_id, member_id)**. The same function runs on client (preview) and server (authoritative). Cross-runtime golden tests.
- **Currency:** each group has a ledger currency. A foreign expense stores `original_amount`, `original_currency`, `rate` (decimal string, 10 dp), `rate_source` and `rate_at`. **Conversion:** convert the total once (round half-up to ledger minor units), then allocate the converted total across shares proportionally with the same remainder rule, so Σ = total exactly. The rate defaults from a reference feed (candidate: ECB reference rates, INR coverage [U, verify]) and is user-editable. A rate change is a material edit. Changing a group's ledger currency is disallowed after the first expense in v1.
- **Ledger:** append-only `ledger_entries(group_id, member_id, amount_minor signed, source_type, source_id, source_version, reversal_of)`. An edit to an active expense = **reversal of the old version plus posting of the new one** in one transaction. The DB role cannot UPDATE/DELETE ledger rows (grants plus trigger).
- **Settlement:** `awaiting_confirmation` (payer-recorded, not posted) → `confirmed` (posted) | `declined`. Receiver-recorded posts immediately as `confirmed`. Over-payment is allowed with a warning. Settling with a former member is allowed. `verified` is reserved (needs provider evidence).
- **Simplify:** derived view only, greedy max-creditor/max-debtor (at most n−1 transfers), with a toggle for pairwise view. Never written to the ledger.
- **Deleting a settled expense** warns "This reopens balances: B would owe A ₹1,500".

### 6.1 Invariants (release gates; every one is automated)
| ID | Invariant |
|---|---|
| I1 | Every version: Σ shares = total = Σ payer amounts (ledger minor units) |
| I2 | Every posting source: Σ ledger entries = 0 |
| I3 | Every group: Σ member balances = 0 |
| I4 | Ledger rows are never updated or deleted (DB-enforced, tested) |
| I5 | Ledger = postings of exactly the active versions of active expenses plus confirmed settlements (**nightly reconciliation**, alert on any diff) |
| I6 | Drafts, in-review items, open suggestions and awaiting settlements have zero ledger impact |
| I7 | Same idempotency key + same payload → same result; same key + different payload → 422 |
| I8 | A decision counts only for its exact version; an author cannot approve their own; one per member |
| I9 | Applying simplified transfers zeroes all balances; count ≤ n−1 |
| I10 | Split output is identical on client and server for the same inputs (golden vectors) |
| I11 | After removal, a former member's reads of group data fail except for their own balance view |
| I12 | Account deletion leaves all other members' balances unchanged |

## 7. Architecture & technology (re-evaluated)
### 7.1 Decision record
| Layer | Choice | Why | Rejected alternatives |
|---|---|---|---|
| Mobile + web UI | **Expo (React Native) with Expo Router, web via react-native-web**: one UI codebase | Your React/TS skills; react-native-web is production-proven (powers the X website per Expo docs [V]); static/SPA web export [V] | Flutter (new language); separate DOM web app (2× UI work); native (cost) |
| Desktop | **Installable web app (PWA)** | Zero extra code; works on Win/macOS/Linux | Tauri 2 (relies on system webviews, WebKitGTK on Linux, so rendering varies [C]; mobile push only via 3rd-party plugin [C]; signing and updates). Electron (heavy). Revisit only on a validated need |
| API | **Node.js + TypeScript, Fastify, modular monolith**, one deployable plus a worker process | Your skills; domain logic tested in TS | Microservices (premature); logic in Postgres functions (harder to test) |
| DB | **PostgreSQL (Supabase managed, Mumbai region [U, verify])** | Transactions, constraints, RLS defence-in-depth, portable | NoSQL (weak invariants) |
| Auth | **Supabase Auth**: Google, Apple, email OTP; the API verifies JWTs | 50k MAU free / 100k on Pro [V]; less security surface to own | Better Auth (good, self-hosted, but API shifts between minors [C]); Clerk/Firebase (more lock-in or cost). Phone OTP later (India SMS needs DLT registration [U]) |
| Files | **Supabase Storage** (private buckets, signed URLs ≤5 min) | Same vendor, RLS-aware | S3/R2 (fine alternative) |
| Realtime | **Supabase Realtime Broadcast, private channels**, published by the API *after commit*, used only as a "something changed" hint; clients sync from the API by cursor | No WebSocket fleet to run; correctness stays in our DB | Own WebSocket gateway (more ops; fallback if Supabase limits bite). Realtime quotas: Pro 500 peak connections and 5M messages, overage $10/1k connections and $2.50/M messages [V] |
| Push | **Expo push service → FCM/APNs**; web push for PWA | One API for all | Direct FCM/APNs (later if needed) |
| Local store | expo-sqlite (mobile); web in-memory plus HTTP cache (online-only in v1) | Scoped offline | PowerSync/Electric (revisit if read-sync gets complex [C vendor claims]) |
| Hosting | API and worker on a container host near Mumbai (e.g. Fly.io/Render/Railway, decide in R0) | Persistent processes, simple deploys | Serverless (cold starts, long-lived jobs) |
| Observability | Sentry (client and server), structured JSON logs, OpenTelemetry traces, uptime checks | Detect drift and crashes fast | — |

**Main risk of this stack:** react-native-web desktop ergonomics (dense tables, keyboard shortcuts, hover). Mitigation: responsive list-detail layouts from day one, keyboard handlers on web, and a **design spike in R0**. If it fails, build a DOM web UI on the shared packages.

### 7.2 Repository
```
apps/client     Expo app: iOS, Android, Web/PWA
apps/api        Fastify modular monolith (HTTP)
apps/worker     notifications, OCR, inbound email, reconciliation, digests
packages/money  packages/ledger  packages/workflow   (pure, 100% unit + property tested)
packages/contracts (zod schemas, API + event types)  packages/sync (outbox, cursor pull)
```
**API modules** (own tables, expose services, no cross-module table access): identity · groups (members, roles, settings) · expenses (versions, suggestions, review) · **ledger (sole writer)** · settlements · conversations · attachments · notifications · imports (receipt, email, CSV) · audit/activity (transactional outbox) · sync.

### 7.3 Event / audit model
Relational source of truth plus an **append-only `activity_events`** table (also the transactional outbox): `event_id (uuidv7) · group_id · actor_member_id · entity_type/id · entity_version · type · payload · idempotency_key · created_at (server)`. Written in the same transaction as the change. The worker fans out notifications and realtime hints at least once; consumers dedupe by `event_id`. Ordering: per-group by `event_id` sequence. **Not event sourcing**: versions plus the append-only ledger already give replayable history without projection machinery.

**Conversation data model (simplified in Rev 3):**
- `messages(id uuidv7, group_id, seq, author_member_id, kind[text|receipt|question|system], body, anchor_type[null|expense|settlement], anchor_id, reply_to, attachments[], resolved_at, resolved_by, edited_at, deleted_at)`.
- **Cards are not stored as message copies.** Suggestion, review, dispute and settlement cards are rendered from their own domain rows (`suggestions`, `review_requests`, `settlements`), plus `activity_events` for placement in the timeline. They are always live and never stale duplicates.
- Timeline query = unanchored messages ∪ activity events (cards), merged by server time. Thread query = messages and events where anchor = the expense.
- One per-group `seq` covers messages; `activity_events.id` covers cards. The client sync pulls both cursors in one call.

### 7.4 Offline matrix
| Operation | Mobile offline | Web/desktop offline | Notes |
|---|---|---|---|
| View groups, expenses, balances, recent messages | ✓ cached ("as of 10:42") | ✗ | Balances marked stale |
| Create expense / edit own non-reviewed expense | ✓ queued, "pending sync" | ✗ | Server may reject (e.g. member removed), with fix-up UI |
| Send message / comment | ✓ queued | ✗ | |
| Suggest change | ✓ queued | ✗ | May become `outdated` |
| Accept/decline suggestion, review OK/decline, confirm settlement, membership/settings | ✗ online-only | ✗ | Buttons disabled with explanation |
| Delete expense | ✓ queued as request | ✗ | Applied only if the version still matches |

The outbox uses client UUIDs plus an `Idempotency-Key`. The server stores (key, payload hash, response) for 30 days. Tombstones propagate deletes. Clock: server timestamps order events; the expense date is a calendar date plus timezone.

## 8. Integrations (verified limits)
| Integration | Official reality | Plan |
|---|---|---|
| WhatsApp personal | No third-party access to personal chats. OS share sheet in/out and `wa.me` links | **v1:** receive shared images/PDFs/text (expo-share-intent or expo-sharing, the latter's receiving is *experimental* [V Expo docs]); share invites and summaries out |
| WhatsApp Business Platform | Business-to-user templates, per-message pricing since 1 Jul 2025, utility free inside the 24h window [V Meta docs]; opt-in required; no group chats | Defer (possible reminder channel) |
| Instagram | Messaging API only for professional accounts; **no group messaging** [V Meta docs] | **Don't build** (share-out via OS only) |
| Gmail API | Every read scope including `gmail.metadata` is **restricted** [V Google]; annual security assessment; cost reports range from ~$540 (2026 indie [CF]) to $15k–75k (2019 [C]) | Defer. **v1.x: per-group forwarding address** (TripIt-style precedent [C]), accepting only **verified sender addresses with DKIM/SPF alignment**; creates drafts only |
| UPI | P2P collect banned from 1 Oct 2025 [C, multiple outlets on NPCI circular 29 Jul 2025]. `upi://pay?pa&pn&am&cu&tn` per Linking Spec (v1.6 *draft* copy, 2017 [C]); `mc`/`tr` relate to merchant flows [C]. Anecdotes of PSP apps restricting P2P intents from third-party apps [CF] | **R1 spike:** device-test intent and QR on GPay, PhonePe, Paytm and BHIM with our own VPAs. Always offer **QR + copy UPI ID** fallbacks. Never auto-confirm |
| Other pay links | PayPal.me / Revolut / Venmo user links [U behaviour] | Optional profile field (later) |
| Receipt OCR | On-device (ML Kit / Apple Vision) or cloud | v1.x: cloud OCR opt-in per user, **prefills a draft only**; evaluate on-device; never store raw OCR beyond the draft |

Never store UPI PINs, bank credentials or OTPs. Every integration is optional to core use.

## 9. Security, privacy & operations
**Threat → control:**
- Cross-group leakage → every query is group-scoped through one authZ layer, plus Postgres RLS as a second line. A generated authZ matrix test runs every endpoint × role × (member, non-member, former). Non-members get 404.
- Forged or replayed decisions → actor comes from the session; decisions are bound to (item, version); unique constraint; idempotency.
- Concurrent mutation → row locks and version checks; serializable isolation for ledger posting.
- Account takeover → short access tokens, rotating refresh tokens, device/session list with remote revoke, OTP rate limits, new-device sign-in email. Tokens in expo-secure-store (Keychain/Keystore); web uses httpOnly cookies.
- **Account recovery** → link several sign-in methods; email recovery; support-assisted recovery with identity questions about group activity (never balance changes by support).
- Malicious or leaky attachments → MIME sniffing, size caps, image re-encode, **EXIF/GPS stripping**, PDF malware scan (worker), private bucket, signed URLs ≤5 min.
- Spam/harassment/impersonation → invite links revocable and expiring, join notifications, per-group unique display names, report/block, rate limits, admin hide (audited).
- Inbound email spoofing → verified senders only, DKIM/SPF alignment, drafts only.
- Notification leakage → **generic lock-screen text by default** ("New activity in Goa Trip"); per-user opt-in for details; per-type and per-group controls; 2-minute batching; quiet hours.
- Unauthorised export → permission check, audit, watermark (requester and time).
- Access after removal → immediate session and channel revocation for that group, signed-URL expiry, cache purge on device at next sync.

**Former members:** keep a read-only view of their own balance, own settlements and the expenses that affect them (D7). No chat access.

**Account deletion** (in-app plus web link, required by Google Play [V] and Apple 5.1.1(v) [known, re-verify]): the user is unlinked from members, the name shows as "Former member", and messages they authored are **deleted** (tombstone "message removed"). Financial records stay pseudonymised, with this retention disclosed. Export is offered first.

**Privacy law:** India DPDP Rules notified 13 Nov 2025; core fiduciary duties (notice, consent, security, breach reporting, erasure) commence **about 13 May 2027** [C, law-firm summaries], so we design for them now. A GDPR review is needed if EU users are targeted. **No E2EE in v1, and we won't claim it**: TLS plus encryption at rest. E2EE would break server-side cards, search, moderation, multi-device history and rich push.

**Operations:** daily backups plus PITR (Pro add-on); monthly restore drill to staging; nightly reconciliation (I5) with paging; SLOs (API 99.5% monthly, p95 under 300 ms); incident runbook (detect → freeze writes for the affected group → reconcile → communicate in-app → postmortem); status page; dependency and secret scanning in CI; per-environment secrets; least-privilege DB roles.

## 10. Notifications
| Type | Default | Lock-screen default |
|---|---|---|
| Mention, review requested, suggestion on my expense, dispute on my expense, settlement to confirm | On | Generic |
| Expense affecting me added/edited (with diff in app) | On, batched | Generic |
| Question asked on my expense / reply in a thread I'm in | On | Generic |
| General (unanchored) group messages | **Off** (shown in-app; optional daily digest) | Generic |
| Reminders to settle | Weekly, opt-out | Generic |

## 11. Testing & acceptance criteria
- **Ledger/workflow:** property-based (fast-check) for I1–I3, I9, I10 over 10⁶ cases; exhaustive transition-table tests; golden vectors shared client/server; rounding-fairness test.
- **Concurrency:** 50 parallel decisions → exactly one apply; same idempotency key replayed 100× → 1 record, 1 notification; edit racing with suggestion-accept → one wins, the other gets 409/outdated.
- **Offline:** 200 queued operations across airplane-mode toggles → all applied or explicitly rejected, 0 duplicates; removed-member-while-offline case.
- **Conversation:** gap-free `seq`; reconnection sync; multi-device convergence under 2 s online; edit/delete propagation. Cards always reflect the current domain state (a suggestion card flips to "Outdated" within 2 s of an expense edit). Card buttons on stale versions return 409, and the UI explains why. Typed text never creates ledger effects (test: corpus of 500 money-like messages → 0 ledger rows). Deep links for non-members leak nothing beyond an invite prompt.
- **AuthZ:** generated matrix (I11). Signed-URL expiry. Export permissions.
- **Integrations:** malformed share payloads, duplicate imports (content hash), unverified email sender, UPI intent failures with fallback.
- **E2E:** Maestro (iOS/Android: share-in, deep links, push, background/resume), Playwright (web/PWA).
- **Release gates (public beta):** all invariant tests green · reconciliation 0 diffs for 14 consecutive beta days · crash-free sessions ≥99.5% · p95 API under 300 ms at 2× expected load · 0 notifications with amounts unless opted in · App Store/Play review passed · restore drill done.

## 12. Validation before overbuilding (R0)
### 12.1 Interviews (n = 15–20, 45 min)
Screener: shared ≥5 expenses with a group in the last 3 months; mix of hostel, trip, flatmate and couple; current Splitwise/Tricount users plus spreadsheet/WhatsApp-only users.
Script themes:
- Walk through the last shared trip: where was money discussed, and what went wrong?
- The last question about an expense ("does this include…?"): where was it asked, how long until it was answered, and did the answer change the record?
- **What got lost in WhatsApp scroll** (receipts, agreed splits, "I paid" messages)? How did you find it again?
- The last disagreement: what happened and how was it resolved?
- Edits by others: were you ever surprised?
- Would you accept "needs 1 OK" above ₹X, and what X?
- How do you settle (which UPI app, or cash), and how do you know someone paid?

Avoid leading questions; ask about past behaviour, not hypotheticals. **Do not ask whether they'd move chat off WhatsApp**: that isn't our goal.

### 12.2 Competitor tests (hands-on, our own data)
Splitwise, Tricount, Splid, Settle Up, Spliit, Kittysplit on iOS, Android and web. 8 scripted scenarios: hotel ₹6,000/4; late arrival unequal split; edit after a settlement; delete and restore; foreign-currency trip; partial settlement; member removal with balance; export → import into a competitor. Record steps, taps, states, notification text, errors, accessibility (VoiceOver/TalkBack spot check). Outputs: the 24-dimension matrix plus 6 teardowns, each labelled observed/claimed.

### 12.3 Concierge diary study
3–5 real groups on upcoming trips use our ledger prototype (or a structured sheet). With consent, they share screenshots of **expense-related** WhatsApp messages they choose to share. Measure:
- how many money messages per day
- how many needed a reference to a receipt or record
- how many questions went unanswered or were answered and then lost
- how many corrections happened and what triggered them
- how long settle-up took after the trip

### 12.4 Prototype tests
Clickable prototype covering journeys 1–7. 8 participants per round, 2 rounds. Metrics: task success ≥90%, median add-expense under 15 s, ≥90% correctly distinguish "pending" from "counted", SUS ≥ 80.

### 12.5 Go/no-go after R0 and beta
| Signal | Go | Pivot |
|---|---|---|
| Interviewees reporting edit/disagreement pain in the last 3 months | ≥40% | <20% → lead with capture plus settle-up instead |
| Diary: expense messages that needed a record/receipt reference, or got lost | ≥30% of money messages | <10% → conversation reduced to per-expense comments |
| Beta: questions asked in-app that get resolved | ≥60%, median under 24h | <30% → rethink the Question flow |
| Beta: material changes viewed by ≥1 affected member within 48h | ≥70% | <40% → notification/diff UX problem |
| Beta: groups using ≥1 expense-linked card (Question/Suggestion/Dispute/Settlement confirm) | ≥30% of active groups | <15% → kill switch (§4.6) |
| Beta: closed trips where the pre-settlement check was "all clear" before settling | ≥70% | — (diagnostic) |
| Beta: inbox items actioned within 48h | ≥75% | <50% → notification/inbox UX problem |
| Beta: shares to WhatsApp per active group per week (bridge use) | ≥1 | — (diagnostic) |
| Want review above a threshold | ≥25% | <10% → hide Review mode behind an advanced setting |
| Beta: groups with ≥3 members and ≥5 expenses within 7 days | ≥50% of created groups | <30% → fix onboarding before features |
| Beta: week-4 group retention | ≥35% | <20% → re-examine value |
| Fake-door "Group pass ₹99" click-through | ≥5% of active groups | <2% → rethink pricing |

## 13. Roadmap (solo full-time; ranges ±25%)
| Release | Scope | Effort | Exit criteria |
|---|---|---|---|
| **R0: Validate and foundation** | §12 research; design spike (react-native-web desktop layout); monorepo, CI; `money`/`ledger`/`workflow` packages plus property tests; transition table; UPI intent device test | 4–5 wks | Go/no-go signals; invariants green |
| **R1: Private alpha "correct splitter"** | Auth, groups, templates, invites (link/QR), placeholders and claims, expenses (all splits, days/nights preset, remembered splits, multi-payer, refunds, FX with stored rates), **duplicate detection**, **undo/restore**, receipts attach, versions with diffs, owner-edit rule, balances with "Why?", simplify, settlements (awaiting → confirmed), basic timeline (system updates only), search/filters, CSV export, Splitwise CSV import, **share to WhatsApp plus deep links**, mobile offline (matrix), dark mode, i18n-ready, Sentry, backups | 10–12 wks | 5 real groups for 2 weeks; reconciliation 0 diffs |
| **R2: Public beta "money room"** | Expense-centred timeline with **structured cards** (Question, Suggestion diff, Review, Dispute, Settlement, Receipt/Bill), expense threads, light general messages, **Needs-your-action inbox**, Review mode (one rule), **pre-settlement check plus Finish trip**, push plus notification privacy, report/block/hide, account deletion, PWA install, store submissions | 8–10 wks | §11 release gates; §12.5 beta signals |
| **R3: Capture and settle** | Share-in receipts → Receipt/Bill message or draft, **itemised bill split** (manual), OCR prefill (opt-in), forwarding inbox, **payment-request page** with UPI QR/intent (per spike), settle reminders, PDF export, group pass (store IAP) | 6–8 wks | Median receipt-to-draft under 20 s; itemised split of a 10-line bill under 60 s; UPI handoff success documented |
| **R4: Evidence-driven** | Candidates from §3A "later": pot/kitty, recurring (home), budgets, personal insights, NL quick-add, widgets, Hindi, viewer role, separate-currency mode, Gmail API (if inbox demand justifies the assessment), WhatsApp Business reminders, Tauri desktop, payment-partner verification | — | Each needs a metric-backed case |

**Public beta ≈ 22–27 weeks; with R3 ≈ 28–35 weeks** (solo full-time, ±25%). Biggest schedule risks: store review (UGC), push and deep-link edge cases, react-native-web desktop polish, itemised-split UX.

## 14. Business model (hypothesis)
Free core, no daily caps, **no ads in financial flows**. **Group pass** (one-time per group/trip, à la Kittysplit about €3/kitty [C], Settle Up Group Premium [C]) unlocks OCR, forwarding inbox, PDF/Excel export and insights for everyone. Validate price via fake door and Van Westendorp in interviews. Cost drivers: OCR per receipt, Supabase Pro ($25/mo base [V]) plus PITR ($100/mo [V]), container hosting, Apple $99/yr, Google $25 one-time, email inbound. Support load: dispute questions and recovery.

## 15. Decisions that genuinely need your input
| # | Decision | Recommendation | Why it's yours |
|---|---|---|---|
| D1 | Beachhead | India college/hostel plus trip groups | Market focus and your access to users |
| D2 | Conversation scope | **Expense-centred timeline plus structured cards in the first public release; light general messages; messenger features out of scope** (§4.4) | Confirms the Rev 3 interpretation of your clarification |
| D2b | General messages push default | **Off** (in-app plus optional digest); expense actions and mentions on | Trade-off between noise and responsiveness |
| D3 | Default edit model | Owner edits plus others suggest; Review mode opt-in | Shapes the product's feel |
| D4 | Desktop | PWA first; Tauri later only on evidence | Whether a native desktop app is a must-have for you |
| D5 | Managed backend | Supabase (Auth/DB/Storage/Realtime) plus Node API | Vendor dependence vs ops load |
| D6 | Group currency model | Single ledger currency plus stored rates | Affects multi-currency power users |
| D7 | Former-member access | Own balance, settlements and affecting expenses only | Privacy vs fairness |
| D8 | Join friction | Sign-in required to join (Google/Apple/email OTP); optional view-only link off by default | Kittysplit/Spliit are account-free; identity enables chat and review |
| D9 | Monetisation | Free core plus one-time group pass | Business choice |
| D10 | Time commitment | Estimates assume solo full-time | Part-time roughly doubles the timeline |

## 16. Remaining risks & unknowns
- **Demand risk:** edit/dispute pain may be too infrequent to drive switching [H]. Validated in R0.
- **Habit risk:** groups may keep asking expense questions in WhatsApp out of habit, even though the app is the better place [H]. Mitigation: deep links from WhatsApp shares land on the exact expense with **Ask** one tap away; owners are notified of questions; kill switch defined (§4.6).
- **Card-UX complexity:** structured cards (Suggestion diff, Review, Dispute) must stay readable on small screens [U]. Prototype-tested in R0.
- **UPI P2P intent behaviour** across PSP apps [U]. Device spike in R0.
- **react-native-web desktop quality** [U]. Design spike in R0.
- **Supabase Realtime/Mumbai region specifics** and FX feed INR coverage [U]. Verify in R0.
- **Store review of chat (UGC)** [CF on the 24h expectation].
- **DPDP exact obligations and dates** [C]. Legal check before public launch.
- **India SMS/DLT** if phone login is ever added [U].
- **Pricing tolerance** [U].
- Competitor data marked [C] until R0 hands-on tests.

## Verification of this plan
R0 produces evidence for every [U]/[H] above: interview synthesis, a hands-on competitor matrix, a UPI device report, a react-native-web design spike, and green property tests for I1–I12. The plan is revised again at the R0 go/no-go before R1 starts.

## Sources
Splitwise Pro https://www.splitwise.com/pro · Splitwise help centre https://feedback.splitwise.com/knowledgebase · Splitwise permissions (3rd-party) https://moneyinc.com/how-splitwise-has-changed-finances-between-friends/ · edit-diff request https://splitmyexpenses.featurebase.app/p/show-full-diff-of-an-expense-editdeletion-in-activity-logs · Splitwise pricing https://getfinny.app/blog/splitwise-pricing-2026 · complaints https://pt.trustpilot.com/review/splitwise.com , https://kimola.com/reports/splitwise-app-feedback-report-uncover-user-insights-google-play-en-144452 · Splitwise CSV/API https://github.com/spliit-app/spliit/issues/22 , https://github.com/mawalu/splitwise-csv · Tricount https://tricount.com/new-app , https://tricount.com/update , https://blog.tricount.com/en/tricount-introduces-notifications · Splid https://apps.apple.com/af/app/id991473495 · Spliit https://github.com/spliit-app/spliit · Settle Up https://apps.apple.com/app/id737534985 · Splitser https://european-alternatives.eu/product/splitser , https://splitser.com/splitwise-switch-service · Kittysplit https://www.kittysplit.com/en/splitwise-alternative · goDutch https://www.ycombinator.com/companies/godutch , https://yourstory.com/2020/07/group-payments-startup-go-dutch-iit-bombay-alumni-matrix-partners · Revolut https://www.revolut.com/blog/post/avoid-money-spats-with-the-new-group-bills-chat/ · TripIt forwarding https://frequentmiler.com/getting-my-travel-life-organized-with-tripit/ · Gmail scopes https://developers.google.com/workspace/gmail/api/auth/scopes , https://support.google.com/cloud/answer/13464325 · CASA cost https://www.indiehackers.com/product/mailnotes , https://www.theregister.com/2019/02/11/google_gmail_developer/ · WhatsApp pricing https://developers.facebook.com/docs/whatsapp/pricing · Instagram messaging https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api · UPI collect ban https://www.medianama.com/2025/08/223-npci-p2p-collect-payments-oct-1-what-it-means/ · UPI linking spec copy https://www.labnol.org/files/linking.pdf · UPI intent anecdote https://community.kodular.io/t/upi-payment-using-activity-starter/74845?page=6 · Supabase pricing https://supabase.com/pricing , https://supabase.com/docs/guides/realtime/pricing · Better Auth https://www.mintlify.com/better-auth/better-auth · Expo web https://docs.expo.dev/workflow/web/ , https://docs.expo.dev/router/web/static-rendering/ · Expo sharing https://docs.expo.dev/versions/latest/sdk/sharing/ , https://npmjs.com/package/expo-share-intent · Tauri https://v2.tauri.app/blog/tauri-2-0-0-release-candidate/ , https://github.com/yanqianglu/tauri-plugin-mobile-push , https://tech-insider.org/tauri-vs-electron-2026/ · Safari web apps https://support.apple.com/en-au/104996 · Apple 1.2 UGC https://developer.apple.com/app-store/review/guidelines/ , https://developer.apple.com/forums/thread/807358 · Apple 4.8 https://developer.apple.com/forums/thread/765145 · Google Play deletion https://support.google.com/googleplay/android-developer/answer/13327111 · DPDP timeline https://www.mondaq.com/india/privacy-protection/1708830/dpdp-act-compliance-mandate , https://www.jsalaw.com/wp-content/uploads/2025/11/JSA-Prism-InfoTech-November-2025-DPDP-Rules.Final_.pdf · PowerSync/Electric https://powersync.com/blog/electricsql-electric-next-vs-powersync · Play SMS/Call Log policy https://android-developers.googleblog.com/2019/01/reminder-smscall-log-policy-changes.html
