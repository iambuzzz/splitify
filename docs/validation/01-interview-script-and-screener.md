# R0 User Interviews: Screener and Script

**Goal:** find out whether the problems the product is built around actually happen, and how often. Specifically: expense questions and corrections getting lost, edits surprising people, disagreements about splits, and slow settle-up. These answers feed the go/no-go table in [PLAN.md §12.5](../PLAN.md).

**We are not testing:** whether people would move their chat off WhatsApp (not our goal), or whether they "like" our idea. Ask about **past behaviour**, never hypotheticals like "would you use…".

---

## 1. Recruiting plan

| Segment | Target interviews | Where to find them |
|---|---|---|
| College / hostel friends sharing costs | 6 | College groups, hostel WhatsApp groups (ask admins), friends of friends |
| Friends who took a group trip (last 6 months) | 6 | Travel communities, personal network, Instagram stories |
| Flatmates sharing rent / bills | 4 | Flat-hunting groups, coworking spaces |
| Couples sharing expenses | 2–3 | Personal network |
| **Total** | **18–19** (minimum 15) | |

**Quotas across segments:** at least 5 current Splitwise/Tricount/Splid users, at least 5 who use only WhatsApp + UPI + memory/spreadsheets, and at least 4 who were the "organiser" who paid for most things. No more than 3 people from the same friend group. No friends of the founder, if possible; if unavoidable, mark them in the notes.

**Incentive (suggested):** ₹300–500 voucher or UPI transfer for 50 minutes. Pay regardless of answers.

