# Desktop Usability Testing Checklist (Windows, macOS, Ubuntu)

**Why:** the plan ships desktop as an **installable web app (PWA)**, built from the same Expo / react-native-web code as mobile ([PLAN.md §7](../PLAN.md)). The biggest technical risk is that this UI feels like a stretched phone app on a big screen. This checklist is used twice:

1. **R0 design spike:** a throwaway prototype of 3 screens (group timeline, expense detail with diff, balances). It decides **keep react-native-web for desktop** vs **build a separate web UI** on the shared packages.
2. **R2 public beta:** the same checks against the real app before release.

---

## Test environments

| OS | Browsers / install method | Assistive tech |
|---|---|---|
| Windows 11 | Edge (install as app), Chrome (install) | NVDA (free), Windows High Contrast |
| macOS 14+ | Safari 17+ **File → Add to Dock** (Apple documents notifications and badges for these web apps), Chrome (install) | VoiceOver |
| Ubuntu 24.04 LTS | Chrome or Chromium (install). Firefox: check whether it currently offers install; record the result | Orca |

Screen sizes: **1280×800**, **1920×1080**, an external 27" display, and **200% browser zoom**. Also test a window resized narrow (~900 px) to check the responsive switch.

---

## A. Install and app shell

- [ ] Install prompt or menu option is discoverable; the installed app opens in its own window with the correct name and icon
- [ ] Dock/taskbar icon, window title, and the app opening at the last screen used
- [ ] Notifications: permission asked **inside** the installed app after a user action (not on first load); a test notification arrives with **generic text** (no amounts)
- [ ] Badge count (macOS Dock / Windows taskbar where supported) shows items needing action
- [ ] Deep link (e.g. a shared expense link) opens in the installed app, or at least in the browser with the right screen
- [ ] Uninstall removes the app cleanly; signing in again restores everything (data is server-side)

## B. Layout on large screens

- [ ] **List-detail** layout at ≥1024 px: timeline/expenses on the left, detail on the right; no full-screen phone-style navigation
- [ ] Content width is capped for readability (no 1,900 px-wide text lines)
- [ ] Expense lists show more columns on desktop (date, title, paid by, amount, status) without horizontal scrolling
- [ ] Diff view (Suggestion card) shows old and new **side by side** on desktop
- [ ] No layout breaks at 200% zoom or at narrow window widths; nothing overlaps or gets cut off

## C. Keyboard

- [ ] Every action is reachable with Tab / Shift+Tab in a logical order; the focus ring is always visible
- [ ] Enter submits forms; Esc closes dialogs and sheets; focus returns to where it was
- [ ] Shortcuts (proposed): **N** new expense, **/** search, **G then B** balances, **?** shortcut help. They must not fire while typing in a field
- [ ] Amount fields accept typed and pasted amounts (`1500`, `1,500.50` gets cleaned, `₹1,500` gets cleaned) and show errors inline
- [ ] Arrow keys move through lists; Space/Enter opens the selected item

## D. Mouse, trackpad and desktop conventions

- [ ] Hover states on interactive items; tooltips on icon-only buttons
- [ ] Text is selectable (amounts, notes, UPI IDs); copy/paste works
- [ ] Right-click doesn't break anything (the native menu is fine)
- [ ] Scrolling is smooth with mouse wheel and trackpad, including in long lists (1,000+ expenses)
- [ ] **Drag and drop** a receipt image/PDF onto an expense or the timeline attaches it
- [ ] Opening an expense in a new tab or window works (real URLs per screen)

## E. Accessibility (WCAG 2.2 AA spot checks)

- [ ] Screen reader (NVDA / VoiceOver / Orca) announces amounts in words with currency, status chips ("Pending, not counted yet") and card actions
- [ ] Headings and landmarks let a screen-reader user jump between timeline, detail and balances
- [ ] Contrast passes AA in light and dark mode; status is never shown by colour alone
- [ ] Windows High Contrast / forced colours keep controls visible
- [ ] Reduced-motion setting is respected

## F. Reliability states

- [ ] Going offline shows a clear banner; buttons that need the server are disabled with an explanation (web is online-only in v1)
- [ ] Coming back online refreshes without a full reload and without duplicate items
- [ ] Two tabs open: an edit in one appears in the other, or the stale tab gets a "this changed" diff instead of overwriting
- [ ] Errors show a retry, never fail silently
- [ ] Session expiry asks to sign in again without losing a half-typed expense

## G. Performance

- [ ] First load on a mid-range laptop under 3 s on a normal connection (measure with browser DevTools)
- [ ] Group with 1,000 expenses: scrolling stays smooth; search results appear within 300 ms
- [ ] Memory stays stable after 30 minutes of use (no steady growth in the DevTools memory panel)

---

## Moderated task test (spike and beta)

5–8 participants who use laptops daily; 20 minutes each; think-aloud.

| # | Task | Success criterion | Time target |
|---|---|---|---|
| T1 | Add "Dinner ₹2,400 paid by you, split with 3 people" using only the keyboard | Saved correctly, no mouse | < 45 s |
| T2 | Find why you owe Bilal ₹1,200 | Opens the balance "Why?" and names the expenses | < 60 s |
| T3 | Review a suggested change and accept it | Correct expense updated | < 30 s |
| T4 | Attach a receipt by drag and drop | Receipt visible on the expense | < 20 s |
| T5 | Install the app and turn on notifications | Installed; test notification seen | < 2 min |

Record per task: success / partial / fail, time, errors, and quotes. After the session: **SUS questionnaire** (target ≥ 80) and "Did this feel like a desktop app or a phone app on a big screen?" (1–5).

## Decision rule (end of R0 spike)

| Result | Decision |
|---|---|
| Task success ≥ 90%, SUS ≥ 80, "feels like desktop" ≥ 4/5, no blocking accessibility issue | **Keep react-native-web** for desktop/web |
| Fixable gaps (specific components, keyboard handling) | Keep it, and budget the fixes into R1/R2 |
| Fundamental problems (keyboard/focus, screen-reader structure, list performance) | **Build a dedicated React DOM web UI** on the shared `money`/`ledger`/`workflow` packages; re-estimate R1/R2 |
