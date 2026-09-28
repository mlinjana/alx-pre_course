# Phase 3 report · Client dashboard

*28 September 2026*

## 0. Your change to Phase 2

The banks and account providers are now a **dropdown** ("Who is it with?"), with **"Other (type the name)"** as the last option. The prototype's tiles are gone. Everything else about "Other" works as before: the name rules and "Coach to confirm against statement". The Phase 2 browser test now uses the dropdown and passes.

## 1. What I built

The client's **My climb** page (`/home`), following §8 and the prototype:

| Part | What works |
| --- | --- |
| **Stage card** | Stage and its message; rungs (5 bars) and debt load; **Climb score** with the change since last month; the five-stage ladder; the movement message; **Next stage** checklist with ticks; the Chapter 9 and 13 explanation. |
| **Stage rules** | Worked out on the server from each monthly update, up or down: |
| | • 1 → 2: gap after cuts ≥ 0, no new credit, not borrowing |
| | • 2 → 3: total debt 0 and emergency fund of 3+ months |
| | • 3 → 4: something they own pays them |
| | • Stage 5 can't be reached yet |
| **Movement messages** | Your exact wording for up a stage, down a stage, up a rung, down a rung and holding steady. |
| **Monthly update** | Total debt, accounts open, minimums, pay before deductions, new credit, borrowing, payday and emergency savings. It's filled in from the Tracker, and once saved it shows this month's saved figures. |
| **Payday check-in** | "It's past your payday on the 25th. Update your numbers so [Coach] sees where you are." A payday of 31 falls on the last day of shorter months. |
| **Payday email** | A daily job (07:00 South African time) emails clients on their payday if they haven't updated. It never sends twice for the same payday, and the email contains no figures. The wording is my draft. |
| **Programme card** | "Week N of 12 · [title]", with the 12-part bar, for clients with a coach. |
| **Coach feedback** | The latest after-call note, with homework the client can tick. Coaches start writing notes in Phase 4. |
| **Sharing switch** | On or off at any time. Every change is recorded with its time. |
| **Progress chart** | Total debt by month. |

**One rule for bands and rungs.** The two prototypes disagreed at exactly 35% and 25%. I've used your spec's wording everywhere ("below 25%" means under 25):

| Debt load | Rung |
| --- | --- |
| above 50% | 1 |
| 40–50% | 2 |
| 35% to under 40% | 3 |
| 25% to under 35% | 4 |
| under 25% | 5 |

This replaces the Phase 2 note I asked you to confirm.

### Tests (all passing)

| Suite | Result |
| --- | --- |
| Unit | 73. New: every stage rule, including that stages can go down; rung edges; Climb score 100 to 988; each movement message; payday dates, including month ends and leap years. |
| Database access checks | 57, on plain Postgres and real Supabase |
| Integration, with real logins | 13 |
| **Phase 3 browser test: your "done when"** | 7 |
| Phase 1 and Phase 2 browser tests | Still passing |
| Payday job | Refuses calls without the secret; with it, found the clients due today and, with email not set up, sent nothing and marked nothing |

The Phase 3 browser test changes the numbers three times and checks the result each time:

| Update | Stage | Rung | Climb score | Message |
| --- | --- | --- | --- | --- |
| Same as last month | Stability | 5 | 433 = 100 + (5 + 4) × 37 | "Holding steady" |
| New credit this month | Survival | 5 | 248 (−185) | "moved you back to Survival" |
| Minimums raised to 45% of pay | Stability | 2 | 322 | "Down a rung" |

The integration test proves that **switching sharing off blocks the coach immediately**, using real logins: the coach sees no debts and no updates, but still sees the client's name. Switching it back on restores access.

## 2. How Chuma tests it

1. As a test client with a coach, open **My climb**.
2. Fill in **Update this month** and save. Check the stage and Climb score against the rules and formula above.
3. Change one thing and save again. For example, set "new credit" to Yes; you should drop to Survival with the kind message.
4. Switch **Share my numbers** off. As the coach, the client now shows "hasn't shared yet". Switch it back on.

Note: movement messages compare with *last* month. In the first month there's no message, because there's nothing to compare with yet.

## 3. What I need from you

- **Approve or change the payday email wording.** It's saved in the database settings: "It's payday: time to update your numbers".
- **Add `CRON_SECRET` in Vercel.** A random string of at least 16 characters, as Vercel's docs recommend.
- The earlier requests still stand: the `mfg-portal` repository, the accounts in `docs/SETUP.md`, and approval of the other emails.

## 4. Choices I made, and what I'm unsure of

- **Asset income.** The 3 → 4 rule needs "asset income", but the spec's monthly-update list doesn't include it. I added an optional question: "Does something you own pay you every month? If so, how much?"
- **Stage 2 → 3 uses total debt = 0,** as your spec says. That means a home loan or vehicle finance also keeps someone in Stability. If the book means *bad* debt only, I need the list of which debt types count as bad.
- **No stage is guessed.** A stage needs the take-home pay from My month in the Tracker. Until it's filled in, the form asks for it.
- **Payday check-in.** It only shows for clients who have a coach, because the message names the coach.
- **Holding steady.** A monthly update with the same figures shows "Holding steady". Only the latest update each month counts.