**Recruitment message** (post in groups only with the admin's permission; send privately to individuals). Don't describe the product idea, so you don't bias who signs up.

> Hi! I'm researching how friends and flatmates handle shared expenses: trips, rent, food orders. If you've split costs with a group in the last 3 months, I'd love a 50-minute chat (video or in person). No selling, just your experience. You get a ₹{amount} voucher as thanks. Interested? Fill this 2-minute form: {screener form link}

Hinglish:

> Hi! Main research kar raha/rahi hoon ki dost aur flatmates shared kharche kaise manage karte hain: trips, rent, food orders. Agar pichhle 3 mahine mein aapne kisi group ke saath kharcha baanta hai, to 50 minute baat karna chahunga/chahungi (video ya milkar). Kuch bechna nahi hai, bas aapka experience. Thank-you mein ₹{amount} ka voucher milega. Interested ho to yeh 2-minute form bhar do: {screener form link}

Put the screener questions (section 2) in the form, plus name, preferred contact and availability. Ask for the minimum personal data, and delete the details of people who don't qualify once recruitment ends.

---

## 2. Screener (5 minutes, form or call)

| # | Question | Qualify if | Notes |
|---|---|---|---|
| S1 | In the last 3 months, have you shared costs with a group (trip, flat, event, friends)? | Yes | No → thank and end |
| S2 | Roughly how many shared expenses did that group have? | 5 or more | Fewer → end |
| S3 | Which of these describes it? Trip / Flat or hostel / Couple / Event / Regular friends / Other | Any; use for quotas | |
| S4 | How did you keep track? App (which?) / WhatsApp messages / Spreadsheet / Memory / Other | Any; use for quotas | Record the app name |
| S5 | Were you usually the one who paid, or the one who paid back, or both? | Any; use for quotas | Aim for 4+ organisers |
| S6 | Age bracket: 17 or under / 18–24 / 25–34 / 35+ | 18+ only | **Exclude under-18s** (consent requirements) |
| S7 | Do you work in fintech, or for an expense-app company? | No | Yes → exclude (bias/confidentiality) |
| S8 | Are you OK with a 50-minute video or in-person conversation, with audio recorded for notes? | Yes | Recording optional; take notes if declined |

---

## 3. Consent (read before starting)

> "Thanks for joining. I'm researching how groups manage shared money. There are no right or wrong answers, and I'm not selling anything. With your permission I'll record audio only to write accurate notes. The recording stays with me, is deleted within 30 days, and I won't share your name. You can skip any question or stop at any time. Please don't show me bank details, UPI PINs or anyone else's private messages. Is that OK?"

Record a verbal "yes" (or a signed form). Store notes without full names (use P01, P02…). Delete recordings within 30 days.

---

## 4. Interview script (50 minutes)

### Warm-up (3 min)
- Tell me about the last group you shared money with. Who was in it, and what was it for?

### A. The last shared trip or month (10 min)
1. Walk me through it from the start. Who paid for what, roughly?
2. Where did money get discussed? (WhatsApp group, calls, in person, an app?)
3. How did you keep track of who paid? Show me if you can, as long as there are no private details.
4. When did you realise who owed whom? How long after the trip/month did people settle?
   - *Probe:* What made it take that long?

### B. Questions about expenses (8 min)
5. Think of the last time someone asked a question about an expense ("did this include breakfast?", "why is this so much?"). Where was it asked?
6. How long until it was answered? Did the answer change anything, such as the amount or the split?
7. **Was anything ever lost in the WhatsApp scroll?** A receipt, an agreed split, an "I paid" message? How did you find it again?
   - *Probe:* How much time did that take? How did it feel?

### C. Corrections and disagreements (10 min)
8. Tell me about the last time an amount or split was wrong. Who noticed? What happened next?
9. Has anyone ever changed or deleted an expense that affected you without you knowing? How did you find out?
   - *Probe (app users):* Did the app show what changed?
10. Tell me about the last disagreement over money in a group, even a small one. How was it resolved? Was anything left unresolved?
11. If a big expense (say a ₹6,000 hotel) went in, would you want to check it before it counted toward your balance? Above what amount would that matter, if at all?
   - *Note:* This is the one acceptable forward-looking question. Ask for a number, and ask why.

### D. Settling up (6 min)
12. How do you usually pay people back? (Which UPI app, cash, bank transfer?)
13. How does the receiver know you paid? Have you ever had "I paid" / "I didn't get it" confusion?
14. Has a payment ever been recorded twice, or forgotten?

### E. Current tools (5 min, skip parts that don't apply)
15. *(App users)* What do you like about the app? What annoys you? Have you hit any limits, ads or paywalls?
16. *(Non-app users)* Have you tried an app? What stopped you?
17. If you could fix one thing about how your group handles money, what would it be?

### F. Pricing (5 min)
Ask the questions in [06-pricing-test-kit.md, Part A](06-pricing-test-kit.md) exactly as written.

### Wrap-up (3 min)
- Is there anything I should have asked but didn't?
- Can I contact you later to try an early version? (Record yes/no and preferred contact.)

**Interviewer rules:** don't pitch the product, don't name our features, and don't correct the participant. Use silence; let them fill it. Ask "tell me more about that" and "what happened next?"

---

## 5. Note template (one per participant)

| Field | Notes |
|---|---|
| ID / segment / tool used | P01 / trip / WhatsApp + GPay |
| Group size, number of expenses, duration | |
| Where money was discussed | |
| Questions about expenses: count, where, time to answer | |
| Lost items (receipts, splits, "I paid") | |
| Corrections: count, who noticed, how fixed | |
| Surprise edits/deletes by others | Yes/No + story |
| Disagreements: count, resolved? | |
| Wants review above ₹X (number and reason) | |
| Settle-up method and time to settle | |
| Payment confusion ("I paid"/"didn't get it") | Yes/No + story |
| Strongest quote (verbatim) | |
| Surprises / things we didn't expect | |

---

## 6. Synthesis: map answers to the go/no-go signals

| Signal (PLAN §12.5) | Computed from | Go | Pivot |
|---|---|---|---|
| Edit/disagreement pain in the last 3 months | Q8–Q10: % of participants with at least 1 concrete story | ≥40% | <20% → lead with capture + settle-up |
| Expense messages needing a record, or getting lost | Q5–Q7 (plus the diary study) | ≥30% | <10% → per-expense comments only |
| Want review above a threshold | Q11: % naming a threshold | ≥25% | <10% → hide Review mode in advanced settings |
| Settle-up friction | Q4, Q13, Q14 | Diagnostic | — |

Write a one-page summary: the top 5 findings with counts (e.g. "11 of 18 had a lost-receipt story"), 3 surprises, and the go/pivot recommendation per signal. **Counts beat adjectives.**
