# Phase 2 report · Debt Ladder Tracker

*28 September 2026*

## 1. What I built

**Five Tracker steps** at `/tracker`, in the prototype's design (ladder progress bar, number tiles, gold-on-navy monograms). **Everything saves to the client's account** as they type, with a "Saved to your account" line. There's no browser storage.

| Step | What works |
| --- | --- |
| **1 · My debts** | 12 debt types and 4 statuses. |
| | **Institutions:** tiles come from the database table seeded with your §7.1 lists, plus an **Other** tile. |
| | **"Other" names:** checked by the §7.1 rules ("'store' isn't a lender's name…"). Accepted names show **"Coach to confirm against statement"**, and changing one resets the coach's confirmation. |
| | **Special types:** family debts ask "Who do you owe?"; informal lenders show the mashonisa warning. |
| | **Missing figures** show **UNKNOWN** with "Get it from your statement. We won't guess." |
| | **Each debt** shows its true cost at the minimum, or **"Never clears. This minimum doesn't even cover the interest."** |
| | **Status notes** for "With attorneys" and "Under debt review". |
| | **Totals:** total owed and total minimums, dated. |
| **2 · My month** | Take-home pay and pay before deductions. The four editable groups have running totals. Minimums come in from Step 1, including accounts not being paid. Each month's budget is kept; a new month starts from a copy of the last one. |
| **3 · My numbers** | Number tiles for total debt, debt load, gap this month and gap after cuts. The debt-load band message, the "maths is broken" message, and the Five Red Lines (Red Line 1 is automatic). |
| **4 · My attack** | Avalanche and Snowball side by side (unknown rates last). "They line up", or the "Know yourself" message. Method and extra amount. Target #1 with when it clears. Full-plan debt-free estimate and total interest for both methods, with the "Estimates only" caption. |
| **5 · My progress** | A monthly log of total debt and a bar chart drawn to scale from zero, with the latest bar in gold and the change since the first month. **Download my summary (PDF):** branded, covering all five steps, with your footer on every page. |

**Database:** a new migration.
- Budget items, homework and call logs can only point to records belonging to the same client.
- An institution must be one listed for that debt's type.
- A debt names its lender in one way only.

### Tests (all passing)

| Suite | Result |
| --- | --- |
| Unit tests | 55 (22 new for §7). The true-cost figures are checked against the standard loan formula; the plan simulation against a worked-by-hand example; plus every band edge and every "Other" name rule. |
| Database access checks | 57, on plain Postgres **and** on real Supabase. New checks: nobody can attach a budget item to someone else's budget, institutions must match the type, and a changed name needs re-confirming. |
| Integration (real logins) | 8 |
| Phase 1 browser test | 10, still passing |
| **Phase 2 browser test: your "done when"** | 10 |

The Phase 2 browser test:
1. a new client fills in all five steps
2. the screen figures match hand calculations: debt load 1,924 ÷ 16,000 = 12.0%, gap +R1,376, after cuts +R2,076, Snowball Target #1 clears in 2 months
3. the PDF downloads
4. they log out and back in, and the debts, budget, attack plan and progress are all still there

## 2. How Chuma tests it

1. Log in as a test client and press **Start my Debt Ladder Tracker** (or go to `/tracker`).
2. **Step 1:**
   - Add a credit card and tap a bank tile. Fill in balance, rate and minimum, and watch the true-cost line.
   - Add a store account, tap **Other** and type "store". It's refused. Then type a real name.
   - Leave a rate blank: it shows UNKNOWN.
   - Try a minimum smaller than the monthly interest: "Never clears".
3. **Step 2:** enter pay and a few costs.
4. **Step 3:** check the debt load against your own sum (total minimums ÷ pay before deductions × 100).
5. **Step 4:** try both methods and add an extra amount.
6. **Step 5:** log this month and press **Download my summary (PDF)**.
7. Log out, log back in, and open the Tracker. Everything is still there.

## 3. What I need from you

- **Nothing blocks Phase 3.** The earlier requests still stand: the `mfg-portal` repository, the accounts in `docs/SETUP.md`, and approval of the draft email wording.
- **The prototype prints "WhatsApp 062 868 6293".** I left it out of the app and the PDF because it isn't in the spec. Tell me if it's MFG's number and where you want it shown.

## 4. Choices I made, and what I'm unsure of

- **The Tracker starts empty.** The prototype pre-fills example debts, but saving invented debts to a real account could mislead a coach.
- **Debt-load band edges.** The spec's ranges overlap at 25%, 35%, 40% and 50%. I followed the prototype: 50% is "40–50%", 35% is "inside the target", 25% is "Below 25%". Please confirm this matches the book.
- **Avalanche ties.** When two debts have the same rate, they keep the order the client listed them in.
- **The PDF font.** The PDF uses a built-in font, so special characters show as plain ones (a minus sign becomes "-").
- **Step 5 total.** It's pre-filled from the Step 1 total, and the client can change it before logging.
