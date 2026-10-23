# R0 Concierge Diary Study Kit

**Question to answer:** during a real trip or month, how often does money talk need a record or receipt, and how often do questions, corrections and "I paid" messages get lost or go unanswered? This feeds two go/no-go signals ([PLAN.md §12.5](../PLAN.md)): *expense messages that needed a record reference or got lost* (Go ≥30%, pivot <10%) and *edit/disagreement pain*.

**Why "concierge":** there is no app yet. You (the researcher) act as the app. Groups keep using WhatsApp normally. You keep their expenses in a structured sheet and record what happens.

---

## 1. Who and when

| Item | Target |
|---|---|
| Groups | 3–5 real groups with an **upcoming** trip or a shared month (flat, hostel) |
| Group size | 4–10 people |
| Duration | The trip plus 2 weeks after it (settle-up often drags on), or 4 weeks for a flat/hostel |
| Contact person | One member per group who agrees to be the "diary keeper" |
| Overlap | Diary keepers can also be interviewees ([01](01-interview-script-and-screener.md)); interview them **before** the study so the study doesn't bias their answers |
| Incentive (suggested) | ₹500–1,000 voucher per diary keeper, paid even if they drop out midway (pro-rata) |

## 2. Consent and privacy (non-negotiable)

1. **Every group member must agree**, not only the diary keeper. A WhatsApp screenshot shows other people's messages. The diary keeper posts the consent message (below) in the group. Anyone who doesn't reply "OK" has their messages excluded (cropped or blurred).
2. Participants **choose** what to share. Only messages about money. Never ask for the whole chat export.
3. Before sharing, blur **phone numbers, UPI IDs, bank details and profile photos**. Names can be replaced with initials.
4. Store screenshots in a private folder (not in git, not in a shared drive with others). **Delete them within 30 days after the study ends**, keeping only the coded sheet.
5. Anyone can leave at any time and ask for their data to be deleted.

**Consent message (diary keeper posts in the group):**
> Hi all! I'm helping with a small research study on how friends manage shared expenses. For this trip, I'll share screenshots of **only money-related messages** (with phone numbers and UPI IDs blurred) with the researcher. Nothing else from our chat. Data is deleted 30 days after the study. Reply **OK** if that's fine with you. If not, I'll leave your messages out. 🙏

Hinglish version:
> Hi sab! Main ek chhoti research study mein help kar raha/rahi hoon ki dost log shared kharche kaise manage karte hain. Is trip mein main researcher ke saath **sirf paise se jude messages** ke screenshots share karunga/karungi (phone number aur UPI ID blur karke). Chat ka baaki kuch nahi. Study ke 30 din baad data delete ho jaayega. Theek hai to **OK** reply karo. Nahi to aapke messages main hata dunga/dungi. 🙏

## 3. Daily routine

**Diary keeper (5 minutes per day, a reminder at a fixed time):**
1. Screenshot the day's money-related messages (blur first).
2. Send them to the researcher with a one-line note: *"Anything confusing or annoying about money today?"*
3. Forward any receipt or bill photo shared in the group.

**Researcher (15–20 minutes per group per day):**
1. Add each expense to the group's sheet (template below), with the time it was first mentioned.
2. Code each money message (coding scheme in section 4).
3. Note open questions and follow up the next day ("Did the breakfast question get answered?").

## 4. Coding scheme (one row per money message)

| Column | Values |
|---|---|
| `group` | G1–G5 |
| `msg_id` | G1-001, G1-002… |
| `date_time` | When it was sent |
| `type` | **E** new expense mentioned · **Q** question about an expense · **A** answer · **C** correction/change · **D** disagreement · **P** "I paid" / payment claim · **R** receipt/bill shared · **S** settle-up calculation · **O** other money talk |
| `refers_to` | The expense it is about (from the sheet), or blank |
| `needed_record` | **Y** if understanding or answering it needed a receipt, earlier message or calculation |
| `outcome` | **resolved** (answered/agreed) · **unanswered** (no reply in 24h) · **lost** (answered, but later re-asked, or the answer was hard to find) · **changed_record** (led to a change in amounts) · **n/a** |
| `minutes_to_resolve` | For Q, C, D: time from message to resolution |
| `scroll_pain` | **Y** if someone said "upar dekho", "kahan bheja tha", re-sent a receipt, or asked again |
| `notes` | Short paraphrase, no personal data |

## 5. Expense sheet template (one tab per group)

| # | Date | Description | Amount | Paid by | Split between | How split | Receipt? | First mentioned (msg_id) | Changed later? (msg_id) | Disputed? |
|---|---|---|---|---|---|---|---|---|---|---|

At the end, compare the sheet with the group's own final settlement (Splitwise, a spreadsheet or mental maths). **Record any difference and its cause.** This is direct evidence of wrong-money risk.

## 6. Metrics to report (per group and overall)

| Metric | Formula | Feeds |
|---|---|---|
| Money messages per day | count(all coded rows) / days | Context |
| **Record-reference rate** | rows with `needed_record = Y` / all money rows | Go/no-go: ≥30% go, <10% pivot |
| **Lost-or-unanswered rate** | rows with outcome `unanswered` or `lost` / (Q + C + D + P rows) | Go/no-go (same signal) |
| Questions resolved, and median time | Q rows with `resolved` / all Q; median `minutes_to_resolve` | Baseline for the beta target (≥60%, <24h) |
| Corrections per 10 expenses, and their triggers | C rows / expenses × 10 | Edit-pain evidence |
| Disagreements | count(D) and short description | Dispute-flow evidence |
| Payment claims later confirmed? | P rows with a matching "received" / all P | Settlement-confirmation design |
| Days from trip end to fully settled | date | Settle-up pain |
| Sheet vs group-final mismatch | ₹ difference, and its cause | Correctness pain |

## 7. Exit interview (20 minutes, diary keeper plus 1–2 members)
1. What was the most annoying money moment of the trip?
2. Show 2–3 coded "lost" or "unanswered" examples: "What happened here? How did you eventually sort it out?"
3. If there had been one place for receipts, questions and the running total, what would you have used it for? What wouldn't you have used? (Ask about specific moments, not hypothetically.)
4. Did anyone feel uncomfortable asking about money? When?
5. How did you know someone had actually paid?

## 8. Report template (one page)
- Groups, sizes, durations, and the number of coded messages
- The metrics table above, with go/no-go readings
- The 5 best quotes and 5 best examples (anonymised)
- Surprises that contradict the plan
- **Proposed plan changes**, each with its evidence
