# R0 UPI Device-Testing Sheet: GPay, PhonePe, Paytm, BHIM

**Question to answer:** after NPCI stopped person-to-person *collect requests* (1 Oct 2025), can our app reliably hand a person-to-person payment to a UPI app using a `upi://pay` link or a QR code, with the payee and amount prefilled? The answer decides the R3 settle-up design ([PLAN.md §8](../PLAN.md)): a "Pay via UPI app" button, or only "show QR + copy UPI ID".

**What we already know:**
- P2P collect requests were stopped from 1 Oct 2025 (NPCI circular of 29 Jul 2025, per press coverage). We will not use them.
- The `upi://pay` parameters come from the NPCI *UPI Linking Specification* (we found only a third-party copy of v1.6 draft, 2017), so behaviour must be **measured**, not assumed.
- Developer forums report that some UPI apps restrict P2P links opened from third-party apps, or show risk warnings. Unverified, which is why we test.
- **Our app will never mark a payment "verified" from this flow.** The receiver confirms receipt.

---

## Safety rules (read first)

1. Use **only your own two UPI IDs** (e.g. your account in app A pays your account in app B), so all money stays with you.
2. **Complete payments only for ₹1.** For every larger amount, go as far as the **PIN entry screen and then cancel**. That tells us whether the app accepts the request without moving money.
3. **Never** screenshot or record the PIN pad, OTPs or full bank account numbers. Blur UPI IDs in any screenshot you keep.
4. Don't add a merchant code (`mc`) or pretend to be a merchant. These are personal transfers.
5. Afterwards, check both bank statements and note every ₹1 transaction in the log.

## Setup

| Item | Fill in |
|---|---|
| Android phone (model, Android version) | |
| iPhone (model, iOS version) | |
| Payee UPI ID (yours, account 2) | `PAYEE@bank` (write the real one only in your private copy) |
| Payee display name | e.g. `Test Payee` |
| App versions: GPay / PhonePe / Paytm / BHIM | |
| Laptop with `adb` (Android platform-tools) and USB debugging on (optional) | |
| QR generator that runs offline (e.g. `qrencode` on the Mac) | |

Android package names, for targeted launches (**verify each on its Play Store page URL before use**): GPay `com.google.android.apps.nbu.paisa.user` · PhonePe `com.phonepe.app` · Paytm `net.one97.paytm` · BHIM `in.org.npci.upiapp`.

---

## Test links

Replace `PAYEE@bank`. Keep the exact formatting; encode spaces as `%20`.

| ID | Purpose | Link |
|---|---|---|
| U1 | Minimal: payee only, user types the amount | `upi://pay?pa=PAYEE@bank&pn=Test%20Payee&cu=INR` |
| U2 | Prefilled ₹1.00 | `upi://pay?pa=PAYEE@bank&pn=Test%20Payee&am=1.00&cu=INR` |
| U3 | ₹1.00 + note (what our app would send) | `upi://pay?pa=PAYEE@bank&pn=Test%20Payee&am=1.00&cu=INR&tn=Goa%20trip%20settle-up` |
| U4 | Note with special characters | `…&am=1.00&cu=INR&tn=Hotel%20%E2%82%B91%2C500%20%26%20cab` (₹, comma, &) |
| U5 | Amount above ₹2,000: **stop at the PIN screen** | `…&am=2500.00&cu=INR&tn=Test` |
| U6 | Large amount, ₹50,000: **stop at the PIN screen** | `…&am=50000.00&cu=INR&tn=Test` |
| U7 | With transaction reference | `…&am=1.00&cu=INR&tn=Test&tr=TEST20261022A1` |
| U8 | Malformed amount (expect a clear error) | `…&am=1,000&cu=INR` and `…&am=1.5&cu=INR` |
| U9 | Invalid UPI ID (expect an error before PIN) | `upi://pay?pa=doesnotexist123@invalid&pn=X&am=1.00&cu=INR` |

## How to launch each link

| Method | Android | iPhone |
|---|---|---|
| M1 Tap link (system chooser) | Put the link in a note or a local HTML page and tap it, or run: `adb shell am start -a android.intent.action.VIEW -d '<link>'` | Tap the link in Notes. Record **which** app opens (iOS picks one when several apps claim `upi://`) |
| M2 Targeted app | `adb shell am start -a android.intent.action.VIEW -d '<link>' -p <package>` | Not applicable (record "n/a") |
| M3 QR on another screen | Show a QR of the link on the laptop and scan it with each app's scanner | Same, with each app's scanner, and also with the iPhone Camera app |
| M4 QR as image in the gallery | Save the QR, then use "scan from gallery" in each app | Same |

---

## Results log (one row per app × method × link × device)

| # | Device | App | Method | Link | Opened? | Payee shown correctly? | Amount prefilled? Editable? | Note shown? | Warning shown (exact text) | Reached PIN screen? | Completed (₹1 only)? | Error (exact text/code) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Android | GPay | M1 | U2 | | | | | | | | | |
| 2 | Android | GPay | M2 | U3 | | | | | | | | | |
| 3 | Android | GPay | M3 | U3 | | | | | | | | | |
| … | | | | | | | | | | | | | |

**Minimum coverage:** for each of the 4 apps, run U2, U3, U5, U8 and U9 via M1, M2 and M3 on Android, plus U3 via M1 and M3 on iPhone. That's about 64 rows; it takes roughly 2–3 hours.

---

## Summary table (fill in after testing)

| App | Android link (M1/M2) works with prefilled amount? | iPhone link works? | QR works? | Limits/warnings seen | Recommended for "Pay via UPI app" button? |
|---|---|---|---|---|---|
| GPay | | | | | |
| PhonePe | | | | | |
| Paytm | | | | | |
| BHIM | | | | | |

## Decision rule for R3

| Result | Design |
|---|---|
| ≥3 of 4 apps accept U3 via link on Android with the amount prefilled | Offer a **"Pay via UPI app"** button on Android, plus QR + copy UPI ID everywhere |
| Links work on Android but not reliably on iPhone | Button on Android only; on iPhone, QR + copy UPI ID |
| Fewer than 3 apps accept links, or warnings scare users | **QR + copy UPI ID only**; no button |
| Any app blocks or caps amounts (e.g. above ₹2,000) | Show the cap in the UI and fall back to QR/copy for larger amounts |

In every case, after the handoff the payer taps **"I've paid"**, and the receiver confirms **"Received"**. The app never claims a payment is verified.
